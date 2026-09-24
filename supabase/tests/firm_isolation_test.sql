-- Admin A (the most privileged firm A user) cannot touch any firm B row.
begin;
select plan(36);
\ir fixtures/seed.psql

select tests.login_as('00000000-0000-0000-0000-0000000000a1');

-- select: only firm A rows are visible
select results_eq($$ select id from public.firms $$,
  $$ values ('f0000000-0000-0000-0000-00000000000a'::uuid) $$, 'firms: only own firm');
select results_eq($$ select distinct firm_id from public.firm_members $$,
  $$ values ('f0000000-0000-0000-0000-00000000000a'::uuid) $$, 'firm_members: only own firm');
select results_eq($$ select distinct firm_id from public.clients $$,
  $$ values ('f0000000-0000-0000-0000-00000000000a'::uuid) $$, 'clients: only own firm');
select results_eq($$ select distinct firm_id from public.client_contacts $$,
  $$ values ('f0000000-0000-0000-0000-00000000000a'::uuid) $$, 'client_contacts: only own firm');
select results_eq($$ select distinct firm_id from public.templates $$,
  $$ values ('f0000000-0000-0000-0000-00000000000a'::uuid) $$, 'templates: only own firm');
select results_eq($$ select distinct firm_id from public.template_items $$,
  $$ values ('f0000000-0000-0000-0000-00000000000a'::uuid) $$, 'template_items: only own firm');
select results_eq($$ select distinct firm_id from public.requests $$,
  $$ values ('f0000000-0000-0000-0000-00000000000a'::uuid) $$, 'requests: only own firm');
select results_eq($$ select distinct firm_id from public.request_items $$,
  $$ values ('f0000000-0000-0000-0000-00000000000a'::uuid) $$, 'request_items: only own firm');
select results_eq($$ select distinct firm_id from public.item_files $$,
  $$ values ('f0000000-0000-0000-0000-00000000000a'::uuid) $$, 'item_files: only own firm');

-- insert: every firm B row is rejected
select throws_ok($$ insert into public.firms (name) values ('Sneaky') $$,
  '42501', null, 'firms: cannot insert');
select throws_ok($$ insert into public.firm_members (firm_id, user_id, role, full_name, email)
  values ('f0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000d1', 'staff', 'X', 'x@test.local') $$,
  '42501', null, 'firm_members: cannot insert into firm B');
select throws_ok($$ insert into public.clients (firm_id, name)
  values ('f0000000-0000-0000-0000-00000000000b', 'X') $$,
  '42501', null, 'clients: cannot insert into firm B');
select throws_ok($$ insert into public.client_contacts (client_id, firm_id, user_id, full_name, email)
  values ('c0000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000d1', 'X', 'x@test.local') $$,
  '42501', null, 'client_contacts: cannot insert into firm B');
select throws_ok($$ insert into public.templates (firm_id, name)
  values ('f0000000-0000-0000-0000-00000000000b', 'X') $$,
  '42501', null, 'templates: cannot insert into firm B');
select throws_ok($$ insert into public.template_items (template_id, firm_id, position, title, kind)
  values ('70000000-0000-0000-0000-00000000000b', 'f0000000-0000-0000-0000-00000000000b', 2, 'X', 'file') $$,
  '42501', null, 'template_items: cannot insert into firm B');
select throws_ok($$ insert into public.requests (firm_id, client_id, title, due_date)
  values ('f0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-0000000000b1', 'X', current_date) $$,
  '42501', null, 'requests: cannot insert into firm B');
select throws_ok($$ insert into public.request_items (request_id, firm_id, position, title, kind)
  values ('d0000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-00000000000b', 2, 'X', 'file') $$,
  '42501', null, 'request_items: cannot insert into firm B');
select throws_ok($$ insert into public.item_files (item_id, firm_id, storage_path, filename, size_bytes, mime)
  values ('10000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-00000000000b', 'x/y', 'x.pdf', 1, 'application/pdf') $$,
  '42501', null, 'item_files: cannot insert into firm B');

-- update: no firm B row is affected
select is_empty($$ update public.firms set name = 'X'
  where id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'firms: cannot update firm B');
select is_empty($$ update public.firm_members set role = 'staff'
  where firm_id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'firm_members: cannot update firm B');
select is_empty($$ update public.clients set name = 'X'
  where firm_id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'clients: cannot update firm B');
select is_empty($$ update public.client_contacts set full_name = 'X'
  where firm_id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'client_contacts: cannot update firm B');
select is_empty($$ update public.templates set name = 'X'
  where firm_id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'templates: cannot update firm B');
select is_empty($$ update public.template_items set title = 'X'
  where firm_id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'template_items: cannot update firm B');
select is_empty($$ update public.requests set title = 'X'
  where firm_id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'requests: cannot update firm B');
select is_empty($$ update public.request_items set status = 'accepted'
  where firm_id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'request_items: cannot update firm B');
select is_empty($$ update public.item_files set filename = 'x.pdf'
  where firm_id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'item_files: cannot update firm B');

-- delete: no firm B row is affected
select is_empty($$ delete from public.firms
  where id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'firms: cannot delete firm B');
select is_empty($$ delete from public.firm_members
  where firm_id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'firm_members: cannot delete firm B');
select is_empty($$ delete from public.clients
  where firm_id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'clients: cannot delete firm B');
select is_empty($$ delete from public.client_contacts
  where firm_id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'client_contacts: cannot delete firm B');
select is_empty($$ delete from public.templates
  where firm_id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'templates: cannot delete firm B');
select is_empty($$ delete from public.template_items
  where firm_id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'template_items: cannot delete firm B');
select is_empty($$ delete from public.requests
  where firm_id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'requests: cannot delete firm B');
select is_empty($$ delete from public.request_items
  where firm_id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'request_items: cannot delete firm B');
select is_empty($$ delete from public.item_files
  where firm_id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'item_files: cannot delete firm B');

select * from finish();
rollback;
