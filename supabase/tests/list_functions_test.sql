-- list_requests and list_clients: search, filters, paging, and isolation.
begin;
select plan(22);
\ir fixtures/seed.psql

-- Firm A gets an archived request, a title with a literal %, and 60 requests to page through.
insert into public.requests (id, firm_id, client_id, title, due_date, status, sent_at) values
  ('d0000000-0000-0000-0000-0000000000a5', 'f0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a2',
   'Old archived', current_date - 30, 'archived', now()),
  ('d0000000-0000-0000-0000-0000000000a6', 'f0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a2',
   '100% done', current_date + 7, 'open', now());
insert into public.requests (firm_id, client_id, title, due_date, status, sent_at)
select 'f0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a2',
       'Page ' || lpad(n::text, 2, '0'), current_date + 100, 'open', now()
from generate_series(1, 60) n;

select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select is((select total from public.list_requests() limit 1), 64, 'every active request of the caller''s firm is counted');
select is((select count(*)::int from public.list_requests()), 50, 'a page holds 50 rows');
select is((select count(*)::int from public.list_requests(page => 2)), 14, 'the next page holds the rest');
select is_empty($$ select 1 from public.list_requests(page => 3) $$, 'a page past the end is empty');
select results_eq($$ select title from public.list_requests(q => 'client a2', statuses => array['archived']) $$,
  $$ values ('Old archived') $$, 'search matches the client name, and the status filter applies');
select results_eq($$ select title from public.list_requests(q => 'DRAFT') $$,
  $$ values ('A1 draft') $$, 'search matches the title, ignoring case');
select results_eq($$ select title from public.list_requests(q => '%') $$,
  $$ values ('100% done') $$, 'a % in the search is a plain character');
select is((select total from public.list_requests(q => '   ') limit 1), 64, 'an all-space search matches everything');
select results_eq($$ select title from public.list_requests(statuses => array['draft']) $$,
  $$ values ('A1 draft') $$, 'the status filter keeps only the chosen statuses');

-- Overdue follows the firm's date. The zone is chosen to be a day away from UTC right now,
-- so a check against UTC's date would fail one of these two rows.
reset role;
update public.firms
set time_zone = case when extract(hour from now() at time zone 'UTC') >= 10 then 'Pacific/Kiritimati' else 'Pacific/Pago_Pago' end
where id = 'f0000000-0000-0000-0000-00000000000a';
update public.requests r
set due_date = (now() at time zone f.time_zone)::date
             + case when r.id = 'd0000000-0000-0000-0000-0000000000a1' then -1 else 0 end
from public.firms f
where f.id = r.firm_id
  and r.id in ('d0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-0000000000a2');
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select results_eq($$ select title from public.list_requests(overdue_only => true) $$,
  $$ values ('A1 open') $$, 'overdue means open and due before the firm''s own today');

-- Staff of firm A who is also a contact of firm B's client.
reset role;
insert into public.client_contacts (client_id, firm_id, user_id, full_name, email) values
  ('c0000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-00000000000b',
   '00000000-0000-0000-0000-0000000000a2', 'Staff A as contact', 'staff-a@test.local');
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select is_empty($$ select 1 from public.list_requests(statuses => array['draft', 'open', 'completed', 'archived'])
  where client_name = 'Client B1' $$, 'staff never see another firm''s requests here, even as its contact');
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select is_empty($$ select 1 from public.list_requests() $$, 'contacts see nothing');

-- Clients: an owner, a business, an archived client, and 55 more to page through.
reset role;
update public.clients set owner_id = '00000000-0000-0000-0000-0000000000a1' where id = 'c0000000-0000-0000-0000-0000000000a1';
update public.clients set kind = 'business' where id = 'c0000000-0000-0000-0000-0000000000a2';
insert into public.clients (firm_id, name, archived_at) values ('f0000000-0000-0000-0000-00000000000a', 'Gone Client', now());
insert into public.clients (firm_id, name)
select 'f0000000-0000-0000-0000-00000000000a', 'Bulk ' || lpad(n::text, 2, '0') from generate_series(1, 55) n;
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select is((select total from public.list_clients() limit 1), 57, 'every active client of the caller''s firm is counted');
select is((select count(*)::int from public.list_clients(page => 2)), 7, 'clients page by 50 too');
select results_eq($$ select name from public.list_clients(q => 'CONTACT-A2@') $$,
  $$ values ('Client A2') $$, 'search matches a contact''s email');
select results_eq($$ select name from public.list_clients(q => 'contact a1') $$,
  $$ values ('Client A1') $$, 'and a contact''s name');
select results_eq($$ select name from public.list_clients(owner => '00000000-0000-0000-0000-0000000000a1') $$,
  $$ values ('Client A1') $$, 'the owner filter');
select is((select count(*)::int from public.list_clients(owner => 'none', kind => 'business')), 1,
  '"no owner" and a type combine');
select results_eq($$ select name from public.list_clients(q => 'gone', include_archived => true) $$,
  $$ values ('Gone Client') $$, 'archived clients appear when asked');
select is_empty($$ select 1 from public.list_clients(q => 'gone') $$, 'and not otherwise');
select is_empty($$ select 1 from public.list_clients(q => 'Client B1') $$,
  'staff never see another firm''s clients here, even as its contact');

reset role;
set local role anon;
select throws_ok($$ select public.list_requests() $$, '42501', null, 'anon cannot list');

select * from finish();
rollback;
