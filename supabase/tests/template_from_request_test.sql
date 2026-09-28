-- template_from_request: save a sent request's items as a new template.
-- Seed: request A1 open (items a1 "A1 file", a3 "A1 text", a4 "A1 optional file"),
-- A1 draft, B1 open in firm B.
begin;
select plan(12);
\ir fixtures/seed.psql

reset role;
update public.request_items set description = 'Last page too', position = 10
  where id = '10000000-0000-0000-0000-0000000000a4';

select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select ok(
  (select public.template_from_request('d0000000-0000-0000-0000-0000000000a1')) is not null,
  'a sent request becomes a template');
select results_eq(
  $$ select name, firm_id from public.templates where name = 'A1 open' $$,
  $$ values ('A1 open'::text, 'f0000000-0000-0000-0000-00000000000a'::uuid) $$,
  'the template is named after the request');
select results_eq(
  $$ select ti.position, ti.title, ti.description, ti.kind, ti.required
     from public.template_items ti
     join public.templates t on t.id = ti.template_id
     where t.name = 'A1 open'
     order by ti.position $$,
  $$ values (1, 'A1 file'::text, null::text, 'file'::text, true),
           (2, 'A1 text', null, 'text', true),
           (3, 'A1 optional file', 'Last page too', 'file', false) $$,
  'items carry over, renumbered from the position order');

select ok(
  (select public.template_from_request('d0000000-0000-0000-0000-0000000000a1')) is not null,
  'the second call also creates a template');
select results_eq(
  $$ select count(*) from public.templates where name = 'A1 open' $$,
  $$ values (2::bigint) $$,
  'clicking twice makes two templates');

select is(
  (select public.template_from_request('d0000000-0000-0000-0000-0000000000a9')),
  null::uuid,
  'a draft is not a source');
select is(
  (select count(*) from public.templates where name = 'A1 draft'),
  0::bigint,
  'the draft creates no template');

select is(
  (select public.template_from_request('d0000000-0000-0000-0000-0000000000b1')),
  null::uuid,
  'another firm''s request is not visible');
select is(
  (select count(*) from public.templates where name = 'B1 open'),
  0::bigint,
  'the other firm gets no template');

reset role;
update public.requests set status = 'archived'
  where id = 'd0000000-0000-0000-0000-0000000000a1';
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select ok(
  (select public.template_from_request('d0000000-0000-0000-0000-0000000000a1')) is not null,
  'an archived request can be saved as a template');

select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select public.template_from_request('d0000000-0000-0000-0000-0000000000a1') $$,
  '42501', null, 'a client contact is refused');

reset role;
set local role anon;
select throws_ok($$ select public.template_from_request('d0000000-0000-0000-0000-0000000000a1') $$,
  '42501', null, 'anon cannot call template_from_request');

select * from finish();
rollback;
