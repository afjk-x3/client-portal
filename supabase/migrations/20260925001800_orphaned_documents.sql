-- Files in the documents bucket that no item_files row points to, older than the
-- cutoff, oldest first. Uploads in progress are safe: signed upload URLs expire
-- after 2 hours. The cleanup job (/api/cron/cleanup) deletes them through the
-- Storage API, so the stored bytes go too.
create function public.orphaned_documents(older_than interval default '24 hours', max_rows int default 1000)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'documents'
    and o.created_at < now() - orphaned_documents.older_than
    and not exists (select 1 from public.item_files f where f.storage_path = o.name)
  order by o.created_at
  limit orphaned_documents.max_rows;
$$;

revoke execute on function public.orphaned_documents(interval, int) from public, anon, authenticated;
grant execute on function public.orphaned_documents(interval, int) to service_role;
