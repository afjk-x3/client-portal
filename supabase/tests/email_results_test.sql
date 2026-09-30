-- claim_due_emails leases due rows an hour forward for the service role, and
-- record_email_result applies an outcome: keeps what may retry, drops the rest,
-- and writes PaperLine's own events for the three request emails.
begin;
select plan(22);
\ir fixtures/seed.psql
delete from public.email_outbox;
delete from public.request_events;

-- The service role claims the two oldest due rows, not the held one.
-- (RETURNING's row order follows heap order, so sort the assertion's input.)
insert into public.email_outbox (firm_id, kind, recipient, send_after) values
  ('f0000000-0000-0000-0000-00000000000a', 'staff_added', 'due1@test.local', now() - interval '1 hour'),
  ('f0000000-0000-0000-0000-00000000000a', 'staff_added', 'due2@test.local', now() - interval '1 hour'),
  ('f0000000-0000-0000-0000-00000000000a', 'staff_added', 'due3@test.local', now() - interval '1 hour'),
  ('f0000000-0000-0000-0000-00000000000a', 'staff_added', 'held@test.local', now() + interval '1 hour');
set local role service_role;
create temp table claimed as
  select recipient, send_after from public.claim_due_emails(2);
select results_eq($$ select recipient from claimed order by recipient $$,
  $$ values ('due1@test.local'::text), ('due2@test.local'::text) $$,
  'the service role claims the two oldest due rows');
select is((select count(*) from claimed
           where send_after between now() + interval '59 minutes' and now() + interval '61 minutes'),
  2::bigint, 'each leased an hour ahead');
select results_eq($$ select recipient from public.claim_due_emails(2) $$,
  $$ values ('due3@test.local'::text) $$,
  'the next claim skips the leased rows and the held one');
reset role;

-- Staff cannot claim at all.
select tests.login_as('00000000-0000-0000-0000-0000000000a1', 'admin-a@test.local');
select throws_ok($$ select * from public.claim_due_emails() $$, '42501', null,
  'staff cannot claim outbox rows');
reset role;

-- A first-attempt success deletes the row and writes nothing.
insert into public.email_outbox (firm_id, kind, recipient, request_id, send_after)
  values ('f0000000-0000-0000-0000-00000000000a', 'reminder', 'contact-a1@test.local',
          'd0000000-0000-0000-0000-0000000000a1', now());
select public.record_email_result((select id from public.email_outbox where kind = 'reminder'));
select is_empty($$ select 1 from public.email_outbox where kind = 'reminder' $$,
  'a first-attempt success deletes the row');
select is_empty($$ select 1 from public.request_events where kind in ('email_failed', 'email_sent_late') $$,
  'and writes no event');

-- A success after an earlier failure logs the delivery.
insert into public.email_outbox (firm_id, kind, recipient, request_id, send_after)
  values ('f0000000-0000-0000-0000-00000000000a', 'reminder', 'contact-a1@test.local',
          'd0000000-0000-0000-0000-0000000000a1', now());
update public.email_outbox set failures = 1 where kind = 'reminder';
select public.record_email_result((select id from public.email_outbox where kind = 'reminder'));
select is_empty($$ select 1 from public.email_outbox where kind = 'reminder' $$,
  'a success after an earlier failure deletes the row');
select is((select detail from public.request_events where kind = 'email_sent_late'),
  '{"email": "reminder", "to": "contact-a1@test.local"}'::jsonb,
  'and writes email_sent_late');
select is((select actor_id from public.request_events where kind = 'email_sent_late'),
  null::uuid, 'with no actor');

-- A retryable failure counts its failure and waits for tomorrow.
insert into public.email_outbox (firm_id, kind, recipient, request_id, send_after)
  values ('f0000000-0000-0000-0000-00000000000a', 'reminder', 'contact-a1@test.local',
          'd0000000-0000-0000-0000-0000000000a1', now());
select public.record_email_result((select id from public.email_outbox where kind = 'reminder'),
  'daily sending limit reached', true);
