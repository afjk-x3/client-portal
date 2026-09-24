-- Saves a template's name and items in one transaction. The update locks the
-- template row, so two saves at once run one after the other instead of
-- merging their items, and a failed insert leaves the template as it was.
-- Security invoker: RLS applies to every statement.
create function public.save_template(template_id uuid, name text, items jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_firm_id uuid;
begin
  update public.templates t
  set name = save_template.name
  where t.id = save_template.template_id
  returning t.firm_id into v_firm_id;

  if not found then
    raise exception 'not_allowed';
  end if;

  delete from public.template_items i where i.template_id = save_template.template_id;

  insert into public.template_items (template_id, firm_id, position, title, description, kind, required)
  select save_template.template_id, v_firm_id, e.position, e.item ->> 'title', e.item ->> 'description',
         e.item ->> 'kind', (e.item ->> 'required')::boolean
  from jsonb_array_elements(save_template.items) with ordinality as e(item, position);
end;
$$;

revoke execute on function public.save_template(uuid, text, jsonb) from public, anon;
