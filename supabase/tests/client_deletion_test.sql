-- The delete policy: admins remove archived clients, and everything follows.
-- Seed: Firm A admin a1, staff a2, client A1 with contact c1, an open request
-- (items a1 with a file, a3, a4) and a draft; Firm B admin b1.
begin;
select plan(9);
\ir fixtures/seed.psql

select tests.login_as('00000000-0000-0000-0000-0000000000a1');
delete from public.clients where id = 'c0000000-0000-0000-0000-0000000000a1';
select is((select count(*) from public.clients where id = 'c0000000-0000-0000-0000-0000000000a1'),
  1::bigint, 'an admin cannot delete an active client');

reset role;
update public.clients set archived_at = now()
  where id = 'c0000000-0000-0000-0000-0000000000a1';
-- Archive the open request too, so the cascade has an activity event to take.
update public.requests set status = 'archived'
  where client_id = 'c0000000-0000-0000-0000-0000000000a1' and status <> 'draft';

select tests.login_as('00000000-0000-0000-0000-0000000000a2');
delete from public.clients where id = 'c0000000-0000-0000-0000-0000000000a1';
select is((select count(*) from public.clients where id = 'c0000000-0000-0000-0000-0000000000a1'),
  1::bigint, 'staff cannot delete a client');

select tests.login_as('00000000-0000-0000-0000-0000000000b1');
delete from public.clients where id = 'c0000000-0000-0000-0000-0000000000a1';
reset role;
select is((select count(*) from public.clients where id = 'c0000000-0000-0000-0000-0000000000a1'),
  1::bigint, 'another firm''s admin cannot delete the client');

select tests.login_as('00000000-0000-0000-0000-0000000000a1');
delete from public.clients where id = 'c0000000-0000-0000-0000-0000000000a1';
select is((select count(*) from public.clients where id = 'c0000000-0000-0000-0000-0000000000a1'),
  0::bigint, 'an admin deletes an archived client');
select is_empty($$ select user_id from public.client_contacts
                   where client_id = 'c0000000-0000-0000-0000-0000000000a1' $$,
  'the contacts are gone');
select is_empty($$ select id from public.requests
                   where client_id = 'c0000000-0000-0000-0000-0000000000a1' $$,
  'the requests are gone');
select is_empty($$ select id from public.request_items
                   where firm_id = 'f0000000-0000-0000-0000-00000000000a'
                     and request_id not in (select id from public.requests) $$,
  'the request items are gone');
select is_empty($$ select id from public.item_files
                   where firm_id = 'f0000000-0000-0000-0000-00000000000a'
                     and item_id not in (select id from public.request_items) $$,
  'the file records are gone');
select is_empty($$ select id from public.request_events
                   where firm_id = 'f0000000-0000-0000-0000-00000000000a'
                     and request_id not in (select id from public.requests) $$,
  'the activity history is gone');

select * from finish();
rollback;
