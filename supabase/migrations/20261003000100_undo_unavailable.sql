-- The contact changes their mind after "I don't have this": back to
-- requested, no reason left, so the upload path opens again. Only the
-- unanswered submission mark_unavailable wrote; an accepted item is the
-- firm's decision and stays.

create function public.undo_unavailable(item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_status text;
  v_request_status text;
  v_has_reason boolean;
begin
  select i.kind, i.status, r.status, i.unavailable_reason is not null
  into v_kind, v_status, v_request_status, v_has_reason
  from public.request_items i
  join public.requests r on r.id = i.request_id
  where i.id = undo_unavailable.item_id
    and public.is_client_contact(r.client_id)
  for update of i;

  if not found then
    raise exception 'not_allowed';
  end if;
  if v_request_status <> 'open'
     or v_kind <> 'file'
     or v_status <> 'submitted'
     or not v_has_reason then
    raise exception 'invalid_state';
  end if;

  update public.request_items
  set status = 'requested',
      submitted_at = null,
      unavailable_reason = null
  where id = undo_unavailable.item_id;
end;
$$;

revoke execute on function public.undo_unavailable(uuid) from public, anon;
