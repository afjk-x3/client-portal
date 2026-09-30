-- Schedules repeat one template to a list of clients. next_schedule_date
-- steps the series and clamps to a short month's last day; save_schedule
-- and set_schedule_paused are staff-facing and security invoker, so RLS
-- decides; the daily job's send_scheduled_requests (a later migration)
-- reads and moves these rows as the service role.

create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null,
  template_id uuid not null,
  title text not null check (char_length(title) between 1 and 180),
  every_months smallint not null check (every_months in (1, 3, 12)),
  day_of_month smallint not null check (day_of_month between 1 and 31),
  next_send_on date not null,
  due_after_days smallint not null check (due_after_days between 1 and 365),
  paused boolean not null default false,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  last_sent_on date,
  created_at timestamptz not null default now(),
  unique (id, firm_id),
  foreign key (template_id, firm_id) references public.templates (id, firm_id) on delete cascade
);
create index schedules_firm_id_idx on public.schedules (firm_id);
create index schedules_template_id_firm_id_idx on public.schedules (template_id, firm_id);
create index schedules_created_by_idx on public.schedules (created_by);

create table public.schedule_clients (
  schedule_id uuid not null,
  client_id uuid not null,
  firm_id uuid not null,
  primary key (schedule_id, client_id),
  foreign key (schedule_id, firm_id) references public.schedules (id, firm_id) on delete cascade,
  foreign key (client_id, firm_id) references public.clients (id, firm_id) on delete cascade
);
create index schedule_clients_client_id_firm_id_idx on public.schedule_clients (client_id, firm_id);

alter table public.schedules enable row level security;
alter table public.schedule_clients enable row level security;
revoke all on public.schedules from anon;
revoke all on public.schedule_clients from anon;
revoke update on public.schedules from authenticated;
grant update (title, every_months, day_of_month, next_send_on, due_after_days, paused)
  on public.schedules to authenticated;

create policy "Staff can read schedules"
  on public.schedules for select to authenticated
  using (public.is_firm_member(firm_id));

create policy "Staff can add schedules"
  on public.schedules for insert to authenticated
  with check (public.is_firm_member(firm_id) and created_by = (select auth.uid()));

create policy "Staff can update schedules"
  on public.schedules for update to authenticated
  using (public.is_firm_member(firm_id));

create policy "Staff can delete schedules"
  on public.schedules for delete to authenticated
  using (public.is_firm_member(firm_id));

create policy "Staff can read schedule clients"
  on public.schedule_clients for select to authenticated
  using (public.is_firm_member(firm_id));

create policy "Staff can add schedule clients"
  on public.schedule_clients for insert to authenticated
  with check (public.is_firm_member(firm_id));

create policy "Staff can delete schedule clients"
  on public.schedule_clients for delete to authenticated
  using (public.is_firm_member(firm_id));

-- The first date after `after` in the series stepping every_months months
-- from from_date, each on day_of_month or the month's last day when the
-- month is shorter. Immutable: it decides dates from its inputs alone.
create function public.next_schedule_date(from_date date, every_months int, day_of_month int, after date)
returns date
language sql
immutable
set search_path = ''
as $$
  select case
    when next_schedule_date.from_date > next_schedule_date.after
      then next_schedule_date.from_date
    else coalesce((
      select c.day
      from pg_catalog.generate_series(0, 1200) as s(n),
      lateral (
        select (
          pg_catalog.date_trunc('month', next_schedule_date.from_date)
          + pg_catalog.make_interval(months => s.n * next_schedule_date.every_months)
          + pg_catalog.make_interval(days =>
              least(next_schedule_date.day_of_month,
                extract(day from (
                  pg_catalog.date_trunc('month', next_schedule_date.from_date)
                  + pg_catalog.make_interval(months => s.n * next_schedule_date.every_months + 1)
                  - interval '1 day'))::int) - 1))::date as day
      ) c
      where c.day > next_schedule_date.after
      order by s.n
      limit 1
    ), next_schedule_date.from_date)
  end;
$$;

-- Creates a schedule, or updates one and replaces its client list, in one
-- transaction. Security invoker: RLS applies to every statement, so the
-- firm comes from the RLS-visible template (on create) or the RLS-visible
-- schedule (on update). A null next_send_on keeps the current date and
-- day_of_month changes only with a new date.
create function public.save_schedule(
  schedule_id uuid,
  template_id uuid,
  title text,
  every_months int,
  next_send_on date,
  due_after_days int,
  client_ids uuid[]
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := save_schedule.schedule_id;
  v_firm_id uuid;
begin
  if v_id is null then
    select t.firm_id into v_firm_id
    from public.templates t
    where t.id = save_schedule.template_id
      and public.is_firm_member(t.firm_id);
    if not found then
      raise exception 'not_allowed';
    end if;

    insert into public.schedules
      (firm_id, template_id, title, every_months, day_of_month, next_send_on, due_after_days, created_by)
    values
      (v_firm_id, save_schedule.template_id, save_schedule.title, save_schedule.every_months,
       extract(day from save_schedule.next_send_on)::smallint, save_schedule.next_send_on,
       save_schedule.due_after_days, (select auth.uid()))
    returning id into v_id;
  else
    update public.schedules s
    set title = save_schedule.title,
        every_months = save_schedule.every_months,
        due_after_days = save_schedule.due_after_days,
        next_send_on = coalesce(save_schedule.next_send_on, s.next_send_on),
        day_of_month = coalesce(extract(day from save_schedule.next_send_on)::smallint, s.day_of_month)
    where s.id = v_id
    returning s.firm_id into v_firm_id;
    if not found then
      raise exception 'invalid_state';
    end if;
  end if;

  delete from public.schedule_clients sc where sc.schedule_id = v_id;
  insert into public.schedule_clients (schedule_id, client_id, firm_id)
  select v_id, t.client_id, v_firm_id
  from pg_catalog.unnest(save_schedule.client_ids) as t(client_id);

  return v_id;
end;
$$;

revoke execute on function public.next_schedule_date(date, int, int, date) from public, anon;
revoke execute on function public.save_schedule(uuid, uuid, text, int, date, int, uuid[]) from public, anon;

-- Pauses or resumes, returning the id, or null when nothing changed.
-- Resuming also moves a next_send_on of today or earlier past today, so
-- dates missed while paused are not sent. Today is the date in the firm's
-- time zone. Security invoker: RLS applies.
create function public.set_schedule_paused(schedule_id uuid, paused boolean)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_firm_id uuid;
  v_every smallint;
  v_day smallint;
  v_next date;
  v_paused boolean;
  v_today date;
begin
  select s.id, s.firm_id, s.every_months, s.day_of_month, s.next_send_on, s.paused
  into v_id, v_firm_id, v_every, v_day, v_next, v_paused
  from public.schedules s
  where s.id = set_schedule_paused.schedule_id
  for update;

  if not found or v_paused = set_schedule_paused.paused then
    return null;
  end if;

  if not set_schedule_paused.paused then
    select (now() at time zone f.time_zone)::date into v_today
    from public.firms f
    where f.id = v_firm_id;
    if v_next <= v_today then
      v_next := public.next_schedule_date(v_next, v_every, v_day, v_today);
    end if;
  end if;

  update public.schedules
  set paused = set_schedule_paused.paused, next_send_on = v_next
  where id = v_id;

  return v_id;
end;
$$;

revoke execute on function public.set_schedule_paused(uuid, boolean) from public, anon;
