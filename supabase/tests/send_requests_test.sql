-- send_requests: one open request per client from a template, all or none,
-- only for the caller's firm, its active clients with contacts, and a
-- template with a required item.
begin;
select plan(12);
\ir fixtures/seed.psql

insert into public.clients (id, firm_id, name, archived_at) values
  ('c0000000-0000-0000-0000-0000000000a3', 'f0000000-0000-0000-0000-00000000000a', 'No contacts', null),
  ('c0000000-0000-0000-0000-0000000000a4', 'f0000000-0000-0000-0000-00000000000a', 'Archived', now());
insert into public.client_contacts (client_id, firm_id, user_id, full_name, email) values
  ('c0000000-0000-0000-0000-0000000000a4', 'f0000000-0000-0000-0000-00000000000a',
   '00000000-0000-0000-0000-0000000000d1', 'Nobody', 'nobody@test.local');
insert into public.templates (id, firm_id, name) values
  ('70000000-0000-0000-0000-0000000000a2', 'f0000000-0000-0000-0000-00000000000a', 'Optional only');
insert into public.template_items (template_id, firm_id, position, title, kind, required) values
  ('70000000-0000-0000-0000-0000000000a2', 'f0000000-0000-0000-0000-00000000000a', 1, 'Maybe', 'file', false),
  ('70000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-00000000000a', 2, 'Anything else?', 'text', false);

select tests.login_as('00000000-0000-0000-0000-0000000000a2', 'staff-a@test.local');
select lives_ok($$ select public.send_requests('70000000-0000-0000-0000-00000000000a', '2027 taxes', '2027-04-15',
  array['c0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000a2']::uuid[],
  array['d1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002']::uuid[]) $$,
  'staff send a template to two clients');
select results_eq(
  $$ select client_id, status, title, due_date, created_by, sent_at is not null from public.requests
     where id in ('d1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002') order by id $$,
  $$ values ('c0000000-0000-0000-0000-0000000000a1'::uuid, 'open'::text, '2027 taxes'::text, '2027-04-15'::date,
             '00000000-0000-0000-0000-0000000000a2'::uuid, true),
            ('c0000000-0000-0000-0000-0000000000a2'::uuid, 'open'::text, '2027 taxes'::text, '2027-04-15'::date,
             '00000000-0000-0000-0000-0000000000a2'::uuid, true) $$,
  'each client gets an open, sent request');
select results_eq(
  $$ select title, kind, required, status from public.request_items
     where request_id = 'd1000000-0000-0000-0000-000000000001' order by position $$,
  $$ values ('Photo ID'::text, 'file'::text, true, 'requested'::text), ('Anything else?'::text, 'text'::text, false, 'requested'::text) $$,
  'with the template''s items, in order');

select throws_ok($$ select public.send_requests('70000000-0000-0000-0000-00000000000a', 'X', '2027-04-15',
  array['c0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000a4']::uuid[],
  array['d1000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-000000000004']::uuid[]) $$,
  'P0001', 'invalid_state', 'an archived client stops the whole send');
select is_empty($$ select 1 from public.requests where id = 'd1000000-0000-0000-0000-000000000003' $$,
  'and nothing is created');
select throws_ok($$ select public.send_requests('70000000-0000-0000-0000-00000000000a', 'X', '2027-04-15',
  array['c0000000-0000-0000-0000-0000000000a3']::uuid[], array['d1000000-0000-0000-0000-000000000005']::uuid[]) $$,
  'P0001', 'invalid_state', 'a client without contacts is refused');
select throws_ok($$ select public.send_requests('70000000-0000-0000-0000-00000000000a', 'X', '2027-04-15',
  array['c0000000-0000-0000-0000-0000000000b1']::uuid[], array['d1000000-0000-0000-0000-000000000006']::uuid[]) $$,
  'P0001', 'invalid_state', 'so is another firm''s client');
select throws_ok($$ select public.send_requests('70000000-0000-0000-0000-0000000000a2', 'X', '2027-04-15',
  array['c0000000-0000-0000-0000-0000000000a1']::uuid[], array['d1000000-0000-0000-0000-000000000007']::uuid[]) $$,
  'P0001', 'invalid_state', 'and a template without a required item');
select throws_ok($$ select public.send_requests('70000000-0000-0000-0000-00000000000a', 'X', '2027-04-15',
  array['c0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000a1']::uuid[],
  array['d1000000-0000-0000-0000-000000000008', 'd1000000-0000-0000-0000-000000000009']::uuid[]) $$,
  'P0001', 'not_allowed', 'a client listed twice is refused');
select throws_ok($$ select public.send_requests('70000000-0000-0000-0000-00000000000b', 'X', '2027-04-15',
  array['c0000000-0000-0000-0000-0000000000a1']::uuid[], array['d1000000-0000-0000-0000-00000000000a']::uuid[]) $$,
  'P0001', 'not_allowed', 'another firm''s template is not found');

select tests.login_as('00000000-0000-0000-0000-0000000000c1', 'contact-a1@test.local');
select throws_ok($$ select public.send_requests('70000000-0000-0000-0000-00000000000a', 'X', '2027-04-15',
  array['c0000000-0000-0000-0000-0000000000a1']::uuid[], array['d1000000-0000-0000-0000-00000000000b']::uuid[]) $$,
  'P0001', 'not_allowed', 'contacts cannot send');

reset role;
set local role anon;
select throws_ok($$ select public.send_requests('70000000-0000-0000-0000-00000000000a', 'X', '2027-04-15',
  array['c0000000-0000-0000-0000-0000000000a1']::uuid[], array['d1000000-0000-0000-0000-00000000000c']::uuid[]) $$,
  '42501', null, 'anon cannot call send_requests');

select * from finish();
rollback;
