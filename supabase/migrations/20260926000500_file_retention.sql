-- How long a firm keeps files from archived requests. Null means forever;
-- the daily cleanup deletes the ones past the period.
alter table public.firms
  add column file_retention_years int check (file_retention_years in (1, 2, 3, 5, 7, 10));

grant update (file_retention_years) on public.firms to authenticated;

-- The clock retention counts from. Requests already archived get their clock
-- started at deployment, so nothing is deleted on the first night.
alter table public.requests
  add column archived_at timestamptz,
  add column files_deleted_at timestamptz;

update public.requests set archived_at = now() where status = 'archived';

create function public.requests_set_archived_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'archived' and old.status is distinct from 'archived' then
    new.archived_at := now();
  elsif new.status <> 'archived' then
    new.archived_at := null;
  end if;
  return new;
end;
$$;

create trigger requests_set_archived_at
  before update of status on public.requests
  for each row execute function public.requests_set_archived_at();

-- How many of the caller's firm's archived requests hold files that a period
-- would delete. Staff only; a contact counts nothing.
create function public.retention_preview(years int)
returns int
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::int
  from public.requests r
  where public.is_firm_member(r.firm_id)
    and r.status = 'archived'
    and r.archived_at < now() - make_interval(years => years)
    and exists (
      select 1
      from public.request_items i
      join public.item_files f on f.item_id = i.id
      where i.request_id = r.id
    );
$$;

revoke execute on function public.retention_preview(integer) from public, anon;

-- Deletes at most max_rows expired file records; the cleanup's orphan step
-- then removes the stored objects in the same run. The item_files trigger
-- records each removal with no actor.
create function public.expire_files(max_rows int default 1000)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(t.id), '{}')
  into v_ids
  from (
    select f.id
    from public.item_files f
    join public.request_items i on i.id = f.item_id
    join public.requests r on r.id = i.request_id
    join public.firms m on m.id = r.firm_id
    where r.status = 'archived'
      and m.file_retention_years is not null
      and r.archived_at < now() - make_interval(years => m.file_retention_years)
    order by f.id
    limit max_rows
  ) t;

  if array_length(v_ids, 1) is null then
    return 0;
  end if;

  with deleted as (
    delete from public.item_files where id = any (v_ids) returning item_id
  )
  update public.requests r
  set files_deleted_at = now()
  where r.id in (
    select i.request_id
    from deleted d
    join public.request_items i on i.id = d.item_id
  );

  return array_length(v_ids, 1);
end;
$$;

revoke execute on function public.expire_files(integer) from public, anon, authenticated;
grant execute on function public.expire_files(integer) to service_role;
