-- Item messages: a short conversation under each item. Only the two functions
-- below write rows; staff and the client's contacts read them. A staff message
-- also queues one held item_message email per contact, replacing one still
-- waiting for the same item and recipient.
create table public.item_messages (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null,
  client_id uuid not null,
  request_id uuid not null,
  item_id uuid not null,
  author_id uuid not null, -- no foreign key: a message outlives its author's account
  author_name text not null,
  by_staff boolean not null,
  body text not null check (char_length(body) between 1 and 2000),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (item_id, firm_id) references public.request_items (id, firm_id) on delete cascade,
  check (read_at is null or not by_staff)
);
create index item_messages_item_id_created_at_idx on public.item_messages (item_id, created_at);
create index item_messages_request_id_created_at_idx on public.item_messages (request_id, created_at);
create index item_messages_unread_firm_id_idx on public.item_messages (firm_id)
  where not by_staff and read_at is null;

alter table public.item_messages enable row level security;
revoke insert, update, delete on public.item_messages from anon, authenticated;
create policy "Staff and the client's contacts can read messages"
  on public.item_messages for select to authenticated
  using (public.is_firm_member(firm_id) or public.is_client_contact(client_id));

-- The sixth outbox kind: an item_message needs its request and its item.
alter table public.email_outbox drop constraint email_outbox_kind_check;
alter table public.email_outbox add constraint email_outbox_kind_check
  check (kind in ('request_sent', 'needs_changes', 'reminder', 'staff_added', 'staff_digest', 'item_message'));
alter table public.email_outbox drop constraint email_outbox_references_check;
alter table public.email_outbox add constraint email_outbox_references_check check (
  (kind in ('request_sent', 'needs_changes', 'reminder', 'item_message')) = (request_id is not null)
  and (kind in ('needs_changes', 'item_message')) = (item_id is not null)
  and (kind = 'staff_digest') = (window_start is not null)
  and (kind = 'staff_digest') = (window_end is not null)
);

-- post_item_message posts the caller's message while the request is open or
-- completed. A staff message marks the item's client messages read, then
-- queues one held email per contact and returns the rows to send; a contact's
-- message queues nothing and returns no rows.
create function public.post_item_message(item_id uuid, body text)
returns table (email_id bigint, recipient text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_firm_id uuid;
  v_client_id uuid;
  v_request_id uuid;
  v_status text;
  v_by_staff boolean;
  v_author_name text;
begin
  select i.firm_id, r.client_id, r.id, r.status
    into v_firm_id, v_client_id, v_request_id, v_status
  from public.request_items i
  join public.requests r on r.id = i.request_id
  where i.id = post_item_message.item_id;
  if not found then
    raise exception 'not_allowed';
  end if;

  -- Contacts stay blind to drafts; staff reach the item either way, and the
  -- state check below decides drafts.
  v_by_staff := public.is_firm_member(v_firm_id);
  if v_by_staff then
    select m.full_name into v_author_name
    from public.firm_members m
    where m.firm_id = v_firm_id and m.user_id = (select auth.uid());
  elsif public.is_client_contact(v_client_id) and v_status <> 'draft' then
    select cc.full_name into v_author_name
    from public.client_contacts cc
    where cc.client_id = v_client_id and cc.user_id = (select auth.uid());
  else
    raise exception 'not_allowed';
  end if;

  if v_status not in ('open', 'completed') then
    raise exception 'invalid_state';
  end if;

  insert into public.item_messages
    (firm_id, client_id, request_id, item_id, author_id, author_name, by_staff, body)
  values
    (v_firm_id, v_client_id, v_request_id, post_item_message.item_id,
     (select auth.uid()), v_author_name, v_by_staff, post_item_message.body);

  if not v_by_staff then
    return;
  end if;

  update public.item_messages m
  set read_at = now()
  where m.item_id = post_item_message.item_id
    and not m.by_staff
    and m.read_at is null;

  return query
  insert into public.email_outbox
    (firm_id, kind, recipient, request_id, item_id, reply_to_id, send_after)
  select v_firm_id, 'item_message', cc.email, v_request_id, post_item_message.item_id,
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
revoke execute on function public.post_item_message(uuid, text) from public, anon;

-- mark_item_messages_read clears the item's unread client messages for the
-- whole firm; staff of the item's firm only.
create function public.mark_item_messages_read(item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_firm_id uuid;
begin
  select i.firm_id into v_firm_id
  from public.request_items i
  where i.id = mark_item_messages_read.item_id;
  if not found or not public.is_firm_member(v_firm_id) then
    raise exception 'not_allowed';
  end if;
  update public.item_messages m
  set read_at = now()
  where m.item_id = mark_item_messages_read.item_id
    and not m.by_staff
    and m.read_at is null;
end;
$$;
revoke execute on function public.mark_item_messages_read(uuid) from public, anon;
