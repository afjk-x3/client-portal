-- register_file and remove_file as contact c1. Uploads are simulated by
-- inserting storage.objects rows as postgres.
begin;
select plan(13);
\ir fixtures/seed.psql

-- Path prefix for the optional file item a4 of client A1.
create temp table a4 (prefix text) on commit drop;
insert into a4 values ('f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/');
grant select on a4 to authenticated;

insert into storage.objects (bucket_id, name, metadata)
select 'documents', prefix || 'w2.pdf', '{"size": 2048, "mimetype": "application/pdf"}' from a4;

select tests.login_as('00000000-0000-0000-0000-0000000000c1');

select throws_ok(
  $$ select public.register_file('10000000-0000-0000-0000-0000000000a4',
       'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a1/seed-a1.pdf', 'w2.pdf') $$,
  'P0001', 'not_allowed', 'a path outside the item prefix is rejected');
select throws_ok(
  $$ select public.register_file('10000000-0000-0000-0000-0000000000a4', (select prefix from a4) || 'missing.pdf', 'missing.pdf') $$,
  'P0001', 'not_allowed', 'a missing object is rejected');
select throws_ok(
  $$ select public.register_file('10000000-0000-0000-0000-0000000000a2',
       'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a2/10000000-0000-0000-0000-0000000000a2/seed-a2.pdf', 'x.pdf') $$,
  'P0001', 'not_allowed', 'another client''s item is not found');
select throws_ok(
  $$ select public.register_file('10000000-0000-0000-0000-0000000000a3',
       'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a3/x.pdf', 'x.pdf') $$,
  'P0001', 'invalid_state', 'a text item cannot take files');

select lives_ok(
  $$ select public.register_file('10000000-0000-0000-0000-0000000000a4', (select prefix from a4) || 'w2.pdf', 'My W-2.pdf') $$,
  'a contact can register an uploaded object');
select results_eq(
  $$ select filename, size_bytes, mime, uploaded_by from public.item_files
     where item_id = '10000000-0000-0000-0000-0000000000a4' $$,
  $$ values ('My W-2.pdf'::text, 2048::bigint, 'application/pdf'::text, '00000000-0000-0000-0000-0000000000c1'::uuid) $$,
  'size and mime come from storage metadata; uploaded_by is the caller');

-- Fill the item up to 20 files, then the 21st is rejected.
reset role;
insert into storage.objects (bucket_id, name, metadata)
select 'documents', prefix || 'bulk-' || n || '.pdf', '{"size": 1, "mimetype": "application/pdf"}'
from a4, generate_series(1, 20) n;
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select lives_ok(
  $$ select count(public.register_file('10000000-0000-0000-0000-0000000000a4',
       (select prefix from a4) || 'bulk-' || n || '.pdf', 'bulk.pdf'))
     from generate_series(1, 19) n $$,
  'an item can hold 20 files');
select throws_ok(
  $$ select public.register_file('10000000-0000-0000-0000-0000000000a4', (select prefix from a4) || 'bulk-20.pdf', 'bulk.pdf') $$,
  'P0001', 'invalid_state', 'the 21st file is rejected');

select throws_ok($$ select public.remove_file('e0000000-0000-0000-0000-0000000000a2') $$,
  'P0001', 'not_allowed', 'another client''s file cannot be removed');
select is(public.remove_file('e0000000-0000-0000-0000-0000000000a1'),
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a1/seed-a1.pdf',
  'remove_file returns the storage path');
select is_empty($$ select 1 from public.item_files where id = 'e0000000-0000-0000-0000-0000000000a1' $$,
  'the file row is deleted');

reset role;
update public.request_items set status = 'submitted' where id = '10000000-0000-0000-0000-0000000000a4';
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok(
  $$ select public.register_file('10000000-0000-0000-0000-0000000000a4', (select prefix from a4) || 'bulk-20.pdf', 'bulk.pdf') $$,
  'P0001', 'invalid_state', 'a submitted item cannot take files');
select throws_ok(
  $$ select public.remove_file((select id from public.item_files where item_id = '10000000-0000-0000-0000-0000000000a4' limit 1)) $$,
  'P0001', 'invalid_state', 'files of a submitted item cannot be removed');

select * from finish();
rollback;
