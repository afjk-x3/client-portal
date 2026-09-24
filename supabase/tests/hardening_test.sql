-- Request and item identity, the admin invariant, document read, delete and
-- overwrite rules, password stripping, and refresh_request_status under RLS.
begin;
select plan(20);
\ir fixtures/seed.psql

set local storage.allow_delete_query = 'true';

-- Requests and items keep their identity.
select tests.login_as('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ update public.requests set status = 'draft'
  where id = 'd0000000-0000-0000-0000-0000000000a1' $$,
  'P0001', 'invalid_state', 'a sent request cannot become a draft again');
select throws_ok($$ update public.requests set client_id = 'c0000000-0000-0000-0000-0000000000a2'
  where id = 'd0000000-0000-0000-0000-0000000000a1' $$,
  'P0001', 'invalid_state', 'a request cannot move to another client');
select throws_ok($$ update public.request_items set request_id = 'd0000000-0000-0000-0000-0000000000a2'
  where id = '10000000-0000-0000-0000-0000000000a4' $$,
  'P0001', 'invalid_state', 'an item cannot move to another request');
select isnt_empty($$ update public.requests set status = 'open', sent_at = now()
  where id = 'd0000000-0000-0000-0000-0000000000a9' returning 1 $$,
  'a draft can still be sent');

-- Every firm keeps an admin, even for callers that bypass RLS.
reset role;
select throws_ok($$ update public.firm_members set role = 'staff'
  where user_id = '00000000-0000-0000-0000-0000000000b1' $$,
  'P0001', 'invalid_state', 'the last admin cannot be demoted');
select throws_ok($$ delete from public.firm_members
  where user_id = '00000000-0000-0000-0000-0000000000b1' $$,
  'P0001', 'invalid_state', 'the last admin cannot be removed');
update public.firm_members set role = 'admin' where user_id = '00000000-0000-0000-0000-0000000000a2';
select lives_ok($$ update public.firm_members set role = 'staff'
  where user_id = '00000000-0000-0000-0000-0000000000a1' $$,
  'an admin can be demoted while another admin remains');
insert into public.firms (id, name) values ('f0000000-0000-0000-0000-00000000000c', 'Firm C');
insert into public.firm_members (firm_id, user_id, role, full_name, email)
values ('f0000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000d1', 'admin', 'Nobody', 'nobody@test.local');
select lives_ok($$ delete from public.firms where id = 'f0000000-0000-0000-0000-00000000000c' $$,
  'deleting a firm removes its last admin with it');

-- Documents.
insert into storage.objects (bucket_id, name) values
  ('documents', 'f0000000-0000-0000-0000-00000000000b/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/wrong-firm.pdf'),
  ('documents', 'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a1/unregistered.pdf');

select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select is_empty($$ select 1 from storage.objects where name like 'f0000000-0000-0000-0000-00000000000b/%' $$,
  'a contact cannot read an object whose firm segment is not their client''s firm');
select is_empty($$ delete from storage.objects where name like '%/seed-a1.pdf' returning 1 $$,
  'a contact cannot delete an object that is registered as a file');
select isnt_empty($$ delete from storage.objects where name like '%/unregistered.pdf' returning 1 $$,
  'a contact can delete an unregistered upload');
select lives_ok($$ select public.remove_file('e0000000-0000-0000-0000-0000000000a1') $$,
  'remove_file deletes the file row');
select isnt_empty($$ delete from storage.objects where name like '%/seed-a1.pdf' returning 1 $$,
  'after remove_file, the contact can delete the object');

reset role;
set local role service_role;
select throws_ok($$ insert into storage.objects (bucket_id, name, version)
  values ('documents', 'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a2/10000000-0000-0000-0000-0000000000a2/seed-a2.pdf', 'v2')
  on conflict (bucket_id, name) do update set version = excluded.version $$,
  'P0001', 'invalid_state', 'an upsert cannot replace a document, even as the storage service');
select lives_ok($$ update storage.objects set metadata = '{"size": 100, "mimetype": "application/pdf", "eTag": "e1"}'
  where name like '%/seed-a2.pdf' $$,
  'metadata updates still work');

-- Passwords are never stored.
reset role;
insert into auth.users (id, email, encrypted_password)
values ('00000000-0000-0000-0000-0000000000e1', 'password@test.local', '$2a$10$abcdefghijklmnopqrstuv');
select is((select encrypted_password from auth.users where id = '00000000-0000-0000-0000-0000000000e1'),
  '', 'a password set on sign-up is not stored');
update auth.users set encrypted_password = '$2a$10$abcdefghijklmnopqrstuv'
where id = '00000000-0000-0000-0000-0000000000e1';
select is((select encrypted_password from auth.users where id = '00000000-0000-0000-0000-0000000000e1'),
  '', 'a password set later is not stored');

-- refresh_request_status locks and updates only rows the caller may update.
update public.requests set status = 'completed' where id = 'd0000000-0000-0000-0000-0000000000a2';
select tests.login_as('00000000-0000-0000-0000-0000000000c2');
select lives_ok($$ select public.refresh_request_status('d0000000-0000-0000-0000-0000000000a2') $$,
  'a contact can call refresh_request_status');
reset role;
select is((select status from public.requests where id = 'd0000000-0000-0000-0000-0000000000a2'),
  'completed', 'but it changes nothing for them');
select tests.login_as('00000000-0000-0000-0000-0000000000a1');
select public.refresh_request_status('d0000000-0000-0000-0000-0000000000a2');
reset role;
select is((select status from public.requests where id = 'd0000000-0000-0000-0000-0000000000a2'),
  'open', 'a staff call recomputes the status');

select * from finish();
rollback;
