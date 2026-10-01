-- send_scheduled_requests creates one open request per eligible client in
-- one transaction, queues their emails, and moves the schedule forward:
-- once per date, labels from the scheduled date, late sends jump ahead,
-- and only the service role may call it.
begin;
select plan(24);
\ir fixtures/seed.psql

insert into public.schedules (id, firm_id, template_id, title, every_months, day_of_month, next_send_on, due_after_days, created_by, paused)
values
  ('50000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a',
   '70000000-0000-0000-0000-00000000000a', 'Template A', 1, 1, '2027-10-01', 14, '00000000-0000-0000-0000-0000000000a1', false),
  ('50000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-00000000000a',
   '70000000-0000-0000-0000-00000000000a', 'Quarterly', 3, 1, '2027-10-01', 14, '00000000-0000-0000-0000-0000000000a1', false),
  ('50000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-00000000000a',
   '70000000-0000-0000-0000-00000000000a', 'Yearly', 12, 1, '2027-10-01', 14, '00000000-0000-0000-0000-0000000000a1', false),
  ('50000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-00000000000a',
   '70000000-0000-0000-0000-00000000000a', 'Archived client', 1, 1, '2027-10-01', 14, '00000000-0000-0000-0000-0000000000a1', false),
  ('50000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-00000000000a',
   '70000000-0000-0000-0000-00000000000a', 'Paused one', 1, 1, '2027-10-01', 14, '00000000-0000-0000-0000-0000000000a1', true),
  ('50000000-0000-0000-0000-000000000006', 'f0000000-0000-0000-0000-00000000000a',
   '70000000-0000-0000-0000-00000000000a', 'Future one', 1, 1, '2027-12-01', 14, '00000000-0000-0000-0000-0000000000a1', false),
  ('50000000-0000-0000-0000-000000000007', 'f0000000-0000-0000-0000-00000000000a',
   '70000000-0000-0000-0000-00000000000a', 'Late one', 1, 1, '2027-07-01', 14, '00000000-0000-0000-0000-0000000000a1', false),
  ('50000000-0000-0000-0000-000000000008', 'f0000000-0000-0000-0000-00000000000a',
   '70000000-0000-0000-0000-00000000000a', 'Optional one', 1, 1, '2027-10-01', 14, '00000000-0000-0000-0000-0000000000a1', false);

insert into public.schedule_clients (schedule_id, client_id, firm_id)
select s.schedule_id::uuid, s.client_id::uuid, 'f0000000-0000-0000-0000-00000000000a'
from (values
  ('50000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a1'),
  ('50000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a2'),
  ('50000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000a1'),
  ('50000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-0000000000a1'),
  ('50000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-0000000000a1'),
  ('50000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-0000000000a2'),
  ('50000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-0000000000a1'),
  ('50000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-0000000000a1'),
  ('50000000-0000-0000-0000-000000000007', 'c0000000-0000-0000-0000-0000000000a1'),
  ('50000000-0000-0000-0000-000000000008', 'c0000000-0000-0000-0000-0000000000a1')
) as s(schedule_id, client_id);

insert into public.clients (id, firm_id, name)
values ('c0000000-0000-0000-0000-0000000000a3', 'f0000000-0000-0000-0000-00000000000a', 'Client A3');
insert into public.schedules (id, firm_id, template_id, title, every_months, day_of_month, next_send_on, due_after_days, created_by, paused)
values ('50000000-0000-0000-0000-000000000009', 'f0000000-0000-0000-0000-00000000000a',
        '70000000-0000-0000-0000-00000000000a', 'No contacts', 1, 1, '2027-10-01', 14,
        '00000000-0000-0000-0000-0000000000a1', false);
insert into public.schedule_clients (schedule_id, client_id, firm_id) values
  ('50000000-0000-0000-0000-000000000009', 'c0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-00000000000a'),
  ('50000000-0000-0000-0000-000000000009', 'c0000000-0000-0000-0000-0000000000a3', 'f0000000-0000-0000-0000-00000000000a');

set local role service_role;

select is(public.send_scheduled_requests('50000000-0000-0000-0000-000000000001', date '2027-10-01'), 2,
  'a due schedule creates one request per eligible client');
select results_eq($$ select title, due_date, created_by, status from public.requests
  where title = 'Template A – September 2027' order by client_id $$,
  $$ values ('Template A – September 2027'::text, date '2027-10-15',
             '00000000-0000-0000-0000-0000000000a1'::uuid, 'open'::text),
            ('Template A – September 2027'::text, date '2027-10-15',
             '00000000-0000-0000-0000-0000000000a1'::uuid, 'open'::text) $$,
  'the requests are open, titled with the period, due after the days, by the schedule''s creator');
