-- A contact sees only their own clients' sent requests and can write nothing
-- directly.
begin;
select plan(15);
\ir fixtures/seed.psql

select tests.login_as('00000000-0000-0000-0000-0000000000c1');

select results_eq($$ select id from public.requests $$,
  $$ values ('d0000000-0000-0000-0000-0000000000a1'::uuid) $$,
  'contact sees only the sent request of their client (no drafts, no other clients)');
select results_eq($$ select id from public.request_items order by position $$,
  $$ values ('10000000-0000-0000-0000-0000000000a1'::uuid),
            ('10000000-0000-0000-0000-0000000000a3'::uuid),
            ('10000000-0000-0000-0000-0000000000a4'::uuid) $$,
  'contact sees only items of visible requests');
select results_eq($$ select id from public.item_files $$,
  $$ values ('e0000000-0000-0000-0000-0000000000a1'::uuid) $$,
  'contact sees only files of visible items');
select results_eq($$ select id from public.clients $$,
  $$ values ('c0000000-0000-0000-0000-0000000000a1'::uuid) $$,
  'contact sees only their own client');
select results_eq($$ select id from public.firms $$,
  $$ values ('f0000000-0000-0000-0000-00000000000a'::uuid) $$,
  'contact sees the firm they work with');
select results_eq($$ select user_id from public.client_contacts $$,
  $$ values ('00000000-0000-0000-0000-0000000000c1'::uuid) $$,
  'contact reads only their own client_contacts row');
select is_empty($$ select 1 from public.firm_members $$, 'contact cannot read firm_members');
select is_empty($$ select 1 from public.templates $$, 'contact cannot read templates');

select is_empty($$ update public.request_items set status = 'accepted'
  where id = '10000000-0000-0000-0000-0000000000a1' returning 1 $$,
  'contact cannot update request_items directly');
select is_empty($$ update public.requests set status = 'completed' returning 1 $$,
  'contact cannot update requests');
select is_empty($$ delete from public.item_files returning 1 $$,
  'contact cannot delete item_files directly');
select throws_ok($$ insert into public.item_files (item_id, firm_id, storage_path, filename, size_bytes, mime)
  values ('10000000-0000-0000-0000-0000000000a4', 'f0000000-0000-0000-0000-00000000000a', 'x/y', 'x.pdf', 1, 'application/pdf') $$,
  '42501', null, 'contact cannot insert item_files directly');
select throws_ok($$ insert into public.clients (firm_id, name)
  values ('f0000000-0000-0000-0000-00000000000a', 'X') $$,
  '42501', null, 'contact cannot insert clients');

select tests.login_as('00000000-0000-0000-0000-0000000000d1');
select is_empty($$ select 1 from public.requests $$, 'a user with no rows sees no requests');
select is_empty($$ select 1 from public.firms $$, 'a user with no rows sees no firms');

select * from finish();
rollback;
