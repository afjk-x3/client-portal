-- The email outbox: every app email is recorded before it is sent and deleted
-- once it goes out or PaperLine gives up. Rows hold references only, never
-- content. App roles never touch the table: actions queue through the definer
-- functions below, and the daily job reads it as the service role.
create table public.email_outbox (
  id bigint generated always as identity primary key,
  firm_id uuid not null references public.firms (id) on delete cascade,
  kind text not null
    check (kind in ('request_sent', 'needs_changes', 'reminder', 'staff_added', 'staff_digest')),
  recipient text not null,
  request_id uuid,
  item_id uuid,
  reply_to_id uuid,
  window_start timestamptz,
  window_end timestamptz,
  failures smallint not null default 0,
  send_after timestamptz not null,
  created_at timestamptz not null default now(),
  -- A request for the three request emails, an item for needs_changes only,
  -- and both window bounds for staff_digest only. Plan 12 widens this for
  -- item_message.
  constraint email_outbox_references_check check (
    (kind in ('request_sent', 'needs_changes', 'reminder')) = (request_id is not null)
    and (kind = 'needs_changes') = (item_id is not null)
    and (kind = 'staff_digest') = (window_start is not null)
    and (kind = 'staff_digest') = (window_end is not null)
  ),
  -- One waiting email of each kind to each recipient about the same request or
  -- item; queuing again replaces the waiting row.
  constraint email_outbox_waiting_key unique nulls not distinct
    (kind, recipient, request_id, item_id, window_end),
  foreign key (request_id, firm_id) references public.requests (id, firm_id) on delete cascade,
  foreign key (item_id, firm_id) references public.request_items (id, firm_id) on delete cascade
);
create index email_outbox_firm_id_idx on public.email_outbox (firm_id);
create index email_outbox_request_id_idx on public.email_outbox (request_id);
create index email_outbox_item_id_idx on public.email_outbox (item_id);

alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from anon, authenticated;

