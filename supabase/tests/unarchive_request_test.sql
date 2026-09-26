-- unarchive_request: back to the status the items call for, in one step.
begin;
select plan(9);
\ir fixtures/seed.psql

-- A1's required items are all accepted, so it completes; then firm A archives both sent requests.
update public.request_items set status = 'accepted'
where id in ('10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a3');
update public.requests set status = 'archived'
where id in ('d0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-0000000000a2');
delete from public.request_events;

select tests.login_as('00000000-0000-0000-0000-0000000000b1');
select is(public.unarchive_request('d0000000-0000-0000-0000-0000000000a1'), null::uuid,
  'another firm''s staff cannot unarchive');
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select is(public.unarchive_request('d0000000-0000-0000-0000-0000000000a1'), null::uuid, 'nor can the client''s contact');

select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select is(public.unarchive_request('d0000000-0000-0000-0000-0000000000a1'),
  'd0000000-0000-0000-0000-0000000000a1'::uuid, 'staff unarchive a request');
select is((select status from public.requests where id = 'd0000000-0000-0000-0000-0000000000a1'), 'completed',
  'straight back to completed when every required item is accepted');
select is(public.unarchive_request('d0000000-0000-0000-0000-0000000000a2'),
  'd0000000-0000-0000-0000-0000000000a2'::uuid, 'staff unarchive another');
select is((select status from public.requests where id = 'd0000000-0000-0000-0000-0000000000a2'), 'open',
  'and back to open while items are outstanding');
select is(public.unarchive_request('d0000000-0000-0000-0000-0000000000a2'), null::uuid,
  'a request that is not archived is left alone');

reset role;
select is((select array_agg(kind order by id) from public.request_events
  where request_id = 'd0000000-0000-0000-0000-0000000000a1'), array['unarchived'],
  'the timeline records only the unarchive');

set local role anon;
select throws_ok($$ select public.unarchive_request('d0000000-0000-0000-0000-0000000000a1') $$, '42501', null,
  'anon cannot call it');

select * from finish();
rollback;
