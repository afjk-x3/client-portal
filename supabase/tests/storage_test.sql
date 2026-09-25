-- storage.objects policies for the documents bucket.
begin;
select plan(15);
\ir fixtures/seed.psql

set local storage.allow_delete_query = 'true';

select tests.login_as('00000000-0000-0000-0000-0000000000c1');

select lives_ok($$ insert into storage.objects (bucket_id, name) values ('documents',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/new.pdf') $$,
  'a contact can upload to an open file item of their client');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('documents',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a3/new.pdf') $$,
  '42501', null, 'a contact cannot upload to a text item');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('documents',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a2/10000000-0000-0000-0000-0000000000a2/new.pdf') $$,
  '42501', null, 'a contact cannot upload to another client''s item');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('documents',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a2/10000000-0000-0000-0000-0000000000a4/new.pdf') $$,
  '42501', null, 'the client segment must match the item');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('documents',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/extra/new.pdf') $$,
  '42501', null, 'paths must have exactly four segments');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('documents', 'not/a/valid/path.pdf') $$,
  '42501', null, 'a malformed path is rejected without a cast error');
select is(public.can_read_document('garbage'), false, 'can_read_document returns false for garbage');

select results_eq($$ select name from storage.objects where bucket_id = 'documents' order by name $$,
  $$ values ('f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a1/seed-a1.pdf'),
            ('f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/new.pdf') $$,
  'a contact reads only their client''s objects');
select is_empty($$ update storage.objects set name = name || '.bak' returning 1 $$,
  'objects can never be overwritten');
select is_empty($$ delete from storage.objects
  where name like 'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a2/%' returning 1 $$,
  'a contact cannot delete another client''s object');
select isnt_empty($$ delete from storage.objects
  where name like '%/10000000-0000-0000-0000-0000000000a4/new.pdf' returning 1 $$,
  'a contact can delete from an open file item');

reset role;
update public.requests set status = 'archived' where id = 'd0000000-0000-0000-0000-0000000000a1';
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('documents',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/late.pdf') $$,
  '42501', null, 'a contact cannot upload once the request is closed');

select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select results_eq($$ select name from storage.objects where bucket_id = 'documents' order by name $$,
  $$ values ('f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a1/seed-a1.pdf'),
            ('f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a2/10000000-0000-0000-0000-0000000000a2/seed-a2.pdf') $$,
  'staff read only their own firm''s objects');
select lives_ok($$ insert into storage.objects (bucket_id, name) values ('documents',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a2/10000000-0000-0000-0000-0000000000a2/staff.pdf') $$,
  'staff can upload to an open file item of their firm');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('documents',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/staff.pdf') $$,
  '42501', null, 'but not once the request is closed');

select * from finish();
rollback;
