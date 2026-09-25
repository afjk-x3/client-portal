-- Staff can leave their firm; nobody can remove another member this way, and
-- admins cannot leave without first being made staff.
begin;
select plan(6);
\ir fixtures/seed.psql

insert into public.firm_members (firm_id, user_id, role, full_name, email)
values ('f0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000d1', 'staff', 'Nobody', 'nobody@test.local');
update public.clients set owner_id = '00000000-0000-0000-0000-0000000000a2'
  where id = 'c0000000-0000-0000-0000-0000000000a1';

select tests.login_as('00000000-0000-0000-0000-0000000000a2', 'staff-a@test.local');
select is_empty($$ delete from public.firm_members where user_id = '00000000-0000-0000-0000-0000000000d1' returning 1 $$,
  'staff cannot remove another member');
select isnt_empty($$ delete from public.firm_members where user_id = '00000000-0000-0000-0000-0000000000a2' returning 1 $$,
  'staff can leave their firm');
select is_empty($$ select 1 from public.clients $$, 'after leaving, they see none of the firm''s clients');
select lives_ok($$ select public.create_firm('A2 Own Firm', 'Staff A') $$, 'and can set up their own firm');
reset role;
select is((select owner_id from public.clients where id = 'c0000000-0000-0000-0000-0000000000a1'), null,
  'the clients they owned are left without an owner');

select tests.login_as('00000000-0000-0000-0000-0000000000a1', 'admin-a@test.local');
select is_empty($$ delete from public.firm_members where user_id = '00000000-0000-0000-0000-0000000000a1' returning 1 $$,
  'an admin cannot leave without first being made staff');

select * from finish();
rollback;
