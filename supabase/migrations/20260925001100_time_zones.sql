-- Each firm has a time zone, and its "today" follows it: due dates, overdue,
-- and the day a reminder goes out. Set at signup from the browser; admins can
-- change it in Settings.
alter table public.firms add column time_zone text not null default 'UTC';

-- Only names Postgres knows, so `now() at time zone` works for every firm.
create function public.firms_check_time_zone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.time_zone) then
    raise exception 'invalid_time_zone';
  end if;
  return new;
end;
$$;

revoke execute on function public.firms_check_time_zone() from public, anon, authenticated;

create trigger firms_check_time_zone
  before insert or update of time_zone on public.firms
  for each row execute function public.firms_check_time_zone();

grant update (time_zone) on public.firms to authenticated;

-- Replaces the version from 20260925000500 with the firm's time zone.
drop function public.create_firm(text, text);

create function public.create_firm(name text, full_name text, time_zone text default 'UTC')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_email text := (select auth.jwt()) ->> 'email';
  v_firm_id uuid;
  v_template_id uuid;
begin
  if v_user_id is null or v_email is null then
    raise exception 'not_allowed';
  end if;
  if exists (select 1 from public.firm_members m where m.user_id = v_user_id) then
    raise exception 'not_allowed';
  end if;

  -- Length limits are enforced by the check constraints on the trimmed values.
  insert into public.firms (name, time_zone)
  values (btrim(create_firm.name), create_firm.time_zone)
  returning id into v_firm_id;

  insert into public.firm_members (firm_id, user_id, role, full_name, email)
  values (v_firm_id, v_user_id, 'admin', btrim(create_firm.full_name), v_email);

  insert into public.templates (firm_id, name)
  values (v_firm_id, 'Annual tax return (starter)')
  returning id into v_template_id;

  insert into public.template_items (template_id, firm_id, position, title, kind, required)
  values
    (v_template_id, v_firm_id, 1, 'Government-issued photo ID', 'file', true),
    (v_template_id, v_firm_id, 2, 'Income statements from all employers', 'file', true),
    (v_template_id, v_firm_id, 3, 'Bank and investment statements', 'file', false),
    (v_template_id, v_firm_id, 4, 'Receipts for deductible expenses', 'file', false),
    (v_template_id, v_firm_id, 5, 'Last year''s tax return, if we did not prepare it', 'file', false),
    (v_template_id, v_firm_id, 6, 'Did your household or dependents change this year?', 'text', true),
    (v_template_id, v_firm_id, 7, 'Anything else we should know?', 'text', false);

  return v_firm_id;
end;
$$;

revoke execute on function public.create_firm(text, text, text) from public, anon;
