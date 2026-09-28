-- An optional personal message staff attach to a request; it appears in the
-- request-sent email and at the top of the client's portal page. Stored
-- trimmed, 1 to 2,000 characters when present, null when blank.
alter table public.requests
  add column message text check (message is null or char_length(message) between 1 and 2000);

-- save_draft and send_requests gain a trailing `message text default null`.
-- Dropping and recreating (rather than create or replace) keeps one signature:
-- an added argument would leave two overloads, and calls without it could not
-- choose between them.
drop function public.save_draft(uuid, text, date, jsonb, uuid);

create function public.save_draft(
  client_id uuid,
  title text,
  due_date date,
  items jsonb,
  request_id uuid default null,
  message text default null
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

    insert into public.requests (firm_id, client_id, title, due_date, created_by, message)
    values (v_firm_id, save_draft.client_id, save_draft.title, save_draft.due_date, (select auth.uid()),
            save_draft.message)
    returning id into v_id;
  else
    update public.requests r
    set title = save_draft.title, due_date = save_draft.due_date, message = save_draft.message
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

revoke execute on function public.save_draft(uuid, text, date, jsonb, uuid, text) from public, anon;

drop function public.send_requests(uuid, text, date, uuid[], uuid[]);

create function public.send_requests(
  template_id uuid,
  title text,
  due_date date,
  client_ids uuid[],
  request_ids uuid[],
  message text default null
)
returns void
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

  update public.requests r
  set status = 'open', sent_at = now()
  where r.id = any(send_requests.request_ids);
end;
$$;

revoke execute on function public.send_requests(uuid, text, date, uuid[], uuid[], text) from public, anon;
