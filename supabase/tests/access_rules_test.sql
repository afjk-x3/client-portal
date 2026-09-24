-- Access rules that guard the tenant and client boundaries: contact writes,
-- upload paths and item states, RPCs on drafts and archived requests,
-- catalog-wide guards, users with both roles, and anon.
begin;
select plan(23);
\ir fixtures/seed.psql

set local storage.allow_delete_query = 'true';

-- A contact cannot write client_contacts, not even their own row.
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ insert into public.client_contacts (client_id, firm_id, user_id, full_name, email)
  values ('c0000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-00000000000b',
          '00000000-0000-0000-0000-0000000000c1', 'Me', 'contact-a1@test.local') $$,
  '42501', null, 'a contact cannot add contact rows');
select is_empty($$ update public.client_contacts
  set client_id = 'c0000000-0000-0000-0000-0000000000b1', firm_id = 'f0000000-0000-0000-0000-00000000000b'
  where user_id = '00000000-0000-0000-0000-0000000000c1' returning 1 $$,
  'a contact cannot move their own contact row to another client');
select is_empty($$ delete from public.client_contacts
  where user_id = '00000000-0000-0000-0000-0000000000c1' returning 1 $$,
  'a contact cannot delete their own contact row');

-- Uploads need the item's own firm and an open item.
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('documents',
  'f0000000-0000-0000-0000-00000000000b/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/new.pdf') $$,
  '42501', null, 'the firm segment must match the item');
reset role;
update public.request_items set status = 'submitted' where id = '10000000-0000-0000-0000-0000000000a4';
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('documents',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/new.pdf') $$,
  '42501', null, 'a contact cannot upload to a submitted item');
reset role;
update public.request_items set status = 'accepted' where id = '10000000-0000-0000-0000-0000000000a4';
insert into storage.objects (bucket_id, name) values ('documents',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/kept.pdf');
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('documents',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/new.pdf') $$,
  '42501', null, 'a contact cannot upload to an accepted item');
select is_empty($$ delete from storage.objects where name like '%/kept.pdf' returning 1 $$,
  'a contact cannot delete from an accepted item');
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select is_empty($$ delete from storage.objects where bucket_id = 'documents' returning 1 $$,
  'staff cannot delete objects');

-- File RPCs treat drafts as not found and refuse archived requests.
reset role;
insert into storage.objects (bucket_id, name) values ('documents',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a9/draft.pdf');
insert into public.item_files (id, item_id, firm_id, storage_path, filename, size_bytes, mime) values
  ('e0000000-0000-0000-0000-0000000000a9', '10000000-0000-0000-0000-0000000000a9', 'f0000000-0000-0000-0000-00000000000a',
   'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a9/draft.pdf',
   'draft.pdf', 1, 'application/pdf');
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select public.register_file('10000000-0000-0000-0000-0000000000a9',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a9/draft.pdf', 'draft.pdf') $$,
  'P0001', 'not_allowed', 'register_file treats an item in a draft as not found');
select throws_ok($$ select public.remove_file('e0000000-0000-0000-0000-0000000000a9') $$,
  'P0001', 'not_allowed', 'remove_file treats a file in a draft as not found');
reset role;
update public.requests set status = 'archived' where id = 'd0000000-0000-0000-0000-0000000000a1';
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select public.register_file('10000000-0000-0000-0000-0000000000a1',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a1/seed-a1.pdf', 'x.pdf') $$,
  'P0001', 'invalid_state', 'register_file refuses an archived request');
select throws_ok($$ select public.remove_file('e0000000-0000-0000-0000-0000000000a1') $$,
  'P0001', 'invalid_state', 'remove_file refuses an archived request');

-- Only drafts can be deleted.
select tests.login_as('00000000-0000-0000-0000-0000000000a1');
select is_empty($$ delete from public.requests where id = 'd0000000-0000-0000-0000-0000000000a2' returning 1 $$,
  'staff cannot delete a sent request');

-- Catalog-wide guards, so a new function or policy cannot quietly open a hole.
reset role;
select is_empty($$
  select p.oid::regprocedure::text
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.prosecdef
    and (not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
         or has_function_privilege('anon', p.oid, 'execute')) $$,
  'security definer functions pin search_path and are closed to anon');
select is_empty($$ select tablename || '.' || policyname from pg_policies
  where schemaname = 'public' and roles <> '{authenticated}' $$,
  'every policy applies to signed-in users only');

-- A user who is staff of firm A and a contact of client B1.
insert into public.client_contacts (client_id, firm_id, user_id, full_name, email) values
  ('c0000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-00000000000b',
   '00000000-0000-0000-0000-0000000000a2', 'Staff A', 'staff-a@test.local');
insert into public.requests (id, firm_id, client_id, title, due_date, status) values
  ('d0000000-0000-0000-0000-0000000000b9', 'f0000000-0000-0000-0000-00000000000b',
   'c0000000-0000-0000-0000-0000000000b1', 'B1 draft', current_date + 7, 'draft');
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select results_eq($$ select id from public.requests order by id $$,
  $$ values ('d0000000-0000-0000-0000-0000000000a1'::uuid), ('d0000000-0000-0000-0000-0000000000a2'::uuid),
            ('d0000000-0000-0000-0000-0000000000a9'::uuid), ('d0000000-0000-0000-0000-0000000000b1'::uuid) $$,
  'a user with both roles sees their firm''s requests and the other firm''s sent request only');
select results_eq($$ select id from public.clients order by id $$,
  $$ values ('c0000000-0000-0000-0000-0000000000a1'::uuid), ('c0000000-0000-0000-0000-0000000000a2'::uuid),
            ('c0000000-0000-0000-0000-0000000000b1'::uuid) $$,
  'and their firm''s clients plus the client they are a contact of');
select is_empty($$ update public.requests set title = 'X'
  where id = 'd0000000-0000-0000-0000-0000000000b1' returning 1 $$,
  'but cannot change the other firm''s request');
select is_empty($$ select 1 from public.firm_members where firm_id = 'f0000000-0000-0000-0000-00000000000b' $$,
  'or read the other firm''s members');
select throws_ok($$ insert into public.clients (firm_id, name) values ('f0000000-0000-0000-0000-00000000000b', 'X') $$,
  '42501', null, 'or add clients to the other firm');

-- anon reads nothing.
reset role;
set local role anon;
select is_empty($$
  select 1 from public.firms union all select 1 from public.firm_members
  union all select 1 from public.clients union all select 1 from public.client_contacts
  union all select 1 from public.templates union all select 1 from public.template_items
  union all select 1 from public.requests union all select 1 from public.request_items
  union all select 1 from public.item_files $$,
  'anon reads no rows from any table');
select is_empty($$ select 1 from storage.objects where bucket_id = 'documents' $$,
  'anon reads no documents');
select throws_ok($$ select 1 from public.notifications_sent $$,
  '42501', null, 'anon cannot read notifications_sent');

select * from finish();
rollback;
