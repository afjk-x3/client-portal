-- next_schedule_date steps the series and clamps to short months;
-- save_schedule creates and edits a schedule with its client list;
-- RLS keeps other firms out and pins the unchangeable columns;
-- set_schedule_paused skips missed dates; deleting a template or
-- client cascades to schedules and their clients.
begin;
select plan(28);
\ir fixtures/seed.psql

select is(next_schedule_date(date '2027-01-31', 1, 31, date '2027-01-31'), date '2027-02-28',
  'a monthly schedule on the 31st falls back to February''s last day');
select is(next_schedule_date(date '2027-02-28', 1, 31, date '2027-02-28'), date '2027-03-31',
  'and returns to the 31st in March');
select is(next_schedule_date(date '2027-01-15', 3, 15, date '2027-01-15'), date '2027-04-15',
  'a quarterly schedule steps three months');
select is(next_schedule_date(date '2027-01-15', 12, 15, date '2027-01-15'), date '2028-01-15',
  'a yearly schedule steps twelve months');
select is(next_schedule_date(date '2027-08-31', 3, 31, date '2027-08-31'), date '2027-11-30',
  'a quarterly schedule on the 31st clamps to November''s last day');
select is(next_schedule_date(date '2027-05-31', 12, 31, date '2027-05-31'), date '2028-05-31',
  'a yearly schedule on the 31st stays on the 31st when the month has it');
select is(next_schedule_date(date '2027-01-01', 1, 1, date '2027-03-20'), date '2027-04-01',
  'it steps past to the first date after the given day');
select is(next_schedule_date(date '2027-05-01', 1, 1, date '2027-03-20'), date '2027-05-01',
  'a start already after the given day is returned as is');

create temp table schedule1 (id uuid) on commit drop;
grant all on schedule1 to authenticated;

select tests.login_as('00000000-0000-0000-0000-0000000000a1', 'admin-a@test.local');
insert into schedule1
select public.save_schedule(null, '70000000-0000-0000-0000-00000000000a', 'Monthly bookkeeping', 1,
  current_date + 10, 14,
  array['c0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000a2']::uuid[]);
select ok((select id is not null from schedule1), 'creating a schedule returns its id');
select is((select day_of_month from public.schedules where id = (select id from schedule1)),
  extract(day from current_date + 10)::smallint,
  'the day of month comes from the first send date');
select is((select count(*) from public.schedule_clients where schedule_id = (select id from schedule1)),
  2::bigint, 'both clients are on the schedule');

select public.save_schedule((select id from schedule1), null, 'Monthly bookkeeping', 1,
  null, 14, array['c0000000-0000-0000-0000-0000000000a1']::uuid[]);
select is((select next_send_on from public.schedules where id = (select id from schedule1)),
  current_date + 10, 'a null next send date keeps the current date');
select results_eq($$ select client_id from public.schedule_clients
  where schedule_id = (select id from schedule1) $$,
  $$ values ('c0000000-0000-0000-0000-0000000000a1'::uuid) $$,
  'and the client list is replaced');

insert into public.schedule_clients
values ((select id from schedule1), 'c0000000-0000-0000-0000-0000000000a2', 'f0000000-0000-0000-0000-00000000000a');
reset role;
delete from public.clients where id = 'c0000000-0000-0000-0000-0000000000a2';
select is((select count(*) from public.schedule_clients where schedule_id = (select id from schedule1)),
  1::bigint, 'deleting a client removes it from the schedule');

select tests.login_as('00000000-0000-0000-0000-0000000000a1', 'admin-a@test.local');
select throws_ok($$ select public.save_schedule(null, '70000000-0000-0000-0000-00000000000b',
  'Other firm', 1, current_date + 10, 14, array['c0000000-0000-0000-0000-0000000000a1']::uuid[]) $$,
  'P0001', 'not_allowed', 'another firm''s template cannot be scheduled');
select throws_ok($$ select public.save_schedule(null, '70000000-0000-0000-0000-00000000000a',
  'Other firm client', 1, current_date + 10, 14, array['c0000000-0000-0000-0000-0000000000b1']::uuid[]) $$,
  '23503', null, 'another firm''s client cannot be scheduled');

select tests.login_as('00000000-0000-0000-0000-0000000000b1', 'admin-b@test.local');
select is((select count(*) from public.schedules), 0::bigint,
  'another firm''s staff see no schedules');
select tests.login_as('00000000-0000-0000-0000-0000000000c1', 'contact-a1@test.local');
select is((select count(*) from public.schedules), 0::bigint,
  'contacts see no schedules');
reset role;
set local role anon;
select throws_ok($$ select count(*) from public.schedules $$, '42501', null,
  'anon cannot read schedules');
reset role;

select tests.login_as('00000000-0000-0000-0000-0000000000a2', 'staff-a@test.local');
select throws_ok($$ update public.schedules set firm_id = 'f0000000-0000-0000-0000-00000000000b' $$,
  '42501', null, 'a schedule cannot move to another firm');
select throws_ok($$ update public.schedules set template_id = '70000000-0000-0000-0000-00000000000b' $$,
  '42501', null, 'a schedule cannot change its template');
select lives_ok($$ update public.schedules set title = 'Renamed schedule' $$,
  'the title can be updated');
select throws_ok($$ update public.schedules set title = repeat('x', 181) $$,
  '23514', null, 'a title over 180 characters is refused');

select is(public.set_schedule_paused((select id from schedule1), true), (select id from schedule1),
  'pausing returns the schedule id');
select is(public.set_schedule_paused((select id from schedule1), true), null::uuid,
  'pausing again changes nothing');
reset role;
update public.schedules set next_send_on = current_date - 40 where id = (select id from schedule1);

select tests.login_as('00000000-0000-0000-0000-0000000000a1', 'admin-a@test.local');
select is(public.set_schedule_paused((select id from schedule1), false), (select id from schedule1),
  'resuming returns the schedule id');
select ok((select next_send_on > (now() at time zone 'UTC')::date
  from public.schedules where id = (select id from schedule1)),
  'and moves a passed date past today');

reset role;
delete from public.templates where id = '70000000-0000-0000-0000-00000000000a';
select is((select count(*) from public.schedules where id = (select id from schedule1)),
  0::bigint, 'deleting the template deletes its schedules');

select * from finish();
rollback;