select is((select failures from public.email_outbox where kind = 'reminder'), 1::smallint,
  'a retryable failure counts one failure and keeps the row');
select is((select detail ->> 'outcome' from public.request_events where kind = 'email_failed'),
  'retrying', 'and logs a retrying failure');

-- The fourth failure gives up.
update public.email_outbox set failures = 3 where kind = 'reminder';
select public.record_email_result((select id from public.email_outbox where kind = 'reminder'),
  'daily sending limit reached', true);
select is_empty($$ select 1 from public.email_outbox where kind = 'reminder' $$,
  'the fourth failure gives up and deletes the row');
select is((select detail ->> 'outcome' from public.request_events
           where kind = 'email_failed' and detail ->> 'outcome' = 'gave_up'),
  'gave_up', 'and logs that it gave up');

-- A permanent failure goes at once, with the reason cut short.
insert into public.email_outbox (firm_id, kind, recipient, request_id, send_after)
  values ('f0000000-0000-0000-0000-00000000000a', 'reminder', 'contact-a1@test.local',
          'd0000000-0000-0000-0000-0000000000a1', now());
select public.record_email_result((select id from public.email_outbox where kind = 'reminder'),
  '550 5.1.1 unknown', false);
select is_empty($$ select 1 from public.email_outbox where kind = 'reminder' $$,
  'a permanent failure deletes the row at once');
select is((select detail ->> 'outcome' from public.request_events
           where detail ->> 'reason' = '550 5.1.1 unknown'),
  'failed', 'and logs a permanent failure');
insert into public.email_outbox (firm_id, kind, recipient, request_id, send_after)
  values ('f0000000-0000-0000-0000-00000000000a', 'reminder', 'contact-a1@test.local',
          'd0000000-0000-0000-0000-0000000000a1', now());
select public.record_email_result((select id from public.email_outbox where kind = 'reminder'),
  repeat('0123456789', 30), false);
select is((select length(detail ->> 'reason') from public.request_events order by id desc limit 1),
  200, 'storing the reason cut to 200 characters');

-- Another firm's staff, and a contact, change nothing.
insert into public.email_outbox (firm_id, kind, recipient, request_id, send_after)
  values ('f0000000-0000-0000-0000-00000000000a', 'reminder', 'contact-a1@test.local',
          'd0000000-0000-0000-0000-0000000000a1', now());
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000b1', 'role', 'authenticated',
                    'email', 'admin-b@test.local')::text, true);
select public.record_email_result((select id from public.email_outbox where kind = 'reminder'));
select is((select failures from public.email_outbox where kind = 'reminder'), 0::smallint,
  'another firm''s staff cannot record a result');
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000c1', 'role', 'authenticated',
                    'email', 'contact-a1@test.local')::text, true);
select public.record_email_result((select id from public.email_outbox where kind = 'reminder'));
select is((select failures from public.email_outbox where kind = 'reminder'), 0::smallint,
  'a contact cannot record one either');

-- Staff of the row's firm can, with no actor on the event.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated',
                    'email', 'admin-a@test.local')::text, true);
select public.record_email_result((select id from public.email_outbox where kind = 'reminder'),
  'connection problem', true);
select is((select failures from public.email_outbox where kind = 'reminder'), 1::smallint,
  'staff of the firm can record a result');
select is((select actor_id from public.request_events where kind = 'email_failed' order by id desc limit 1),
  null::uuid, 'and the event has no actor');

-- A digest failure writes no event.
insert into public.email_outbox (firm_id, kind, recipient, window_start, window_end, send_after)
  values ('f0000000-0000-0000-0000-00000000000a', 'staff_digest', 'digest@test.local',
          now() - interval '1 day', now(), now());
select public.record_email_result((select id from public.email_outbox where kind = 'staff_digest'),
  'connection problem', true);
select is((select failures from public.email_outbox where kind = 'staff_digest'), 1::smallint,
  'a digest row keeps its failure');
select is_empty($$ select 1 from public.request_events where detail ->> 'to' = 'digest@test.local' $$,
  'and writes no event');

select * from finish();
rollback;
