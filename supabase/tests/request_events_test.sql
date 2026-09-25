-- request_events: what each change records, who can read it, and that nobody can change it.
begin;
select plan(31);
\ir fixtures/seed.psql

-- The fixture's own inserts recorded events; start from none.
delete from public.request_events;

-- Kinds recorded for a request, oldest first.
create function pg_temp.kinds(request uuid) returns text[] language sql as $$
  select coalesce(array_agg(e.kind order by e.id), '{}') from public.request_events e where e.request_id = request
$$;

-- Staff edit the details of a sent request.
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$ update public.requests set title = 'A1 renamed', due_date = due_date + 1
  where id = 'd0000000-0000-0000-0000-0000000000a1' $$, 'staff edit a sent request');
reset role;
select is(pg_temp.kinds('d0000000-0000-0000-0000-0000000000a1'), array['details_changed'], 'one event for both fields');
select is((select detail -> 'title' from public.request_events where kind = 'details_changed'),
  '["A1 open", "A1 renamed"]'::jsonb, 'with the old and new title');
select is((select actor_id from public.request_events where kind = 'details_changed'),
  '00000000-0000-0000-0000-0000000000a2'::uuid, 'and who made it');

-- The contact adds a file and submits; staff accept both required items, which completes the request.
insert into storage.objects (bucket_id, name, metadata, owner_id) values ('documents',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/receipt.pdf',
  '{"size": 10, "mimetype": "application/pdf"}', '00000000-0000-0000-0000-0000000000c1');
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$ select public.register_file('10000000-0000-0000-0000-0000000000a4',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/receipt.pdf',
  'receipt.pdf') $$, 'the contact adds a file');
select lives_ok($$ select public.submit_item('10000000-0000-0000-0000-0000000000a1') $$, 'and submits the file item');
select lives_ok($$ select public.submit_item('10000000-0000-0000-0000-0000000000a3', 'No changes') $$, 'and the text item');
-- One statement per item, as the app does. One statement for both would fire the
-- completion from the first row's trigger, between the two accepted events.
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$ update public.request_items set status = 'accepted' where id = '10000000-0000-0000-0000-0000000000a1' $$,
  'staff accept the file item');
select lives_ok($$ update public.request_items set status = 'accepted' where id = '10000000-0000-0000-0000-0000000000a3' $$,
  'and the text item, which completes the request');
reset role;
select is(pg_temp.kinds('d0000000-0000-0000-0000-0000000000a1'),
  array['details_changed', 'file_added', 'submitted', 'submitted', 'accepted', 'accepted', 'completed'],
  'each change is an event, and item events come before the completion they cause');
select is((select detail from public.request_events where kind = 'file_added'),
  '{"filename": "receipt.pdf", "by_staff": false}'::jsonb, 'a file event keeps the name and who added it');

-- Returning an item reopens the request.
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$ update public.request_items set status = 'needs_changes', review_note = 'Wrong year'
  where id = '10000000-0000-0000-0000-0000000000a3' $$, 'staff return an item');
reset role;
select is((select array_agg(kind order by id) from (select id, kind from public.request_events
  where request_id = 'd0000000-0000-0000-0000-0000000000a1' order by id desc limit 2) last_two),
  array['returned', 'reopened'], 'the return, then the request reopens');
select is((select detail ->> 'note' from public.request_events where kind = 'returned'), 'Wrong year',
  'a return keeps its note');

-- Reminders by staff and by the daily job, which has no user.
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$ select public.claim_reminder('d0000000-0000-0000-0000-0000000000a1') $$, 'staff send a reminder');
reset role;
set local request.jwt.claims = '{}';
insert into public.notifications_sent (kind, target_id, sent_on)
values ('reminder', 'd0000000-0000-0000-0000-0000000000a1', current_date + 1);
select results_eq(
  $$ select actor_id, detail ->> 'manual' from public.request_events where kind = 'reminder_sent' order by id $$,
  $$ values ('00000000-0000-0000-0000-0000000000a2'::uuid, 'true'), (null::uuid, 'false') $$,
  'reminders record who sent them');

-- Archive and unarchive.
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$ update public.requests set status = 'archived' where id = 'd0000000-0000-0000-0000-0000000000a2' $$,
  'staff archive a request');
select lives_ok($$ update public.requests set status = 'open' where id = 'd0000000-0000-0000-0000-0000000000a2' $$,
  'and unarchive it');
reset role;
select is(pg_temp.kinds('d0000000-0000-0000-0000-0000000000a2'), array['archived', 'unarchived'],
  'archive and unarchive are events');

-- Items added to and removed from a sent request.
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$ insert into public.request_items (id, request_id, firm_id, position, title, kind, required)
  values ('10000000-0000-0000-0000-0000000000a8', 'd0000000-0000-0000-0000-0000000000a2',
          'f0000000-0000-0000-0000-00000000000a', 2, 'Late item', 'text', false) $$, 'staff add an item');
select lives_ok($$ select public.remove_item('10000000-0000-0000-0000-0000000000a8') $$, 'and remove it');
reset role;
select results_eq(
  $$ select kind, detail ->> 'title' from public.request_events
     where request_id = 'd0000000-0000-0000-0000-0000000000a2' and kind like 'item_%' order by id $$,
  $$ values ('item_added'::text, 'Late item'::text), ('item_removed', 'Late item') $$,
  'item events keep the title');

-- A draft records nothing until it is sent.
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$ update public.requests set title = 'Draft renamed' where id = 'd0000000-0000-0000-0000-0000000000a9' $$,
  'staff edit a draft');
select lives_ok($$ update public.requests set status = 'open', sent_at = now()
  where id = 'd0000000-0000-0000-0000-0000000000a9' $$, 'then send it');
reset role;
select is(pg_temp.kinds('d0000000-0000-0000-0000-0000000000a9'), array['sent'], 'only the send is recorded');

-- Who can read and write.
select tests.login_as('00000000-0000-0000-0000-0000000000b1');
select is_empty($$ select 1 from public.request_events where request_id = 'd0000000-0000-0000-0000-0000000000a1' $$,
  'another firm reads nothing');
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select is_empty($$ select 1 from public.request_events $$, 'contacts read nothing');
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$ insert into public.request_events (firm_id, request_id, kind)
  values ('f0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-0000000000a1', 'sent') $$,
  '42501', null, 'staff cannot write events');
select throws_ok($$ update public.request_events set kind = 'sent' $$, '42501', null, 'or change them');
select throws_ok($$ delete from public.request_events $$, '42501', null, 'or delete them');

-- A cascading delete (a client removed by hand) never fails on its events.
reset role;
select lives_ok($$ delete from public.clients where id = 'c0000000-0000-0000-0000-0000000000a2' $$,
  'deleting a client removes its requests, their files, and their events');

select * from finish();
rollback;
