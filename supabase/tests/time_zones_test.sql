-- Firm time zones: set at signup, changed by admins only, and always a name
-- Postgres knows.
begin;
select plan(10);
\ir fixtures/seed.psql

select is((select time_zone from public.firms where id = 'f0000000-0000-0000-0000-00000000000a'),
  'UTC', 'a firm starts in UTC');

select tests.login_as('00000000-0000-0000-0000-0000000000d1', 'nobody@test.local');
select throws_ok($$ select public.create_firm('Nowhere', 'Nobody', 'Mars/Olympus_Mons') $$,
  'P0001', 'invalid_time_zone', 'create_firm rejects an unknown time zone');
select throws_ok($$ select public.create_firm('Nowhere', 'Nobody', 'Factory') $$,
  'P0001', 'invalid_time_zone', 'and Postgres-only names the app cannot format');
create temp table manila on commit drop as
select public.create_firm('Manila Firm', 'Nobody', 'Asia/Manila') as id;
select is((select time_zone from public.firms where id = (select id from manila)),
  'Asia/Manila', 'create_firm stores the time zone');

select tests.login_as('00000000-0000-0000-0000-0000000000a1', 'admin-a@test.local');
select isnt_empty($$ update public.firms set time_zone = 'America/New_York'
  where id = 'f0000000-0000-0000-0000-00000000000a' returning 1 $$,
  'an admin can change the time zone');
select throws_ok($$ update public.firms set time_zone = 'EST-ish'
  where id = 'f0000000-0000-0000-0000-00000000000a' $$,
  'P0001', 'invalid_time_zone', 'but not to an unknown one');
select throws_ok($$ update public.firms set time_zone = 'posix/Asia/Tokyo'
  where id = 'f0000000-0000-0000-0000-00000000000a' $$,
  'P0001', 'invalid_time_zone', 'nor to a posix/ copy of a real one');

select tests.login_as('00000000-0000-0000-0000-0000000000a2', 'staff-a@test.local');
select is_empty($$ update public.firms set time_zone = 'Europe/Paris'
  where id = 'f0000000-0000-0000-0000-00000000000a' returning 1 $$,
  'staff who are not admins cannot change it');

select tests.login_as('00000000-0000-0000-0000-0000000000c1', 'contact-a1@test.local');
select is_empty($$ update public.firms set time_zone = 'Europe/Paris'
  where id = 'f0000000-0000-0000-0000-00000000000a' returning 1 $$,
  'contacts cannot change it');
select throws_ok($$ update public.firms set plan = 'pro' where id = 'f0000000-0000-0000-0000-00000000000a' $$,
  '42501', null, 'the plan column stays closed');

select * from finish();
rollback;
