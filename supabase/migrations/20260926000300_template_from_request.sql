-- Save a sent request's items as a new template. Security invoker: RLS decides
-- which request is visible, and drafts are not a source. Two calls make two
-- templates; names need not be unique.
create function public.template_from_request(request_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.templates (firm_id, name)
  select r.firm_id, r.title
  from public.requests r
  where r.id = template_from_request.request_id
    and r.status <> 'draft'
  returning id into v_id;

  if v_id is null then
    return null;
  end if;

  insert into public.template_items (template_id, firm_id, position, title, description, kind, required)
  select v_id,
         i.firm_id,
         row_number() over (order by i.position, i.id)::int,
         i.title,
         i.description,
         i.kind,
         i.required
  from public.request_items i
  where i.request_id = template_from_request.request_id;

  return v_id;
end;
$$;

revoke execute on function public.template_from_request(uuid) from public, anon;
