-- Staff notes: the firm reads them, only the author writes them, a note stays
-- with its client's request, and deleting the parent takes the notes along.
begin;
select plan(17);
\ir fixtures/seed.psql

-- As postgres: N1 on the client, N2 on the open request, N3 on the draft.
insert into public.notes (id, firm_id, client_id, request_id, author_id, body) values
  ('90000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a',
   'c0000000-0000-0000-0000-0000000000a1', null, '00000000-0000-0000-0000-0000000000a1', 'Client note'),
  ('90000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-00000000000a',
   'c0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-0000000000a1',
   '00000000-0000-0000-0000-0000000000a1', 'Open request note'),
  ('90000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-00000000000a',
   'c0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-0000000000a9',
   '00000000-0000-0000-0000-0000000000a1', 'Draft note');

-- Everyone of the firm reads every note; nobody else does.
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select results_eq($$ select id from public.notes order by id $$,
  $$ values ('90000000-0000-0000-0000-000000000001'::uuid),
            ('90000000-0000-0000-0000-000000000002'::uuid),
            ('90000000-0000-0000-0000-000000000003'::uuid) $$,
  'a colleague reads every note of the firm');
select tests.login_as('00000000-0000-0000-0000-0000000000b1');
select is_empty($$ select 1 from public.notes $$, 'another firm reads none');
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select is_empty($$ select 1 from public.notes $$, 'the client''s contact reads none');
reset role;
set local role anon;
select throws_ok($$ select 1 from public.notes $$, '42501', null, 'anon cannot read notes');
reset role;

-- A staff member adds a note as themselves only.
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$ insert into public.notes (firm_id, client_id, request_id, author_id, body)
  values ('f0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a1', null,
          '00000000-0000-0000-0000-0000000000a1', 'Forged author') $$,
  '42501', null, 'a note cannot claim another author');
select lives_ok($$ insert into public.notes (firm_id, client_id, request_id, author_id, body)
  values ('f0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a1', null,
          '00000000-0000-0000-0000-0000000000a2', 'By staff A') $$,
  'and adds a note as themselves');

-- Only the author changes a note.
select is_empty($$ update public.notes set body = 'Changed'
  where id = '90000000-0000-0000-0000-000000000001' returning 1 $$,
  'a colleague cannot edit the note');
select is_empty($$ delete from public.notes
  where id = '90000000-0000-0000-0000-000000000001' returning 1 $$,
  'a colleague cannot delete the note');

select tests.login_as('00000000-0000-0000-0000-0000000000a1');
update public.notes set body = 'Edited note'
  where id = '90000000-0000-0000-0000-000000000001';
select is((select updated_at is not null from public.notes
  where id = '90000000-0000-0000-0000-000000000001'), true,
  'the author edits the body and updated_at is set');
select throws_ok($$ update public.notes set client_id = 'c0000000-0000-0000-0000-0000000000a2'
  where id = '90000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'a note cannot move to another client');
select throws_ok($$ update public.notes set author_id = '00000000-0000-0000-0000-0000000000a2'
  where id = '90000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'a note cannot change its author');

-- A request note must belong to the note's own client.
select throws_ok($$ insert into public.notes (firm_id, client_id, request_id, author_id, body)
  values ('f0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a1',
          'd0000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', 'Wrong client') $$,
  '23503', null, 'a note cannot name another client''s request');

-- The body must run between 1 and 2,000 characters.
reset role;
select throws_ok($$ insert into public.notes (id, firm_id, client_id, author_id, body)
  values ('90000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-00000000000a',
          'c0000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', '') $$,
  '23514', null, 'an empty note is refused');
select throws_ok($$ insert into public.notes (id, firm_id, client_id, author_id, body)
  values ('90000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-00000000000a',
          'c0000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1',
          repeat('x', 2001)) $$,
  '23514', null, 'a note over 2,000 characters is refused');

-- Deleting the draft takes its note; deleting the client takes the rest.
delete from public.requests where id = 'd0000000-0000-0000-0000-0000000000a9';
select is_empty($$ select id from public.notes
  where id = '90000000-0000-0000-0000-000000000003' $$,
  'deleting the draft removes its note');
select is((select count(*) from public.notes where id = '90000000-0000-0000-0000-000000000001'),
  1::bigint, 'and keeps the client note');
delete from public.clients where id = 'c0000000-0000-0000-0000-0000000000a1';
select is_empty($$ select id from public.notes
  where id in ('90000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002') $$,
  'deleting the client removes its notes');

select * from finish();
rollback;
