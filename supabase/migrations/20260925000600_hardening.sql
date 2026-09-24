-- Hardening: row locks for concurrent reviews and admin changes, overwrite
-- and delete protection for uploaded files, fixed request and item identity,
-- and code-only sign-in.

-- Replaces the version from 20260925000300. The request row is locked first:
-- two item changes on one request would otherwise each compute from a
-- snapshot that misses the other and leave the wrong status (open with every
-- required item accepted, or completed with one returned). Under READ
-- COMMITTED the update below sees the other change once it has committed.
create or replace function public.refresh_request_status(request_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform 1
  from public.requests r
  where r.id = refresh_request_status.request_id
    and r.status in ('open', 'completed')
  for no key update;

  if not found then
    return;
  end if;

  update public.requests r
  set status = computed.status
  from (
    select case
      when exists (
        select 1 from public.request_items i
        where i.request_id = refresh_request_status.request_id and i.required
      )
      and not exists (
        select 1 from public.request_items i
        where i.request_id = refresh_request_status.request_id
          and i.required
          and i.status <> 'accepted'
      )
      then 'completed'
      else 'open'
    end as status
  ) computed
  where r.id = refresh_request_status.request_id
    and r.status <> computed.status;
end;
$$;

-- Only drafts can be deleted, so a sent request never becomes a draft again.
-- Contact access and file paths follow the request's client, and item status
-- follows its request, so neither link ever changes.
create function public.requests_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'draft' and old.status <> 'draft' then
    raise exception 'invalid_state';
  end if;
  if new.client_id <> old.client_id then
    raise exception 'invalid_state';
  end if;
  return new;
end;
$$;

create trigger requests_guard_update
  before update of status, client_id on public.requests
  for each row execute function public.requests_guard_update();

create function public.request_items_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.request_id <> old.request_id then
    raise exception 'invalid_state';
  end if;
  return new;
end;
$$;

create trigger request_items_guard_update
  before update of request_id on public.request_items
  for each row execute function public.request_items_guard_update();

-- Every firm keeps an admin. RLS stops admins from changing their own row,
-- but two admins demoting or removing each other at the same moment would
-- each see the other still in place. Locking the firm row serializes them.
-- A firm that is being deleted takes its members with it.
create function public.firm_members_keep_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin') then
    perform 1 from public.firms f where f.id = old.firm_id for no key update;
    if found and not exists (
      select 1
      from public.firm_members m
      where m.firm_id = old.firm_id
        and m.role = 'admin'
        and m.user_id <> old.user_id
    ) then
      raise exception 'invalid_state';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.firm_members_keep_admin() from public, anon, authenticated;

create trigger firm_members_keep_admin
  before update of role or delete on public.firm_members
  for each row execute function public.firm_members_keep_admin();

-- Replaces the version from 20260925000400: a contact's reads also require
-- the firm segment to match the client's firm.
create or replace function public.can_read_document(name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.firm_members m
    where m.user_id = (select auth.uid())
      and m.firm_id::text = split_part(can_read_document.name, '/', 1)
  )
  or exists (
    select 1
    from public.client_contacts cc
    where cc.user_id = (select auth.uid())
      and cc.firm_id::text = split_part(can_read_document.name, '/', 1)
      and cc.client_id::text = split_part(can_read_document.name, '/', 2)
  );
$$;

-- A contact may delete only an upload that is not registered as a file, so
-- an item_files row never points at a missing object. remove_file deletes
-- the row first, then the caller deletes the object.
create function public.can_delete_document(name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_write_document(can_delete_document.name)
    and not exists (
      select 1
      from public.item_files f
      where f.storage_path = can_delete_document.name
    );
$$;

revoke execute on function public.can_delete_document(text) from public, anon;

drop policy "Contacts can delete from open file items" on storage.objects;

create policy "Contacts can delete unregistered uploads from open file items"
  on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.can_delete_document(name));

-- Signed upload URLs are checked against the policies only when they are
-- created, and the upload itself runs as the storage service, which upserts
-- when the token allows it. So the missing update policy alone does not stop
-- a contact from replacing a file after it was accepted. A new version of an
-- existing document is an overwrite: refuse it. Metadata updates still work.
create function public.documents_no_overwrite()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.bucket_id = 'documents' and new.version is distinct from old.version then
    raise exception 'invalid_state';
  end if;
  return new;
end;
$$;

create trigger documents_no_overwrite
  before update on storage.objects
  for each row execute function public.documents_no_overwrite();

-- Sign-in is by emailed code only. Auth still accepts password sign-ups, and
-- a password someone set before the address's owner first signed in would
-- keep working on the owner's account. Nothing in the app uses passwords, so
-- none is ever stored. This relies on "Confirm email" being on, so that a
-- password sign-up gets no session.
create function public.auth_users_no_password()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.encrypted_password := '';
  return new;
end;
$$;

create trigger auth_users_no_password
  before insert or update of encrypted_password on auth.users
  for each row execute function public.auth_users_no_password();
