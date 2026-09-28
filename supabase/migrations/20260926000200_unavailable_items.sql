-- "I don't have this": a contact answers an empty file item with a reason.
-- The item becomes submitted like any other answer; a file arriving later
-- clears the reason so no screen still claims the client has nothing.

alter table public.request_items
  add column unavailable_reason text
  constraint request_items_unavailable_reason_check
  check (unavailable_reason is null
         or (kind = 'file' and char_length(unavailable_reason) between 1 and 1000));

-- Contact says they don't have the document, with a trimmed reason of
-- 1 to 1,000 characters. File items in requested or needs_changes with no
-- file yet only; the request must be open, never a draft.
create function public.mark_unavailable(item_id uuid, reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(mark_unavailable.reason), '');
  v_kind text;
  v_status text;
  v_request_status text;
begin
  select i.kind, i.status, r.status
  into v_kind, v_status, v_request_status
  from public.request_items i
  join public.requests r on r.id = i.request_id
  where i.id = mark_unavailable.item_id
    and r.status <> 'draft'
    and public.is_client_contact(r.client_id)
  for update of i;

  if not found then
    raise exception 'not_allowed';
  end if;
  if v_request_status <> 'open'
     or v_kind <> 'file'
     or v_status not in ('requested', 'needs_changes')
     or exists (select 1 from public.item_files f where f.item_id = mark_unavailable.item_id)
     or v_reason is null
     or char_length(v_reason) > 1000 then
    raise exception 'invalid_state';
  end if;

  update public.request_items
  set status = 'submitted',
      submitted_at = now(),
      unavailable_reason = v_reason
  where id = mark_unavailable.item_id;
end;
$$;

revoke execute on function public.mark_unavailable(uuid, text) from public, anon;

-- A normal submission leaves no stale reason behind.
create or replace function public.submit_item(item_id uuid, text_answer text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_status text;
  v_request_status text;
  v_answer text := nullif(btrim(submit_item.text_answer), '');
begin
  select i.kind, i.status, r.status
  into v_kind, v_status, v_request_status
  from public.request_items i
  join public.requests r on r.id = i.request_id
  where i.id = submit_item.item_id
    and r.status <> 'draft'
    and public.is_client_contact(r.client_id)
  for update of i;

  if not found then
    raise exception 'not_allowed';
  end if;
  if v_request_status <> 'open' or v_status not in ('requested', 'needs_changes') then
    raise exception 'invalid_state';
  end if;

  if v_kind = 'file' then
    if not exists (select 1 from public.item_files f where f.item_id = submit_item.item_id) then
      raise exception 'invalid_state';
    end if;
    v_answer := null;
  elsif v_answer is null or char_length(v_answer) > 5000 then
    raise exception 'invalid_state';
  end if;

  update public.request_items
  set status = 'submitted',
      submitted_at = now(),
      text_answer = v_answer,
      unavailable_reason = null
  where id = submit_item.item_id;
end;
$$;

-- A file reaching the item, staff's or the contact's, clears the reason.
create function public.item_files_clear_unavailable_reason()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.request_items
  set unavailable_reason = null
  where id = new.item_id
    and unavailable_reason is not null;
  return null;
end;
$$;

create trigger item_files_clear_unavailable_reason
  after insert on public.item_files
  for each row execute function public.item_files_clear_unavailable_reason();

revoke execute on function public.item_files_clear_unavailable_reason() from public, anon, authenticated;

-- The submitted event carries the reason when the answer has one.
create or replace function public.request_items_log_events()
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
      perform public.log_request_event(new.request_id, new.id, 'submitted',
        case when new.unavailable_reason is null then '{}'::jsonb
             else jsonb_build_object('reason', new.unavailable_reason) end);
    elsif new.status = 'accepted' then
      perform public.log_request_event(new.request_id, new.id, 'accepted');
    elsif new.status = 'needs_changes' then
      perform public.log_request_event(new.request_id, new.id, 'returned', jsonb_build_object('note', new.review_note));
    end if;
  end if;
  return null;
end;
$$;
