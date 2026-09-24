-- Keeps requests.status in sync with its items.
-- Security invoker: staff calls run under RLS; calls made from inside a
-- security definer RPC run with the RPC owner's rights.
create function public.refresh_request_status(request_id uuid)
returns void
language sql
set search_path = ''
as $$
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
    and r.status in ('open', 'completed')
    and r.status <> computed.status;
$$;

revoke execute on function public.refresh_request_status(uuid) from public, anon;

create function public.request_items_refresh_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_request_status(old.request_id);
  else
    perform public.refresh_request_status(new.request_id);
  end if;
  return null;
end;
$$;

create trigger request_items_refresh_status
  after insert or delete or update of status, required on public.request_items
  for each row execute function public.request_items_refresh_status();
