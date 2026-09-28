-- save_draft and send_requests store the optional message; the check keeps it
-- between 1 and 2,000 characters when present, and refuses an empty string.
begin;
select plan(9);
\ir fixtures/seed.psql

create temp table new_draft (id uuid) on commit drop;
grant all on new_draft to authenticated;

select tests.login_as('00000000-0000-0000-0000-0000000000a2');

insert into new_draft
select public.save_draft(
  client_id => 'c0000000-0000-0000-0000-0000000000a1'::uuid,
  title => 'With message',
  due_date => current_date + 7,
  items => '[]'::jsonb,
  message => 'Hi Maria');
select is((select r.message from public.requests r where r.id = (select id from new_draft)),
  'Hi Maria', 'a new draft stores the message');

select lives_ok($$ select public.save_draft(
  client_id => 'c0000000-0000-0000-0000-0000000000a1'::uuid,
  title => 'With message',
  due_date => current_date + 7,
  items => '[]'::jsonb,
  request_id => (select id from new_draft)) $$,
  'the draft can be saved again');
select is((select r.message from public.requests r where r.id = (select id from new_draft)),
  null, 'saving without a message sets it to null');

select lives_ok($$ select public.send_requests(
  template_id => '70000000-0000-0000-0000-00000000000a'::uuid,
  title => 'Bulk',
  due_date => current_date + 7,
  client_ids => array['c0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000a2']::uuid[],
  request_ids => array['d1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002']::uuid[],
  message => 'Line one' || chr(10) || 'Line two') $$,
  'a bulk send accepts a message');
select results_eq(
  $$ select message from public.requests
     where id in ('d1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002') order by id $$,
  $$ values ('Line one' || chr(10) || 'Line two'::text),
            ('Line one' || chr(10) || 'Line two'::text) $$,
  'each new request gets the message');

select lives_ok($$ select public.send_requests(
  template_id => '70000000-0000-0000-0000-00000000000a'::uuid,
  title => 'Quiet',
  due_date => current_date + 7,
  client_ids => array['c0000000-0000-0000-0000-0000000000a1']::uuid[],
  request_ids => array['d1000000-0000-0000-0000-000000000003']::uuid[]) $$,
  'a bulk send without a message still works');
select is((select message from public.requests where id = 'd1000000-0000-0000-0000-000000000003'),
  null, 'and stores null');

reset role;
select throws_ok($$ update public.requests set message = repeat('x', 2001)
  where id = 'd0000000-0000-0000-0000-0000000000a1' $$,
  '23514', null, 'a message over 2,000 characters is refused');
select throws_ok($$ update public.requests set message = ''
  where id = 'd0000000-0000-0000-0000-0000000000a1' $$,
  '23514', null, 'an empty message is refused');

select * from finish();
rollback;