select is((select count(*) from public.request_items i
  join public.requests r on r.id = i.request_id
  where r.title = 'Template A – September 2027' and i.position = 1 and i.title = 'Photo ID'),
  2::bigint, 'each request carries the template''s items in order');
select is((select count(*) from public.email_outbox e
  join public.requests r on r.id = e.request_id
  where r.title = 'Template A – September 2027' and e.kind = 'request_sent'),
  2::bigint, 'one outbox row waits per contact');
select is((select count(*) from public.email_outbox e
  join public.requests r on r.id = e.request_id
  where r.title = 'Template A – September 2027' and e.kind = 'request_sent'
    and e.send_after <= now() and e.reply_to_id = '00000000-0000-0000-0000-0000000000a1'),
  2::bigint, 'each is due now with the creator as reply-to');
select is((select count(*) from public.request_events ev
  join public.requests r on r.id = ev.request_id
  where r.title = 'Template A – September 2027' and ev.kind = 'sent' and ev.actor_id is null),
  2::bigint, 'each request logs one sent event with no actor');
select results_eq($$ select next_send_on, last_sent_on from public.schedules
  where id = '50000000-0000-0000-0000-000000000001' $$,
  $$ values (date '2027-11-01', date '2027-10-01') $$,
  'the schedule moves to its next date and records the send');
select is(public.send_scheduled_requests('50000000-0000-0000-0000-000000000001', date '2027-10-01'), 0,
  'a second run on the same date sends nothing');
select is((select count(*) from public.requests where title = 'Template A – September 2027'),
  2::bigint, 'and creates nothing more');

select is(public.send_scheduled_requests('50000000-0000-0000-0000-000000000002', date '2027-10-01'), 1,
  'a quarterly schedule sends too');
select is((select title from public.requests where title = 'Quarterly – Q3 2027'),
  'Quarterly – Q3 2027', 'its period is the quarter before');
select is(public.send_scheduled_requests('50000000-0000-0000-0000-000000000003', date '2027-10-01'), 1,
  'a yearly schedule sends too');
select is((select title from public.requests where title = 'Yearly – 2026'),
  'Yearly – 2026', 'its period is the year before');

reset role;
update public.clients set archived_at = now() where id = 'c0000000-0000-0000-0000-0000000000a2';
set local role service_role;
select is(public.send_scheduled_requests('50000000-0000-0000-0000-000000000004', date '2027-10-01'), 1,
  'an archived client is skipped for this period');
select is((select count(*) from public.requests
  where title = 'Archived client – September 2027' and client_id = 'c0000000-0000-0000-0000-0000000000a2'),
  0::bigint, 'and gets no request while the others get theirs');
select is(public.send_scheduled_requests('50000000-0000-0000-0000-000000000009', date '2027-10-01'), 1,
  'a client with no contacts is skipped');
select is((select count(*) from public.requests
  where title = 'No contacts – September 2027' and client_id = 'c0000000-0000-0000-0000-0000000000a3'),
  0::bigint, 'and gets no request');
select is(public.send_scheduled_requests('50000000-0000-0000-0000-000000000005', date '2027-10-01'), 0,
  'a paused schedule sends nothing');
select is(public.send_scheduled_requests('50000000-0000-0000-0000-000000000006', date '2027-10-01'), 0,
  'a schedule not yet due sends nothing');
select is(public.send_scheduled_requests('50000000-0000-0000-0000-000000000007', date '2027-10-01'), 1,
  'a schedule missed for three months sends once');
select results_eq($$ select next_send_on, last_sent_on from public.schedules
  where id = '50000000-0000-0000-0000-000000000007' $$,
  $$ values (date '2027-11-01', date '2027-10-01') $$,
  'then jumps past today');

reset role;
update public.template_items set required = false where template_id = '70000000-0000-0000-0000-00000000000a';
set local role service_role;
select is(public.send_scheduled_requests('50000000-0000-0000-0000-000000000008', date '2027-10-01'), 0,
  'a template with no required item sends nothing');
select results_eq($$ select next_send_on, last_sent_on from public.schedules
  where id = '50000000-0000-0000-0000-000000000008' $$,
  $$ values (date '2027-10-01', null::date) $$,
  'and leaves the schedule due');

reset role;
select tests.login_as('00000000-0000-0000-0000-0000000000a1', 'admin-a@test.local');
select throws_ok($$ select public.send_scheduled_requests('50000000-0000-0000-0000-000000000001', date '2027-10-01') $$,
  '42501', null, 'staff cannot call it themselves');
reset role;

select * from finish();
rollback;
