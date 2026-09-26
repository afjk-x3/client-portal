-- orphaned_documents: stored files no item points to, older than the cutoff.
-- Results are filtered to the fixture's firm, so older files in a local database do not interfere.
begin;
select plan(5);
\ir fixtures/seed.psql

insert into storage.objects (bucket_id, name, created_at) values
  ('documents', 'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/older.pdf', now() - interval '3 days'),
  ('documents', 'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/old.pdf', now() - interval '2 days'),
  ('documents', 'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/recent.pdf', now() - interval '1 hour');
-- A registered file that is also old.
update storage.objects set created_at = now() - interval '2 days'
where name = 'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a1/seed-a1.pdf';

-- max_rows is raised where a local database's own orphans could push the fixture's past the cap.
set local role service_role;
select results_eq(
  $$ select o from public.orphaned_documents(max_rows => 100000) o where o like 'f0000000-0000-0000-0000-00000000000a/%' $$,
  $$ values ('f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/older.pdf'),
            ('f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/old.pdf') $$,
  'unregistered files older than a day, oldest first');
select is((select count(*)::int from public.orphaned_documents(max_rows => 1)), 1, 'at most max_rows');
select is((select count(*)::int from public.orphaned_documents(older_than => '30 minutes', max_rows => 100000) o
  where o like 'f0000000-0000-0000-0000-00000000000a/%'), 3, 'a shorter cutoff includes newer orphans');

reset role;
select tests.login_as('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.orphaned_documents() $$, '42501', null, 'signed-in users cannot list orphans');
reset role;
set local role anon;
select throws_ok($$ select public.orphaned_documents() $$, '42501', null, 'nor can anon');

select * from finish();
rollback;
