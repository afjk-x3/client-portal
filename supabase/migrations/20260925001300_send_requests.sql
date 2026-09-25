-- Sends one request per client from a template, in one transaction: a bulk
-- send creates all of its requests or none. The caller supplies the new ids,
-- so it can build every email (each links to its request) before anything
-- changes. Security invoker: RLS applies to every statement.
create function public.send_requests(
  template_id uuid,
  title text,
  due_date date,
  client_ids uuid[],
  request_ids uuid[]
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

  insert into public.requests (id, firm_id, client_id, title, due_date, created_by)
  select x.request_id, v_firm_id, x.client_id, send_requests.title, send_requests.due_date, (select auth.uid())
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

revoke execute on function public.send_requests(uuid, text, date, uuid[], uuid[]) from public, anon;
