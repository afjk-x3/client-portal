-- Staff upload files for a client: file items of their firm's open requests
-- that are not accepted yet. Each side removes only its own files.
begin;
select plan(16);
\ir fixtures/seed.psql

set local storage.allow_delete_query = 'true';

-- Paths for the optional file item a4 and the required file item a1 of client A1.
create temp table p (a4 text, a1 text) on commit drop;
insert into p values (
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a1/');
grant select on p to authenticated;
insert into storage.objects (bucket_id, name, metadata)
select 'documents', a4 || name, '{"size": 10, "mimetype": "application/pdf"}'
from p, (values ('staff.pdf'), ('client.pdf')) as f(name);

select tests.login_as('00000000-0000-0000-0000-0000000000a2', 'staff-a@test.local');
select lives_ok($$ insert into storage.objects (bucket_id, name) values ('documents', (select a4 from p) || 'upload.pdf') $$,
  'staff can upload to an open file item of their firm');
select isnt_empty($$ delete from storage.objects where name = (select a4 from p) || 'upload.pdf' returning 1 $$,
  'and delete that upload while it is not registered');
create temp table staff_file on commit drop as
select public.register_file('10000000-0000-0000-0000-0000000000a4', (select a4 from p) || 'staff.pdf', 'Scan.pdf') as id;
select is((select by_staff from public.item_files where id = (select id from staff_file)), true,
  'a file staff register is marked as the firm''s');
select throws_ok($$ select public.register_file('10000000-0000-0000-0000-0000000000b1',
  'f0000000-0000-0000-0000-00000000000b/c0000000-0000-0000-0000-0000000000b1/10000000-0000-0000-0000-0000000000b1/x.pdf', 'x.pdf') $$,
  'P0001', 'not_allowed', 'staff cannot register files in another firm');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('documents',
  'f0000000-0000-0000-0000-00000000000b/c0000000-0000-0000-0000-0000000000b1/10000000-0000-0000-0000-0000000000b1/x.pdf') $$,
  '42501', null, 'or upload there');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('documents',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a3/x.pdf') $$,
  '42501', null, 'staff cannot upload to a text item');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('documents',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a9/x.pdf') $$,
  '42501', null, 'or to a draft');

select tests.login_as('00000000-0000-0000-0000-0000000000c1', 'contact-a1@test.local');
create temp table client_file on commit drop as
select public.register_file('10000000-0000-0000-0000-0000000000a4', (select a4 from p) || 'client.pdf', 'Mine.pdf') as id;
select is((select by_staff from public.item_files where id = (select id from client_file)), false,
  'a file a contact registers is the client''s');
select throws_ok($$ select public.remove_file((select id from staff_file)) $$,
  'P0001', 'not_allowed', 'a contact cannot remove the firm''s file');

select tests.login_as('00000000-0000-0000-0000-0000000000a2', 'staff-a@test.local');
select throws_ok($$ select public.remove_file((select id from client_file)) $$,
  'P0001', 'not_allowed', 'staff cannot remove the client''s file');
select is(public.remove_file((select id from staff_file)), (select a4 from p) || 'staff.pdf',
  'staff remove the firm''s file and get its path');

-- A submitted item: staff may still add to it, the contact may not.
reset role;
update public.request_items set status = 'submitted' where id = '10000000-0000-0000-0000-0000000000a1';
select tests.login_as('00000000-0000-0000-0000-0000000000a2', 'staff-a@test.local');
select lives_ok($$ insert into storage.objects (bucket_id, name, metadata)
  values ('documents', (select a1 from p) || 'late.pdf', '{"size": 10, "mimetype": "application/pdf"}') $$,
  'staff can add to a submitted item');
select lives_ok($$ select public.register_file('10000000-0000-0000-0000-0000000000a1', (select a1 from p) || 'late.pdf', 'Late.pdf') $$,
  'and register it');
select tests.login_as('00000000-0000-0000-0000-0000000000c1', 'contact-a1@test.local');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('documents', (select a1 from p) || 'more.pdf') $$,
  '42501', null, 'the contact cannot add to a submitted item');

-- An accepted item is closed to everyone.
reset role;
update public.request_items set status = 'accepted' where id = '10000000-0000-0000-0000-0000000000a1';
insert into storage.objects (bucket_id, name, metadata)
select 'documents', a1 || 'after.pdf', '{"size": 10, "mimetype": "application/pdf"}' from p;
select tests.login_as('00000000-0000-0000-0000-0000000000a2', 'staff-a@test.local');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('documents', (select a1 from p) || 'x.pdf') $$,
  '42501', null, 'staff cannot upload to an accepted item');
select throws_ok($$ select public.register_file('10000000-0000-0000-0000-0000000000a1', (select a1 from p) || 'after.pdf', 'x.pdf') $$,
  'P0001', 'invalid_state', 'or register a file there');

select * from finish();
rollback;
