-- "I don't have this": mark_unavailable as contact c1 (client A1).
-- Item a4: optional file item with no files; a1: file item with a file;
-- a3: text item; a9: in a draft request.
begin;
select plan(21);
\ir fixtures/seed.psql

select tests.login_as('00000000-0000-0000-0000-0000000000c2');
select throws_ok($$ select public.mark_unavailable('10000000-0000-0000-0000-0000000000a4', 'No account') $$,
  'P0001', 'not_allowed', 'another client''s contact cannot answer');
select tests.login_as('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.mark_unavailable('10000000-0000-0000-0000-0000000000a4', 'No account') $$,
  'P0001', 'not_allowed', 'staff who are not contacts cannot answer');

select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select public.mark_unavailable('10000000-0000-0000-0000-0000000000a9', 'No account') $$,
  'P0001', 'not_allowed', 'an item in a draft is not found');
select throws_ok($$ select public.mark_unavailable('10000000-0000-0000-0000-0000000000a3', 'No account') $$,
  'P0001', 'invalid_state', 'a written-answer item is refused');
select throws_ok($$ select public.mark_unavailable('10000000-0000-0000-0000-0000000000a1', 'No account') $$,
  'P0001', 'invalid_state', 'an item with files is refused');
select throws_ok($$ select public.mark_unavailable('10000000-0000-0000-0000-0000000000a4', '   ') $$,
  'P0001', 'invalid_state', 'a blank reason is refused');
select throws_ok($$ select public.mark_unavailable('10000000-0000-0000-0000-0000000000a4', repeat('x', 1001)) $$,
  'P0001', 'invalid_state', 'a reason over 1,000 characters is refused');

select lives_ok($$ select public.mark_unavailable('10000000-0000-0000-0000-0000000000a4', '  No account  ') $$,
  'a contact answers an empty file item');
select results_eq(
  $$ select status, unavailable_reason, submitted_at is not null from public.request_items
     where id = '10000000-0000-0000-0000-0000000000a4' $$,
  $$ values ('submitted'::text, 'No account'::text, true) $$,
  'the item is submitted with the trimmed reason');
select throws_ok($$ select public.mark_unavailable('10000000-0000-0000-0000-0000000000a4', 'Again') $$,
  'P0001', 'invalid_state', 'a submitted item cannot be answered again');

-- The timeline is firm-only; read it as postgres.
reset role;
select results_eq(
  $$ select detail from public.request_events
     where item_id = '10000000-0000-0000-0000-0000000000a4' and kind = 'submitted' $$,
  $$ values ('{"reason": "No account"}'::jsonb) $$,
  'the submitted event carries the reason');

update public.request_items set status = 'needs_changes', review_note = 'Check the bank app'
  where id = '10000000-0000-0000-0000-0000000000a4';
select results_eq(
  $$ select unavailable_reason from public.request_items
     where id = '10000000-0000-0000-0000-0000000000a4' $$,
  $$ values ('No account'::text) $$,
  'sending back keeps the reason');

select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$ select public.mark_unavailable('10000000-0000-0000-0000-0000000000a4', 'Closed the account') $$,
  'an item sent back can be answered again');
select results_eq(
  $$ select unavailable_reason from public.request_items
     where id = '10000000-0000-0000-0000-0000000000a4' $$,
  $$ values ('Closed the account'::text) $$,
  'the new reason replaces the old one');

reset role;
insert into public.item_files (item_id, firm_id, storage_path, filename, size_bytes, mime, by_staff)
values ('10000000-0000-0000-0000-0000000000a4', 'f0000000-0000-0000-0000-00000000000a',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/staff-a4.pdf',
  'staff-a4.pdf', 100, 'application/pdf', true);
select ok(
  (select unavailable_reason is null from public.request_items
   where id = '10000000-0000-0000-0000-0000000000a4'),
  'a file added to the item clears the reason');

update public.request_items set status = 'needs_changes', review_note = 'Still needed'
  where id = '10000000-0000-0000-0000-0000000000a4';
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$ select public.submit_item('10000000-0000-0000-0000-0000000000a4') $$,
  'a normal submission after a send-back works');
select ok(
  (select status = 'submitted' and unavailable_reason is null
   from public.request_items where id = '10000000-0000-0000-0000-0000000000a4'),
  'a normal submission leaves no old reason');

reset role;
insert into public.request_items (id, request_id, firm_id, position, title, kind, required)
values ('10000000-0000-0000-0000-0000000000a5', 'd0000000-0000-0000-0000-0000000000a1',
  'f0000000-0000-0000-0000-00000000000a', 4, 'A5 file', 'file', true);
update public.request_items set status = 'accepted'
  where id in ('10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a3');
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select public.mark_unavailable('10000000-0000-0000-0000-0000000000a5', 'Never had one');
select tests.login_as('00000000-0000-0000-0000-0000000000a1');
update public.request_items set status = 'accepted'
  where id = '10000000-0000-0000-0000-0000000000a5';

reset role;
select results_eq(
  $$ select status, unavailable_reason from public.request_items
     where id = '10000000-0000-0000-0000-0000000000a5' $$,
  $$ values ('accepted'::text, 'Never had one'::text) $$,
  'accepting keeps the reason');
select results_eq(
  $$ select status from public.requests
     where id = 'd0000000-0000-0000-0000-0000000000a1' $$,
  $$ values ('completed'::text) $$,
  'accepting the answer completes the request');
select throws_ok($$ update public.request_items set unavailable_reason = 'x'
     where id = '10000000-0000-0000-0000-0000000000a3' $$,
  '23514', null, 'the column refuses a reason on a written-answer item');

set local role anon;
select throws_ok($$ select public.mark_unavailable('10000000-0000-0000-0000-0000000000a4', 'x') $$,
  '42501', null, 'anon cannot call mark_unavailable');

select * from finish();
rollback;
