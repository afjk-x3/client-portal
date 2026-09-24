-- submit_item as contact c1 (client A1). Item a1: file with one file;
-- a3: text; a4: optional file with no files; a9: in a draft.
begin;
select plan(14);
\ir fixtures/seed.psql

select tests.login_as('00000000-0000-0000-0000-0000000000c1');

select throws_ok($$ select public.submit_item('10000000-0000-0000-0000-0000000000a3') $$,
  'P0001', 'invalid_state', 'a text item needs an answer');
select throws_ok($$ select public.submit_item('10000000-0000-0000-0000-0000000000a3', '   ') $$,
  'P0001', 'invalid_state', 'a blank answer is rejected');
select throws_ok($$ select public.submit_item('10000000-0000-0000-0000-0000000000a3', repeat('x', 5001)) $$,
  'P0001', 'invalid_state', 'an answer over 5,000 characters is rejected');
select throws_ok($$ select public.submit_item('10000000-0000-0000-0000-0000000000a4') $$,
  'P0001', 'invalid_state', 'a file item needs at least one file');
select throws_ok($$ select public.submit_item('10000000-0000-0000-0000-0000000000a2') $$,
  'P0001', 'not_allowed', 'another client''s item is not found');
select throws_ok($$ select public.submit_item('10000000-0000-0000-0000-0000000000a9') $$,
  'P0001', 'not_allowed', 'an item in a draft is not found');

select lives_ok($$ select public.submit_item('10000000-0000-0000-0000-0000000000a3', '  No changes  ') $$,
  'a text item with an answer can be submitted');
select results_eq(
  $$ select status, text_answer, submitted_at is not null from public.request_items
     where id = '10000000-0000-0000-0000-0000000000a3' $$,
  $$ values ('submitted'::text, 'No changes'::text, true) $$,
  'the item is submitted with the trimmed answer and a timestamp');
select throws_ok($$ select public.submit_item('10000000-0000-0000-0000-0000000000a3', 'Again') $$,
  'P0001', 'invalid_state', 'a submitted item cannot be submitted again');

select lives_ok($$ select public.submit_item('10000000-0000-0000-0000-0000000000a1') $$,
  'a file item with a file can be submitted');

reset role;
update public.request_items set status = 'needs_changes', review_note = 'Wrong year'
where id = '10000000-0000-0000-0000-0000000000a1';
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$ select public.submit_item('10000000-0000-0000-0000-0000000000a1') $$,
  'an item returned with needs_changes can be submitted again');

reset role;
update public.requests set status = 'archived' where id = 'd0000000-0000-0000-0000-0000000000a1';
update public.request_items set status = 'requested' where id = '10000000-0000-0000-0000-0000000000a3';
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select public.submit_item('10000000-0000-0000-0000-0000000000a3', 'Late') $$,
  'P0001', 'invalid_state', 'items of an archived request cannot be submitted');

select tests.login_as('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.submit_item('10000000-0000-0000-0000-0000000000a3', 'Staff') $$,
  'P0001', 'not_allowed', 'staff cannot submit items');

reset role;
set local role anon;
select throws_ok($$ select public.submit_item('10000000-0000-0000-0000-0000000000a3', 'Anon') $$,
  '42501', null, 'anon cannot call submit_item');

select * from finish();
rollback;
