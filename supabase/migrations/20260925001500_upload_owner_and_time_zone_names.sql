-- Fixes from the review of the four features added after the MVP.

-- Replaces the version from 20260925001100. pg_timezone_names also lists a
-- posix/ copy of every zone (right/ copies on some systems) and "Factory".
-- Intl.DateTimeFormat rejects those names, so staff pages and the daily job
-- would throw for a firm that stored one. Every name the app offers starts
-- with a capital letter.
create or replace function public.firms_check_time_zone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_timezone_names z
    where z.name = new.time_zone
      and z.name ~ '^[A-Z]'
      and z.name <> 'Factory'
  ) then
    raise exception 'invalid_time_zone';
  end if;
  return new;
end;
$$;

update public.firms set time_zone = 'UTC' where time_zone !~ '^[A-Z]' or time_zone = 'Factory';

-- Replaces the version from 20260925001400. The object must be the caller's
-- own upload: Storage records the uploader as owner_id. Otherwise either side
-- could register the other side's upload before it did, and then remove it
-- as its own.
-- ponytail: either side can still delete the other side's upload before it is
-- registered; the uploader sees an error and a retry works. Upgrade path: an
-- owner_id check in the delete policy, with removeFile deleting the object
-- through the service role.
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
    and o.name = register_file.storage_path
    and o.owner_id = (select auth.uid())::text;

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
