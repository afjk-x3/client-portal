begin;
select plan(11);
\ir fixtures/seed.psql

-- Staff (non-admin) cannot manage members or the firm.
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$ insert into public.firm_members (firm_id, user_id, role, full_name, email)
  values ('f0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000d1', 'staff', 'New', 'nobody@test.local') $$,
  '42501', null, 'staff cannot add members');
select is_empty($$ update public.firm_members set role = 'admin'
  where user_id = '00000000-0000-0000-0000-0000000000a2' returning 1 $$,
  'staff cannot promote themselves');
select is_empty($$ delete from public.firm_members
  where user_id = '00000000-0000-0000-0000-0000000000a1' returning 1 $$,
  'staff cannot remove members');
select is_empty($$ update public.firms set name = 'Renamed' returning 1 $$,
  'staff cannot rename the firm');

-- Admins manage everyone except themselves.
select tests.login_as('00000000-0000-0000-0000-0000000000a1');
select is_empty($$ update public.firm_members set role = 'staff'
  where user_id = '00000000-0000-0000-0000-0000000000a1' returning 1 $$,
  'admin cannot change their own role');
select is_empty($$ delete from public.firm_members
  where user_id = '00000000-0000-0000-0000-0000000000a1' returning 1 $$,
  'admin cannot remove themselves');
select isnt_empty($$ update public.firm_members set role = 'admin'
  where user_id = '00000000-0000-0000-0000-0000000000a2' returning 1 $$,
  'admin can change another member''s role');
select lives_ok($$ insert into public.firm_members (firm_id, user_id, role, full_name, email)
  values ('f0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000d1', 'staff', 'New', 'nobody@test.local') $$,
  'admin can add a member');
select throws_ok($$ insert into public.firm_members (firm_id, user_id, role, full_name, email)
  values ('f0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b1', 'staff', 'B', 'admin-b@test.local') $$,
  '23505', null, 'a user cannot join a second firm');
select isnt_empty($$ delete from public.firm_members
  where user_id = '00000000-0000-0000-0000-0000000000d1' returning 1 $$,
  'admin can remove another member');
select isnt_empty($$ update public.firms set name = 'Renamed' returning 1 $$,
  'admin can rename the firm');

select * from finish();
rollback;
