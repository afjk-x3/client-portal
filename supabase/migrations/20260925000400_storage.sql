-- Storage access for the documents bucket.
-- Object paths are {firm_id}/{client_id}/{item_id}/{random uuid}-{safe name}.
-- The helpers compare path segments as text and never cast them, so a
-- malformed path returns false instead of raising.

create function public.can_read_document(name text)
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
      and cc.client_id::text = split_part(can_read_document.name, '/', 2)
  );
$$;

create function public.can_write_document(name text)
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
      from public.client_contacts cc
      join public.requests r on r.client_id = cc.client_id and r.firm_id = cc.firm_id
      join public.request_items i on i.request_id = r.id and i.firm_id = r.firm_id
      where cc.user_id = (select auth.uid())
        and r.firm_id::text = split_part(can_write_document.name, '/', 1)
        and r.client_id::text = split_part(can_write_document.name, '/', 2)
        and i.id::text = split_part(can_write_document.name, '/', 3)
        and i.kind = 'file'
        and i.status in ('requested', 'needs_changes')
        and r.status = 'open'
    );
$$;

revoke execute on function public.can_read_document(text) from public, anon;
revoke execute on function public.can_write_document(text) from public, anon;

create policy "Staff and contacts can read documents"
  on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.can_read_document(name));

create policy "Contacts can upload to open file items"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.can_write_document(name));

create policy "Contacts can delete from open file items"
  on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.can_write_document(name));

-- No update policy: objects can never be overwritten.
