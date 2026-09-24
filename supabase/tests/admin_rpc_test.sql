begin;
select plan(3);
\ir fixtures/seed.psql

select tests.login_as('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.admin_user_id_by_email('admin-b@test.local') $$,
  '42501', null, 'signed-in users cannot look up users by email');

reset role;
set local role anon;
select throws_ok($$ select public.admin_user_id_by_email('admin-b@test.local') $$,
  '42501', null, 'anon cannot look up users by email');

reset role;
set local role service_role;
select is(public.admin_user_id_by_email('ADMIN-B@test.local'),
  '00000000-0000-0000-0000-0000000000b1'::uuid,
  'the service role can look up a user by email, case-insensitively');

select * from finish();
rollback;
