-- Request editing that must happen in one transaction.

-- Creates a draft, or replaces a draft's title, due date, and items, in one
-- transaction. The guarded update locks the request row and raises
-- invalid_state once the request has been sent, so a stale editor or two
-- saves at once never leave a mix of items. Security invoker: RLS applies to
-- every statement.
create function public.save_draft(
  client_id uuid,
  title text,
  due_date date,
  items jsonb,
  request_id uuid default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := save_draft.request_id;
  v_firm_id uuid;
begin
  if v_id is null then
    select c.firm_id into v_firm_id
    from public.clients c
    where c.id = save_draft.client_id
      and public.is_firm_member(c.firm_id);
    if not found then
      raise exception 'not_allowed';
    end if;

    insert into public.requests (firm_id, client_id, title, due_date, created_by)
    values (v_firm_id, save_draft.client_id, save_draft.title, save_draft.due_date, (select auth.uid()))
    returning id into v_id;
  else
    update public.requests r
    set title = save_draft.title, due_date = save_draft.due_date
    where r.id = v_id
      and r.status = 'draft'
    returning r.firm_id into v_firm_id;
    if not found then
      raise exception 'invalid_state';
    end if;

    delete from public.request_items i where i.request_id = v_id;
  end if;

  insert into public.request_items (request_id, firm_id, position, title, description, kind, required)
  select v_id, v_firm_id, e.position, e.item ->> 'title', e.item ->> 'description',
         e.item ->> 'kind', (e.item ->> 'required')::boolean
  from jsonb_array_elements(save_draft.items) with ordinality as e(item, position);

  return v_id;
end;
$$;

revoke execute on function public.save_draft(uuid, text, date, jsonb, uuid) from public, anon;

-- Removes an item from a sent request. Allowed only while the item is
-- `requested`, has no files, and the request is open or completed. Locking the
-- item row first means a file that register_file is adding at the same moment
-- (it locks the same row) is either seen here or waits for the delete.
-- Security invoker: RLS applies. Returns the request id.
create function public.remove_item(item_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_request_id uuid;
  v_status text;
  v_request_status text;
begin
  select i.request_id, i.status, r.status
  into v_request_id, v_status, v_request_status
  from public.request_items i
  join public.requests r on r.id = i.request_id
  where i.id = remove_item.item_id
  for update of i;

  if not found then
    raise exception 'not_allowed';
  end if;
  if v_request_status not in ('open', 'completed')
     or v_status <> 'requested'
     or exists (select 1 from public.item_files f where f.item_id = remove_item.item_id) then
    raise exception 'invalid_state';
  end if;

  delete from public.request_items i where i.id = remove_item.item_id;
  return v_request_id;
end;
$$;

revoke execute on function public.remove_item(uuid) from public, anon;
