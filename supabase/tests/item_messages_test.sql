-- item messages: only the two functions write them; staff and the client's
-- contacts read them; a staff message queues one held item_message email that
-- a later reply replaces; mark_item_messages_read is staff-only.
begin;
select plan(27);
\ir fixtures/seed.psql

-- A contact asks on an open item: no email, and the message waits unread.
select tests.login_as('00000000-0000-0000-0000-0000000000c1', 'contact-a1@test.local');
select is_empty($$ select * from public.post_item_message('10000000-0000-0000-0000-0000000000a1', 'Which bank?') $$,
  'a contact''s message queues no email');
select is((select not by_staff and author_name = 'Contact A1' and read_at is null
           from public.item_messages where body = 'Which bank?'),
  true, 'and is stored as the contact''s unread message');

-- Staff answering queues one held email per contact and marks the question read.
select tests.login_as('00000000-0000-0000-0000-0000000000a2', 'staff-a@test.local');
select is((select recipient from public.post_item_message('10000000-0000-0000-0000-0000000000a1', 'The BDO one')),
  'contact-a1@test.local', 'a staff message queues an email for the contact');
select is((select by_staff and author_name = 'Staff A'
           from public.item_messages where body = 'The BDO one'),
  true, 'and is stored as the staff member''s message');
select is((select read_at is not null from public.item_messages where body = 'Which bank?'),
  true, 'and marks the client''s unread messages read');
reset role;
select is((select kind = 'item_message'
               and item_id = '10000000-0000-0000-0000-0000000000a1'
               and reply_to_id = '00000000-0000-0000-0000-0000000000a2'
               and send_after between now() + interval '59 minutes' and now() + interval '61 minutes'
           from public.email_outbox
           where request_id = 'd0000000-0000-0000-0000-0000000000a1' and kind = 'item_message'),
  true, 'the outbox row is held for an hour with the replier as reply-to');
select set_config('test.first_email', (
    select id::text from public.email_outbox
    where request_id = 'd0000000-0000-0000-0000-0000000000a1' and kind = 'item_message'),
  true);

-- A second staff message while the first waits returns the same email.
select tests.login_as('00000000-0000-0000-0000-0000000000a1', 'admin-a@test.local');
select is((select email_id from public.post_item_message('10000000-0000-0000-0000-0000000000a1', 'Anything else?')),
  (select current_setting('test.first_email')::bigint),
  'a second staff message returns the same email_id');

-- Everyone inside the firm-and-client circle reads every message; outsiders none.
select is((select count(*)::int from public.item_messages
           where item_id = '10000000-0000-0000-0000-0000000000a1'), 3, 'a1 sees every message');
select tests.login_as('00000000-0000-0000-0000-0000000000a2', 'staff-a@test.local');
select is((select count(*)::int from public.item_messages
           where item_id = '10000000-0000-0000-0000-0000000000a1'), 3, 'a2 sees every message');
select tests.login_as('00000000-0000-0000-0000-0000000000c1', 'contact-a1@test.local');
select is((select count(*)::int from public.item_messages
           where item_id = '10000000-0000-0000-0000-0000000000a1'), 3, 'c1 sees every message');
select tests.login_as('00000000-0000-0000-0000-0000000000c2', 'contact-a2@test.local');
select is_empty($$ select * from public.item_messages
  where item_id = '10000000-0000-0000-0000-0000000000a1' $$,
  'another client''s contact sees none');
select tests.login_as('00000000-0000-0000-0000-0000000000b1', 'admin-b@test.local');
select is_empty($$ select * from public.item_messages
  where item_id = '10000000-0000-0000-0000-0000000000a1' $$,
  'another firm''s staff sees none');
reset role;
set local role anon;
select is_empty($$ select * from public.item_messages
  where item_id = '10000000-0000-0000-0000-0000000000a1' $$, 'anon sees none');
reset role;

