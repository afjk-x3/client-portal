-- claim_reminder: staff of the firm, open requests with open items, once per
-- day in the firm's time zone, shared with the daily job.
begin;
select plan(9);
\ir fixtures/seed.psql

update public.firms set time_zone = 'Pacific/Kiritimati' where id = 'f0000000-0000-0000-0000-00000000000a';

select tests.login_as('00000000-0000-0000-0000-0000000000a2', 'staff-a@test.local');
select is(public.claim_reminder('d0000000-0000-0000-0000-0000000000a1'), true, 'staff claim a reminder for an open request');
select is(public.claim_reminder('d0000000-0000-0000-0000-0000000000a1'), false, 'but only once a day');
reset role;
select is((select sent_on from public.notifications_sent where target_id = 'd0000000-0000-0000-0000-0000000000a1'),
  (now() at time zone 'Pacific/Kiritimati')::date, 'the day is the firm''s own');

select tests.login_as('00000000-0000-0000-0000-0000000000a2', 'staff-a@test.local');
select throws_ok($$ select public.claim_reminder('d0000000-0000-0000-0000-0000000000a9') $$,
  'P0001', 'invalid_state', 'drafts get no reminder');
reset role;
update public.request_items set status = 'submitted' where request_id = 'd0000000-0000-0000-0000-0000000000a2';
update public.clients set archived_at = now() where id = 'c0000000-0000-0000-0000-0000000000a1';
select tests.login_as('00000000-0000-0000-0000-0000000000a2', 'staff-a@test.local');
select throws_ok($$ select public.claim_reminder('d0000000-0000-0000-0000-0000000000a2') $$,
  'P0001', 'invalid_state', 'nor requests with no open items');
select throws_ok($$ select public.claim_reminder('d0000000-0000-0000-0000-0000000000a1') $$,
  'P0001', 'invalid_state', 'nor requests of archived clients');

select tests.login_as('00000000-0000-0000-0000-0000000000b1', 'admin-b@test.local');
select throws_ok($$ select public.claim_reminder('d0000000-0000-0000-0000-0000000000a1') $$,
  'P0001', 'not_allowed', 'another firm''s staff cannot claim');
select tests.login_as('00000000-0000-0000-0000-0000000000c1', 'contact-a1@test.local');
select throws_ok($$ select public.claim_reminder('d0000000-0000-0000-0000-0000000000a1') $$,
  'P0001', 'not_allowed', 'contacts cannot claim');

reset role;
set local role anon;
select throws_ok($$ select public.claim_reminder('d0000000-0000-0000-0000-0000000000a1') $$,
  '42501', null, 'anon cannot call claim_reminder');

select * from finish();
rollback;