-- Queues one held row per contact of the request's client, before the action
-- changes anything. The database picks the recipients; callers never pass an
-- address. kind is request_sent for a draft, or needs_changes for a submitted
-- or accepted item of an open or completed request.
create function public.queue_request_emails(kind text, request_id uuid, item_id uuid default null)
returns table (email_id bigint, recipient text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_firm_id uuid;
  v_client_id uuid;
begin
  select r.firm_id, r.client_id into v_firm_id, v_client_id
  from public.requests r
  where r.id = queue_request_emails.request_id
    and public.is_firm_member(r.firm_id);
  if not found then
    raise exception 'not_allowed';
  end if;

  if queue_request_emails.kind = 'request_sent' then
    if not exists (
      select 1 from public.requests r
      where r.id = queue_request_emails.request_id
        and r.status = 'draft'
    ) then
      raise exception 'invalid_state';
    end if;
  elsif queue_request_emails.kind = 'needs_changes' then
    if not exists (
      select 1
      from public.requests r
      join public.request_items i on i.request_id = r.id
      where r.id = queue_request_emails.request_id
        and i.id = queue_request_emails.item_id
        and i.status in ('submitted', 'accepted')
        and r.status in ('open', 'completed')
    ) then
      raise exception 'invalid_state';
    end if;
  else
    -- Never the reminder kind: claim_reminder owns the one reminder a day.
    raise exception 'invalid_state';
  end if;

  return query
  insert into public.email_outbox
    (firm_id, kind, recipient, request_id, item_id, reply_to_id, send_after)
  select v_firm_id, queue_request_emails.kind, cc.email, queue_request_emails.request_id,
         case when queue_request_emails.kind = 'needs_changes' then queue_request_emails.item_id end,
         (select auth.uid()), now() + interval '1 hour'
  from public.client_contacts cc
  where cc.client_id = v_client_id
  on conflict on constraint email_outbox_waiting_key
  do update set firm_id = excluded.firm_id,
                reply_to_id = excluded.reply_to_id,
                failures = 0,
                send_after = excluded.send_after
  returning id, email_outbox.recipient;
end;
$$;

revoke execute on function public.queue_request_emails(text, uuid, uuid) from public, anon;

-- Add staff queues the invitation before the membership row exists. The
-- recipient is the user's sign-in email; someone who already belongs to a firm
-- is refused with the unique-violation code, so the action keeps its message.
create function public.queue_staff_added(user_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_firm_id uuid;
  v_id bigint;
begin
  select m.firm_id into v_firm_id
  from public.firm_members m
  where m.user_id = (select auth.uid())
    and m.role = 'admin';
  if not found then
    raise exception 'not_allowed';
  end if;

  if exists (select 1 from public.firm_members m where m.user_id = queue_staff_added.user_id) then
    raise exception 'already_member' using errcode = '23505';
  end if;

  insert into public.email_outbox (firm_id, kind, recipient, reply_to_id, send_after)
  select v_firm_id, 'staff_added', u.email, (select auth.uid()), now() + interval '1 hour'
  from auth.users u
  where u.id = queue_staff_added.user_id
  on conflict on constraint email_outbox_waiting_key
  do update set firm_id = excluded.firm_id,
                reply_to_id = excluded.reply_to_id,
                failures = 0,
                send_after = excluded.send_after
  returning id into v_id;
  if not found then
    raise exception 'not_allowed';
  end if;
  return v_id;
end;
$$;

revoke execute on function public.queue_staff_added(uuid) from public, anon;

-- send_requests returns the emails it queued, one row per new request and
-- contact, so its action can send them at once. It queues while the requests
-- are still drafts, then opens them. Dropped and recreated, because create or
-- replace cannot change a return type.
drop function public.send_requests(uuid, text, date, uuid[], uuid[], text);

create function public.send_requests(
  template_id uuid,
  title text,
  due_date date,
  client_ids uuid[],
  request_ids uuid[],
  message text default null
)
returns table (email_id bigint, request_id uuid, recipient text)
language plpgsql
set search_path = ''
as $$
declare
  v_firm_id uuid;
begin
  select t.firm_id into v_firm_id
  from public.templates t
  where t.id = send_requests.template_id;
  if not found
     or cardinality(send_requests.client_ids) = 0
     or cardinality(send_requests.client_ids) <> cardinality(send_requests.request_ids)
     or (select count(distinct c) from unnest(send_requests.client_ids) c) <> cardinality(send_requests.client_ids) then
    raise exception 'not_allowed';
  end if;

  -- Like a single send: the template needs a required item, and every client
  -- must be an active client of the template's firm with a contact to email.
  if not exists (
    select 1 from public.template_items i
    where i.template_id = send_requests.template_id and i.required
  ) or (
    select count(*)
    from public.clients c
    where c.id = any(send_requests.client_ids)
      and c.firm_id = v_firm_id
      and c.archived_at is null
      and exists (select 1 from public.client_contacts cc where cc.client_id = c.id)
  ) <> cardinality(send_requests.client_ids) then
    raise exception 'invalid_state';
  end if;

  insert into public.requests (id, firm_id, client_id, title, due_date, created_by, message)
  select x.request_id, v_firm_id, x.client_id, send_requests.title, send_requests.due_date, (select auth.uid()),
         send_requests.message
  from unnest(send_requests.request_ids, send_requests.client_ids) as x(request_id, client_id);

  insert into public.request_items (request_id, firm_id, position, title, description, kind, required)
  select r.id, v_firm_id, i.position, i.title, i.description, i.kind, i.required
  from unnest(send_requests.request_ids) as r(id)
  cross join public.template_items i
  where i.template_id = send_requests.template_id;

  -- Still drafts here, so the queue accepts them: one held row per contact of
  -- each new request's client.
  return query
  select q.email_id, x.id, q.recipient
  from unnest(send_requests.request_ids) as x(id)
  cross join lateral public.queue_request_emails('request_sent', x.id) q;

  update public.requests r
  set status = 'open', sent_at = now()
  where r.id = any(send_requests.request_ids);
end;
$$;

revoke execute on function public.send_requests(uuid, text, date, uuid[], uuid[], text) from public, anon;

-- claim_reminder returns the reminder rows it queued after winning the day's
-- claim; no rows means today's reminder already went out. Dropped and
-- recreated, because create or replace cannot change a return type.
drop function public.claim_reminder(uuid);

create function public.claim_reminder(request_id uuid)
returns table (email_id bigint, recipient text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_firm_id uuid;
  v_client_id uuid;
  v_today date;
begin
  select r.firm_id, r.client_id, (now() at time zone f.time_zone)::date
  into v_firm_id, v_client_id, v_today
  from public.requests r
  join public.firms f on f.id = r.firm_id
  where r.id = claim_reminder.request_id
    and public.is_firm_member(r.firm_id);

  if not found then
    raise exception 'not_allowed';
  end if;
  -- Like the daily job: an open request of an active client, with an open item.
  if not exists (
    select 1
    from public.requests r
    join public.clients c on c.id = r.client_id
    join public.request_items i on i.request_id = r.id
    where r.id = claim_reminder.request_id
      and r.status = 'open'
      and c.archived_at is null
      and i.status in ('requested', 'needs_changes')
  ) then
    raise exception 'invalid_state';
  end if;

  insert into public.notifications_sent (kind, target_id, sent_on)
  values ('reminder', claim_reminder.request_id, v_today)
  on conflict (kind, target_id, sent_on) do nothing;
  if found then
    return query
    insert into public.email_outbox (firm_id, kind, recipient, request_id, reply_to_id, send_after)
    select v_firm_id, 'reminder', cc.email, claim_reminder.request_id, (select auth.uid()),
           now() + interval '1 hour'
    from public.client_contacts cc
    where cc.client_id = v_client_id
    on conflict on constraint email_outbox_waiting_key
    do update set firm_id = excluded.firm_id,
                  reply_to_id = excluded.reply_to_id,
                  failures = 0,
                  send_after = excluded.send_after
    returning id, email_outbox.recipient;
  end if;
end;
$$;

revoke execute on function public.claim_reminder(uuid) from public, anon;
