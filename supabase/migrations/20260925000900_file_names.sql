-- Replaces register_file from 20260925000500. The stored name always ends in
-- an extension that matches the object's type. The bucket checks only the
-- declared type, so a name like "statement.pdf     .js" would otherwise save
-- as a script when staff download it. A missing or different extension gets
-- the type's own appended, so honest uploads are never refused.
create or replace function public.register_file(item_id uuid, storage_path text, filename text)
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
  v_extensions text[];
  v_filename text := register_file.filename;
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

  -- Must match MIME_BY_EXTENSION in lib/files.ts and the bucket's allowed types.
  v_extensions := case v_mime
    when 'application/pdf' then array['pdf']
    when 'image/jpeg' then array['jpg', 'jpeg']
    when 'image/png' then array['png']
    when 'image/webp' then array['webp']
    when 'image/heic' then array['heic']
    when 'text/csv' then array['csv']
    when 'application/vnd.ms-excel' then array['xls']
    when 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' then array['xlsx']
    when 'application/msword' then array['doc']
    when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then array['docx']
  end;
  if v_extensions is null then
    raise exception 'not_allowed';
  end if;
  if not coalesce(lower(substring(v_filename from '\.([^.]+)$')) = any (v_extensions), false) then
    v_filename := left(v_filename, 250) || '.' || v_extensions[1];
  end if;

  insert into public.item_files (item_id, firm_id, storage_path, filename, size_bytes, mime, uploaded_by)
  values (
    register_file.item_id,
    v_firm_id,
    register_file.storage_path,
    v_filename,
    coalesce(v_size, 0),
    v_mime,
    (select auth.uid())
  )
  returning id into v_file_id;

  return v_file_id;
end;
$$;
