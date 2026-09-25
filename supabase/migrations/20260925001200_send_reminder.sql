-- Staff can send a reminder now. It takes the same claim as the daily job's
-- reminder, keyed by the date in the firm's time zone, so a request never gets
-- two reminders on one day. Returns false when today's reminder already went out.
create function public.claim_reminder(request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date;
begin
  select (now() at time zone f.time_zone)::date
  into v_today
  from public.requests r
  join public.firms f on f.id = r.firm_id
  where r.id = claim_reminder.request_id
    and public.is_firm_member(r.firm_id);

  if not found then
    raise exception 'not_allowed';
  end if;
  -- Like the daily job: an open request of an active client, with an open item.
  if not exists (
    select 1
    from public.requests r
    join public.clients c on c.id = r.client_id
    join public.request_items i on i.request_id = r.id
    where r.id = claim_reminder.request_id
      and r.status = 'open'
      and c.archived_at is null
      and i.status in ('requested', 'needs_changes')
  ) then
    raise exception 'invalid_state';
  end if;

  insert into public.notifications_sent (kind, target_id, sent_on)
  values ('reminder', claim_reminder.request_id, v_today)
  on conflict (kind, target_id, sent_on) do nothing;
  return found;
end;
$$;

revoke execute on function public.claim_reminder(uuid) from public, anon;
