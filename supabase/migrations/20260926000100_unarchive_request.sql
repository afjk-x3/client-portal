-- Unarchive in one step. Setting the status to open and then recomputing it made
-- the timeline record "unarchived" and then "completed" for a request whose
-- required items were all accepted.

-- The status a sent request's items call for: completed when it has at least one
-- required item and every required item is accepted, open otherwise.
create function public.computed_request_status(request_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.request_items i
      where i.request_id = computed_request_status.request_id and i.required
    )
    and not exists (
      select 1 from public.request_items i
      where i.request_id = computed_request_status.request_id
        and i.required
        and i.status <> 'accepted'
    )
    then 'completed'
    else 'open'
  end;
$$;

-- Unchanged behavior; the rule now lives in computed_request_status.
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
  from (select public.computed_request_status(refresh_request_status.request_id) as status) computed
  where r.id = refresh_request_status.request_id
    and r.status <> computed.status;
end;
$$;

-- Unarchives a request straight to the status its items call for, in one statement,
-- so the timeline records one "unarchived" event. Security invoker: RLS lets only the
-- firm's staff change a request. Returns the request id, or null when the request was
-- not archived or is not the caller's to change.
create function public.unarchive_request(request_id uuid)
returns uuid
language sql
set search_path = ''
as $$
  update public.requests r
  set status = public.computed_request_status(r.id)
  where r.id = unarchive_request.request_id
    and r.status = 'archived'
  returning r.id;
$$;

revoke execute on function public.computed_request_status(uuid) from public, anon;
revoke execute on function public.unarchive_request(uuid) from public, anon;
