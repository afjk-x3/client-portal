begin;
select plan(5);
\ir fixtures/seed.psql

select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0,
  'RLS is enabled on every public table'
);

select throws_ok(
  $$ insert into public.requests (firm_id, client_id, title, due_date)
     values ('f0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000b1', 'Cross firm', current_date) $$,
  '23503', null,
  'a request cannot point at another firm''s client'
);

select throws_ok(
  $$ insert into public.item_files (item_id, firm_id, storage_path, filename, size_bytes, mime)
     values ('10000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-00000000000a', 'x', 'x.pdf', 1, 'application/pdf') $$,
  '23503', null,
  'a file cannot point at another firm''s item'
);

select tests.login_as('00000000-0000-0000-0000-0000000000a1');

select throws_ok(
  $$ select * from public.notifications_sent $$,
  '42501', null,
  'signed-in users cannot read notifications_sent'
);

select throws_ok(
  $$ update public.firms set plan = 'pro' $$,
  '42501', null,
  'signed-in users cannot change a firm''s plan'
);

select * from finish();
rollback;
