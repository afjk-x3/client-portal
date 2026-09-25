-- Staff-only activity timeline for sent requests. Triggers write every event;
-- no app role can insert, change, or delete one. Drafts record nothing.

create table public.request_events (
  id bigint generated always as identity primary key,
  firm_id uuid not null,
  request_id uuid not null,
  -- No foreign keys: an event outlives a removed item or user.
  item_id uuid,
  actor_id uuid,
  kind text not null check (kind in (
    'sent', 'details_changed', 'item_added', 'item_removed', 'file_added', 'file_removed',
    'submitted', 'accepted', 'returned', 'reminder_sent', 'archived', 'unarchived', 'completed', 'reopened'
  )),
  detail jsonb not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (request_id, firm_id) references public.requests (id, firm_id) on delete cascade
);
create index request_events_request_id_id_idx on public.request_events (request_id, id);

alter table public.request_events enable row level security;
revoke insert, update, delete, truncate on public.request_events from anon, authenticated;

create policy "Staff can read events"
  on public.request_events for select to authenticated
  using (public.is_firm_member(firm_id));

-- Writes one event for a sent request. A draft, or a request already removed by a
-- cascading delete, records nothing. auth.uid() is null for the daily job.
create function public.log_request_event(request_id uuid, item_id uuid, kind text, detail jsonb default '{}')
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.request_events (firm_id, request_id, item_id, actor_id, kind, detail)
  select r.firm_id, r.id, log_request_event.item_id, (select auth.uid()), log_request_event.kind, log_request_event.detail
  from public.requests r
  where r.id = log_request_event.request_id
    and r.status <> 'draft';
$$;

create function public.requests_log_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes jsonb := '{}';
begin
  if new.status is distinct from old.status then
    if old.status = 'draft' and new.status = 'open' then
      perform public.log_request_event(new.id, null, 'sent');
    elsif new.status = 'archived' then
      perform public.log_request_event(new.id, null, 'archived');
    elsif old.status = 'archived' then
      perform public.log_request_event(new.id, null, 'unarchived');
    elsif old.status = 'open' and new.status = 'completed' then
      perform public.log_request_event(new.id, null, 'completed');
    elsif old.status = 'completed' and new.status = 'open' then
      perform public.log_request_event(new.id, null, 'reopened');
    end if;
  end if;
  if old.status <> 'draft' then
    if new.title is distinct from old.title then
      v_changes := v_changes || jsonb_build_object('title', jsonb_build_array(old.title, new.title));
    end if;
    if new.due_date is distinct from old.due_date then
      v_changes := v_changes || jsonb_build_object('due_date', jsonb_build_array(old.due_date, new.due_date));
    end if;
    if v_changes <> '{}' then
      perform public.log_request_event(new.id, null, 'details_changed', v_changes);
    end if;
  end if;
  return null;
end;
$$;

create trigger requests_log_events
  after update of status, title, due_date on public.requests
  for each row execute function public.requests_log_events();

create function public.request_items_log_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_request_event(new.request_id, new.id, 'item_added', jsonb_build_object('title', new.title));
  elsif tg_op = 'DELETE' then
    perform public.log_request_event(old.request_id, old.id, 'item_removed', jsonb_build_object('title', old.title));
  elsif new.status is distinct from old.status then
    if new.status = 'submitted' then
      perform public.log_request_event(new.request_id, new.id, 'submitted');
    elsif new.status = 'accepted' then
      perform public.log_request_event(new.request_id, new.id, 'accepted');
    elsif new.status = 'needs_changes' then
      perform public.log_request_event(new.request_id, new.id, 'returned', jsonb_build_object('note', new.review_note));
    end if;
  end if;
  return null;
end;
$$;

-- The name sorts before request_items_refresh_status, and Postgres fires a row's
-- triggers in name order: an item's event comes before the completed or reopened
-- event it causes.
create trigger request_items_log_events
  after insert or delete or update of status on public.request_items
  for each row execute function public.request_items_log_events();

create function public.item_files_log_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.log_request_event(i.request_id, old.item_id, 'file_removed',
      jsonb_build_object('filename', old.filename, 'by_staff', old.by_staff))
    from public.request_items i
    where i.id = old.item_id;
  else
    perform public.log_request_event(i.request_id, new.item_id, 'file_added',
      jsonb_build_object('filename', new.filename, 'by_staff', new.by_staff))
    from public.request_items i
    where i.id = new.item_id;
  end if;
  return null;
end;
$$;

create trigger item_files_log_events
  after insert or delete on public.item_files
  for each row execute function public.item_files_log_events();

create function public.notifications_sent_log_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'reminder' then
    perform public.log_request_event(new.target_id, null, 'reminder_sent',
      jsonb_build_object('manual', (select auth.uid()) is not null));
  end if;
  return null;
end;
$$;

create trigger notifications_sent_log_events
  after insert on public.notifications_sent
  for each row execute function public.notifications_sent_log_events();

revoke execute on function public.log_request_event(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.requests_log_events() from public, anon, authenticated;
revoke execute on function public.request_items_log_events() from public, anon, authenticated;
revoke execute on function public.item_files_log_events() from public, anon, authenticated;
revoke execute on function public.notifications_sent_log_events() from public, anon, authenticated;
