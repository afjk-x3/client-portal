-- Search, filters, and paging for the staff Requests page and the client list.
-- Security invoker: RLS applies. is_firm_member() also keeps out rows a user sees
-- only as another firm's contact. strpos() treats % and _ as plain characters.
-- 50 rows a page; LIST_PAGE_SIZE in lib/list-params.ts must match.

create function public.list_requests(
  q text default null,
  statuses text[] default array['draft', 'open', 'completed'],
  overdue_only boolean default false,
  page int default 1
)
returns table (
  id uuid,
  title text,
  status text,
  due_date date,
  client_id uuid,
  client_name text,
  open_items int,
  total int
)
language sql
stable
set search_path = ''
as $$
  select
    r.id,
    r.title,
    r.status,
    r.due_date,
    r.client_id,
    c.name,
    (select count(*)::int
     from public.request_items i
     where i.request_id = r.id and i.status in ('requested', 'needs_changes')),
    (count(*) over ())::int
  from public.requests r
  join public.clients c on c.id = r.client_id
  join public.firms f on f.id = r.firm_id
  where public.is_firm_member(r.firm_id)
    and r.status = any (list_requests.statuses)
    and (
      coalesce(btrim(list_requests.q), '') = ''
      or strpos(lower(r.title), lower(btrim(list_requests.q))) > 0
      or strpos(lower(c.name), lower(btrim(list_requests.q))) > 0
    )
    and (
      not list_requests.overdue_only
      or (r.status = 'open' and r.due_date < (now() at time zone f.time_zone)::date)
    )
  order by r.due_date, r.title, r.id
  limit 50
  offset (greatest(list_requests.page, 1) - 1) * 50;
$$;

-- owner: null for anyone, 'none' for no owner, or a member's user id.
create function public.list_clients(
  q text default null,
  owner text default null,
  kind text default null,
  include_archived boolean default false,
  page int default 1
)
returns table (
  id uuid,
  name text,
  kind text,
  owner_id uuid,
  archived boolean,
  total int
)
language sql
stable
set search_path = ''
as $$
  select c.id, c.name, c.kind, c.owner_id, c.archived_at is not null, (count(*) over ())::int
  from public.clients c
  where public.is_firm_member(c.firm_id)
    and (list_clients.include_archived or c.archived_at is null)
    and (list_clients.kind is null or c.kind = list_clients.kind)
    and (
      list_clients.owner is null
      or (list_clients.owner = 'none' and c.owner_id is null)
      or c.owner_id::text = lower(list_clients.owner)
    )
    and (
      coalesce(btrim(list_clients.q), '') = ''
      or strpos(lower(c.name), lower(btrim(list_clients.q))) > 0
      or exists (
        select 1
        from public.client_contacts cc
        where cc.client_id = c.id
          and (
            strpos(lower(cc.full_name), lower(btrim(list_clients.q))) > 0
            or strpos(lower(cc.email), lower(btrim(list_clients.q))) > 0
          )
      )
    )
  order by c.name, c.id
  limit 50
  offset (greatest(list_clients.page, 1) - 1) * 50;
$$;

revoke execute on function public.list_requests(text, text[], boolean, int) from public, anon;
revoke execute on function public.list_clients(text, text, text, boolean, int) from public, anon;
