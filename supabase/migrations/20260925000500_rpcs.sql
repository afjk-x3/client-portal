-- RPCs. Client-facing RPCs raise 'not_allowed' (no access or not found) or
-- 'invalid_state' (wrong status); lib/errors.ts maps them to user text.

-- Creates a firm, makes the caller its admin, and seeds the starter template.
create function public.create_firm(name text, full_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_email text := (select auth.jwt()) ->> 'email';
  v_firm_id uuid;
  v_template_id uuid;
begin
  if v_user_id is null or v_email is null then
    raise exception 'not_allowed';
  end if;
  if exists (select 1 from public.firm_members m where m.user_id = v_user_id) then
    raise exception 'not_allowed';
  end if;

  -- Length limits are enforced by the check constraints on the trimmed values.
  insert into public.firms (name)
  values (btrim(create_firm.name))
  returning id into v_firm_id;

  insert into public.firm_members (firm_id, user_id, role, full_name, email)
  values (v_firm_id, v_user_id, 'admin', btrim(create_firm.full_name), v_email);

  insert into public.templates (firm_id, name)
  values (v_firm_id, 'Annual tax return (starter)')
  returning id into v_template_id;

  insert into public.template_items (template_id, firm_id, position, title, kind, required)
  values
    (v_template_id, v_firm_id, 1, 'Government-issued photo ID', 'file', true),
    (v_template_id, v_firm_id, 2, 'Income statements from all employers', 'file', true),
    (v_template_id, v_firm_id, 3, 'Bank and investment statements', 'file', false),
    (v_template_id, v_firm_id, 4, 'Receipts for deductible expenses', 'file', false),
    (v_template_id, v_firm_id, 5, 'Last year''s tax return, if we did not prepare it', 'file', false),
    (v_template_id, v_firm_id, 6, 'Did your household or dependents change this year?', 'text', true),
    (v_template_id, v_firm_id, 7, 'Anything else we should know?', 'text', false);

  return v_firm_id;
end;
$$;

-- Contact submits an open item. File items need at least one file; text
-- items need an answer of 1 to 5,000 characters.
create function public.submit_item(item_id uuid, text_answer text default null)
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
      text_answer = v_answer
  where id = submit_item.item_id;
end;
$$;

-- Contact registers an object they uploaded to an open file item.
create function public.register_file(item_id uuid, storage_path text, filename text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_firm_id uuid;
  v_client_id uuid;
  v_kind text;
  v_status text;
  v_request_status text;
  v_size bigint;
  v_mime text;
  v_file_id uuid;
begin
  select i.firm_id, r.client_id, i.kind, i.status, r.status
  into v_firm_id, v_client_id, v_kind, v_status, v_request_status
  from public.request_items i
  join public.requests r on r.id = i.request_id
  where i.id = register_file.item_id
    and r.status <> 'draft'
    and public.is_client_contact(r.client_id)
  for update of i;

  if not found then
    raise exception 'not_allowed';
  end if;
  if v_request_status <> 'open'
     or v_status not in ('requested', 'needs_changes')
     or v_kind <> 'file' then
    raise exception 'invalid_state';
  end if;
  if not starts_with(
    register_file.storage_path,
    v_firm_id::text || '/' || v_client_id::text || '/' || register_file.item_id::text || '/'
  ) then
    raise exception 'not_allowed';
  end if;

  select (o.metadata ->> 'size')::bigint, o.metadata ->> 'mimetype'
  into v_size, v_mime
  from storage.objects o
  where o.bucket_id = 'documents'
    and o.name = register_file.storage_path;

  if not found then
    raise exception 'not_allowed';
  end if;
  if (select count(*) from public.item_files f where f.item_id = register_file.item_id) >= 20 then
    raise exception 'invalid_state';
  end if;

  insert into public.item_files (item_id, firm_id, storage_path, filename, size_bytes, mime, uploaded_by)
  values (
    register_file.item_id,
    v_firm_id,
    register_file.storage_path,
    register_file.filename,
    coalesce(v_size, 0),
    coalesce(v_mime, 'application/octet-stream'),
    (select auth.uid())
  )
  returning id into v_file_id;

  return v_file_id;
end;
$$;

-- Contact removes a file from an open item. Returns the storage path so the
-- caller can delete the object.
create function public.remove_file(file_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
  v_status text;
  v_request_status text;
begin
  select f.storage_path, i.status, r.status
  into v_path, v_status, v_request_status
  from public.item_files f
  join public.request_items i on i.id = f.item_id
  join public.requests r on r.id = i.request_id
  where f.id = remove_file.file_id
    and r.status <> 'draft'
    and public.is_client_contact(r.client_id)
  for update of i;

  if not found then
    raise exception 'not_allowed';
  end if;
  if v_request_status <> 'open' or v_status not in ('requested', 'needs_changes') then
    raise exception 'invalid_state';
  end if;

  delete from public.item_files where id = remove_file.file_id;
  return v_path;
end;
$$;

-- Used by ensureUser() when auth.admin.createUser reports email_exists.
create function public.admin_user_id_by_email(email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from auth.users u
  where lower(u.email) = lower(admin_user_id_by_email.email)
  limit 1;
$$;

revoke execute on function public.create_firm(text, text) from public, anon;
revoke execute on function public.submit_item(uuid, text) from public, anon;
revoke execute on function public.register_file(uuid, text, text) from public, anon;
revoke execute on function public.remove_file(uuid) from public, anon;
revoke execute on function public.admin_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.admin_user_id_by_email(text) to service_role;
