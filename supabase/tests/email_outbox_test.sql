-- The email outbox: app roles can neither read nor write it, actions queue one
-- held row per contact through the queue functions, re-queuing replaces the
-- waiting row, and deleting a request takes its rows with it.
begin;
select plan(23);
\ir fixtures/seed.psql

-- Staff, contacts, and anon can neither read nor write the table.
select tests.login_as('00000000-0000-0000-0000-0000000000a1', 'admin-a@test.local');
select throws_ok($$ select * from public.email_outbox $$, '42501', null,
  'staff cannot read the outbox');
select throws_ok($$ insert into public.email_outbox (firm_id, kind, recipient, send_after)
  values ('f0000000-0000-0000-0000-00000000000a', 'staff_added', 'x@test.local', now()) $$,
  '42501', null, 'and cannot write it');
select tests.login_as('00000000-0000-0000-0000-0000000000c1', 'contact-a1@test.local');
select throws_ok($$ select * from public.email_outbox $$, '42501', null,
  'contacts cannot read the outbox');
select throws_ok($$ insert into public.email_outbox (firm_id, kind, recipient, send_after)
  values ('f0000000-0000-0000-0000-00000000000a', 'staff_added', 'x@test.local', now()) $$,
  '42501', null, 'and cannot write it');
reset role;
set local role anon;
select throws_ok($$ select * from public.email_outbox $$, '42501', null,
  'anon cannot read the outbox');
select throws_ok($$ insert into public.email_outbox (firm_id, kind, recipient, send_after)
  values ('f0000000-0000-0000-0000-00000000000a', 'staff_added', 'x@test.local', now()) $$,
  '42501', null, 'and cannot write it');
reset role;

-- One held row per contact for a draft; queuing again replaces it.
select tests.login_as('00000000-0000-0000-0000-0000000000a1', 'admin-a@test.local');
select results_eq(
  $$ select recipient from public.queue_request_emails('request_sent', 'd0000000-0000-0000-0000-0000000000a9') $$,
  $$ values ('contact-a1@test.local'::text) $$,
  'staff queues one held row for the draft''s contact');
reset role;
select is((select reply_to_id = '00000000-0000-0000-0000-0000000000a1'::uuid
               and failures = 0
               and send_after between now() + interval '59 minutes' and now() + interval '61 minutes'
        from public.email_outbox
        where kind = 'request_sent' and request_id = 'd0000000-0000-0000-0000-0000000000a9'),
  true, 'with the sender as reply-to, no failures, and an hour''s hold');
create temp table queued as
  select id from public.email_outbox where kind = 'request_sent';
update public.email_outbox set failures = 2 where kind = 'request_sent';

-- The queue functions read the caller's claim, so the test can stay the
-- database's own role and read the table only it may touch.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated',
                    'email', 'admin-a@test.local')::text, true);
select is((select email_id
           from public.queue_request_emails('request_sent', 'd0000000-0000-0000-0000-0000000000a9')),
  (select id from queued), 'queuing again returns the same waiting row');
select is((select failures = 0 from public.email_outbox where kind = 'request_sent'),
  true, 'and resets its failures');

-- The kinds a direct call may queue, and where it is refused.
select tests.login_as('00000000-0000-0000-0000-0000000000a1', 'admin-a@test.local');
select throws_ok($$ select * from public.queue_request_emails('request_sent', 'd0000000-0000-0000-0000-0000000000a1') $$,
  'P0001', 'invalid_state', 'request_sent waits for a draft');
select throws_ok($$ select * from public.queue_request_emails('needs_changes', 'd0000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1') $$,
  'P0001', 'invalid_state', 'needs_changes waits for a submitted item');
select throws_ok($$ select * from public.queue_request_emails('reminder', 'd0000000-0000-0000-0000-0000000000a1') $$,
  'P0001', 'invalid_state', 'the reminder kind is not queued directly');
reset role;
update public.request_items set status = 'submitted' where id = '10000000-0000-0000-0000-0000000000a1';
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated',
                    'email', 'admin-a@test.local')::text, true);
create temp table queued_needs_changes as
  select email_id as id from public.queue_request_emails('needs_changes', 'd0000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1');
select is((select item_id from public.email_outbox
           where id = (select id from queued_needs_changes)),
  '10000000-0000-0000-0000-0000000000a1'::uuid, 'a submitted item queues with its request');

select tests.login_as('00000000-0000-0000-0000-0000000000b1', 'admin-b@test.local');
select throws_ok($$ select * from public.queue_request_emails('request_sent', 'd0000000-0000-0000-0000-0000000000a9') $$,
  'P0001', 'not_allowed', 'another firm''s staff cannot queue');
select tests.login_as('00000000-0000-0000-0000-0000000000c1', 'contact-a1@test.local');
select throws_ok($$ select * from public.queue_request_emails('request_sent', 'd0000000-0000-0000-0000-0000000000a9') $$,
  'P0001', 'not_allowed', 'contacts cannot queue');
reset role;

-- queue_staff_added works for admins only.
select tests.login_as('00000000-0000-0000-0000-0000000000a2', 'staff-a@test.local');
select throws_ok($$ select public.queue_staff_added('00000000-0000-0000-0000-0000000000d1') $$,
  'P0001', 'not_allowed', 'only an admin queues a new member');
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated',
                    'email', 'admin-a@test.local')::text, true);
create temp table added_member as
  select public.queue_staff_added('00000000-0000-0000-0000-0000000000d1') as id;
select is((select recipient from public.email_outbox
           where id = (select id from added_member)),
  'nobody@test.local', 'an admin queues the new member''s own email');
select tests.login_as('00000000-0000-0000-0000-0000000000a1', 'admin-a@test.local');
select throws_ok($$ select public.queue_staff_added('00000000-0000-0000-0000-0000000000a2') $$,
  '23505', 'already_member', 'someone already in a firm is refused');

-- send_requests and claim_reminder queue in the transaction that changes state.
select results_eq(
  $$ select request_id, recipient from public.send_requests('70000000-0000-0000-0000-00000000000a',
      '2027 taxes', '2027-04-15',
      array['c0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000a2']::uuid[],
      array['d1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002']::uuid[])
      order by recipient $$,
  $$ values ('d1000000-0000-0000-0000-000000000001'::uuid, 'contact-a1@test.local'::text),
             ('d1000000-0000-0000-0000-000000000002'::uuid, 'contact-a2@test.local'::text) $$,
  'a bulk send queues an email for each new request');
select results_eq(
  $$ select recipient from public.claim_reminder('d0000000-0000-0000-0000-0000000000a1') $$,
  $$ values ('contact-a1@test.local'::text) $$,
  'a claim queues the day''s reminder');
select is_empty($$ select recipient from public.claim_reminder('d0000000-0000-0000-0000-0000000000a1') $$,
  'and a second claim the same day queues nothing');
reset role;

delete from public.requests where id = 'd0000000-0000-0000-0000-0000000000a1';
select is_empty($$ select 1 from public.email_outbox
  where request_id = 'd0000000-0000-0000-0000-0000000000a1' $$,
  'deleting a request removes its waiting emails');

select * from finish();
rollback;
