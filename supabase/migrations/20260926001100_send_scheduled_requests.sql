-- One transaction per due schedule: create each eligible client's request,
-- queue its email, open it, and move the schedule forward. Service role
-- only; the daily job calls it, and a second call the same day finds the
-- date already moved. The period comes from the scheduled date, so a late
-- send keeps its label.

create function public.send_scheduled_requests(schedule_id uuid, today date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := send_scheduled_requests.schedule_id;
  v_firm_id uuid;
  v_template_id uuid;
  v_title text;
  v_every smallint;
  v_day smallint;
  v_next date;
  v_due smallint;
  v_paused boolean;
  v_created_by uuid;
  v_label text;
  v_ids uuid[] := array[]::uuid[];
  v_request_id uuid;
  v_client_id uuid;
  v_count integer := 0;
begin
  select s.firm_id, s.template_id, s.title, s.every_months, s.day_of_month,
         s.next_send_on, s.due_after_days, s.paused, s.created_by
  into v_firm_id, v_template_id, v_title, v_every, v_day,
       v_next, v_due, v_paused, v_created_by
  from public.schedules s
  where s.id = v_id
  for update;

  if not found or v_paused or v_next > send_scheduled_requests.today then
    return 0;
  end if;

  -- A template with no required item sends nothing and stays due, so it
  -- goes out on the first run after someone fixes the template.
  if not exists (
    select 1 from public.template_items i
    where i.template_id = v_template_id and i.required
  ) then
    return 0;
  end if;

  -- The period just ended, from the scheduled date: the month, quarter,
  -- or year before it.
  v_label := case v_every
    when 1 then pg_catalog.to_char(v_next - interval '1 month', 'FMMonth YYYY')
    when 3 then 'Q' || extract(quarter from v_next - interval '3 months')
                || ' ' || extract(year from v_next - interval '3 months')
    when 12 then (extract(year from v_next) - 1)::text
  end;

  for v_client_id in
    select c.id
    from public.clients c
    where c.id in (
        select sc.client_id from public.schedule_clients sc where sc.schedule_id = v_id
      )
      and c.archived_at is null
      and exists (select 1 from public.client_contacts cc where cc.client_id = c.id)
  loop
    insert into public.requests (firm_id, client_id, title, due_date, created_by)
    values (v_firm_id, v_client_id, v_title || ' – ' || v_label,
            send_scheduled_requests.today + v_due, v_created_by)
    returning id into v_request_id;

    insert into public.request_items (request_id, firm_id, position, title, description, kind, required)
    select v_request_id, v_firm_id, i.position, i.title, i.description, i.kind, i.required
    from public.template_items i
    where i.template_id = v_template_id;

    insert into public.email_outbox (firm_id, kind, recipient, request_id, reply_to_id, send_after)
    select v_firm_id, 'request_sent', cc.email, v_request_id, v_created_by, now()
    from public.client_contacts cc
    where cc.client_id = v_client_id
    on conflict on constraint email_outbox_waiting_key
    do update set firm_id = excluded.firm_id,
                  reply_to_id = excluded.reply_to_id,
                  failures = 0,
                  send_after = excluded.send_after;

    v_ids := pg_catalog.array_append(v_ids, v_request_id);
    v_count := v_count + 1;
  end loop;

  -- Opening them makes the timeline record one sent event each, with no
  -- actor, shown as "PaperLine".
  update public.requests r
  set status = 'open', sent_at = now()
  where r.id = any(v_ids);

  update public.schedules s
  set next_send_on = public.next_schedule_date(s.next_send_on, s.every_months, s.day_of_month,
                                               send_scheduled_requests.today),
      last_sent_on = case when v_count > 0 then send_scheduled_requests.today else s.last_sent_on end
  where s.id = v_id;

  return v_count;
end;
$$;

revoke execute on function public.send_scheduled_requests(uuid, date) from public, anon, authenticated;
grant execute on function public.send_scheduled_requests(uuid, date) to service_role;