-- Rows are written only through the functions.
select tests.login_as('00000000-0000-0000-0000-0000000000a1', 'admin-a@test.local');
select throws_ok($$ insert into public.item_messages
    (firm_id, client_id, request_id, item_id, author_id, author_name, by_staff, body)
  values ('f0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a1',
          'd0000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1',
          '00000000-0000-0000-0000-0000000000a1', 'Admin A', false, 'sneaky') $$,
  '42501', null, 'staff cannot insert messages directly');
select throws_ok($$ update public.item_messages set body = 'edited'
  where item_id = '10000000-0000-0000-0000-0000000000a1' $$,
  '42501', null, 'staff cannot edit messages');
select throws_ok($$ delete from public.item_messages
  where item_id = '10000000-0000-0000-0000-0000000000a1' $$,
  '42501', null, 'and cannot delete them');

-- Outsiders are refused, drafts included.
select tests.login_as('00000000-0000-0000-0000-0000000000c2', 'contact-a2@test.local');
select throws_ok($$ select * from public.post_item_message('10000000-0000-0000-0000-0000000000a1', 'Hello?') $$,
  'P0001', 'not_allowed', 'another client''s contact cannot post');
select tests.login_as('00000000-0000-0000-0000-0000000000b1', 'admin-b@test.local');
select throws_ok($$ select * from public.post_item_message('10000000-0000-0000-0000-0000000000a1', 'Hello?') $$,
  'P0001', 'not_allowed', 'another firm''s staff cannot post');
select tests.login_as('00000000-0000-0000-0000-0000000000c1', 'contact-a1@test.local');
select throws_ok($$ select * from public.post_item_message('10000000-0000-0000-0000-0000000000a9', 'Hello?') $$,
  'P0001', 'not_allowed', 'a contact cannot post on a draft');
select tests.login_as('00000000-0000-0000-0000-0000000000a1', 'admin-a@test.local');
select throws_ok($$ select * from public.post_item_message('10000000-0000-0000-0000-0000000000a9', 'Hello?') $$,
  'P0001', 'invalid_state', 'staff cannot post on a draft');

-- Marking read is for the firm's staff.
select tests.login_as('00000000-0000-0000-0000-0000000000c1', 'contact-a1@test.local');
select throws_ok($$ select public.mark_item_messages_read('10000000-0000-0000-0000-0000000000a1') $$,
  'P0001', 'not_allowed', 'a contact cannot mark messages read');
select is_empty($$ select * from public.post_item_message('10000000-0000-0000-0000-0000000000a1', 'Still open?') $$,
  'the contact asks again');
select tests.login_as('00000000-0000-0000-0000-0000000000a1', 'admin-a@test.local');
select public.mark_item_messages_read('10000000-0000-0000-0000-0000000000a1');
select is((select read_at is not null from public.item_messages where body = 'Still open?'),
  true, 'staff marking read sets the new message''s read_at');

-- The body must be 1 to 2,000 characters.
select throws_ok($$ select * from public.post_item_message('10000000-0000-0000-0000-0000000000a1', '') $$,
  '23514', null, 'an empty body is refused');
select throws_ok($$ select * from public.post_item_message('10000000-0000-0000-0000-0000000000a1', repeat('x', 2001)) $$,
  '23514', null, 'a body over 2,000 characters is refused');

-- An archived request is closed to new messages, and deleting the item
-- takes its messages with it.
reset role;
update public.requests set status = 'archived' where id = 'd0000000-0000-0000-0000-0000000000a1';
select tests.login_as('00000000-0000-0000-0000-0000000000c1', 'contact-a1@test.local');
select throws_ok($$ select * from public.post_item_message('10000000-0000-0000-0000-0000000000a1', 'One more') $$,
  'P0001', 'invalid_state', 'an archived request refuses new messages');
reset role;
delete from public.request_items where id = '10000000-0000-0000-0000-0000000000a1';
select is_empty($$ select * from public.item_messages
  where item_id = '10000000-0000-0000-0000-0000000000a1' $$,
  'deleting an item removes its messages');

select * from finish();
rollback;
