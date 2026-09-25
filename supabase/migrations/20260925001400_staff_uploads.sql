-- Staff can upload files for a client, for documents that arrived another
-- way. They add to file items of open requests that are not accepted yet,
-- including items the client already submitted. Contacts keep their rules.
-- Each side removes only its own files, so a client never deletes what the
-- firm added and staff never delete what the client sent.
alter table public.item_files add column by_staff boolean not null default false;

-- Replaces the version from 20260925000400 with the staff rule.
create or replace function public.can_write_document(name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select cardinality(string_to_array(can_write_document.name, '/')) = 4
    and split_part(can_write_document.name, '/', 4) <> ''
    and exists (
      select 1
      from public.requests r
      join public.request_items i on i.request_id = r.id and i.firm_id = r.firm_id
      where r.firm_id::text = split_part(can_write_document.name, '/', 1)
        and r.client_id::text = split_part(can_write_document.name, '/', 2)
        and i.id::text = split_part(can_write_document.name, '/', 3)
        and i.kind = 'file'
        and r.status = 'open'
        and (
          (i.status in ('requested', 'needs_changes') and exists (
            select 1
            from public.client_contacts cc
            where cc.user_id = (select auth.uid())
              and cc.client_id = r.client_id
              and cc.firm_id = r.firm_id
          ))
          or (i.status in ('requested', 'needs_changes', 'submitted') and exists (
            select 1
            from public.firm_members m
            where m.user_id = (select auth.uid())
              and m.firm_id = r.firm_id
          ))
        )
    );
$$;

drop policy "Contacts can upload to open file items" on storage.objects;
create policy "Staff and contacts can upload to open file items"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.can_write_document(name));

drop policy "Contacts can delete unregistered uploads from open file items" on storage.objects;
create policy "Staff and contacts can delete unregistered uploads from open file items"
  on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.can_delete_document(name));

-- Replaces the version from 20260925000900. Staff of the firm register files
-- too (marked by_staff), on items that are not accepted yet.
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
  v_staff boolean;
  v_size bigint;
  v_mime text;
  v_extensions text[];
  v_filename text := register_file.filename;
  v_file_id uuid;
begin
  select i.firm_id, r.client_id, i.kind, i.status, r.status, public.is_firm_member(r.firm_id)
  into v_firm_id, v_client_id, v_kind, v_status, v_request_status, v_staff
  from public.request_items i
  join public.requests r on r.id = i.request_id
  where i.id = register_file.item_id
    and r.status <> 'draft'
    and (public.is_firm_member(r.firm_id) or public.is_client_contact(r.client_id))
  for update of i;

  if not found then
    raise exception 'not_allowed';
  end if;
  if v_request_status <> 'open'
     or v_kind <> 'file'
     or (v_status not in ('requested', 'needs_changes') and not (v_staff and v_status = 'submitted')) then
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

  insert into public.item_files (item_id, firm_id, storage_path, filename, size_bytes, mime, uploaded_by, by_staff)
  values (
    register_file.item_id,
    v_firm_id,
    register_file.storage_path,
    v_filename,
    coalesce(v_size, 0),
    v_mime,
    (select auth.uid()),
    v_staff
  )
  returning id into v_file_id;

  return v_file_id;
end;
$$;

-- Replaces the version from 20260925000500. Contacts remove the client's
-- files from items waiting on the client; staff remove the firm's files from
-- items that are not accepted yet. Returns the storage path so the caller can
-- delete the object.
create or replace function public.remove_file(file_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
  v_by_staff boolean;
  v_status text;
  v_request_status text;
  v_staff boolean;
begin
  select f.storage_path, f.by_staff, i.status, r.status, public.is_firm_member(r.firm_id)
  into v_path, v_by_staff, v_status, v_request_status, v_staff
  from public.item_files f
  join public.request_items i on i.id = f.item_id
  join public.requests r on r.id = i.request_id
  where f.id = remove_file.file_id
    and r.status <> 'draft'
    and (public.is_firm_member(r.firm_id) or public.is_client_contact(r.client_id))
  for update of i;

  if not found or v_by_staff <> v_staff then
    raise exception 'not_allowed';
  end if;
  if v_request_status <> 'open'
     or (v_status not in ('requested', 'needs_changes') and not (v_staff and v_status = 'submitted')) then
    raise exception 'invalid_state';
  end if;

  delete from public.item_files where id = remove_file.file_id;
  return v_path;
end;
$$;
