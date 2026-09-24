begin;
select plan(9);
\ir fixtures/seed.psql

select tests.login_as('00000000-0000-0000-0000-0000000000d1', 'nobody@test.local');

create temp table new_firm on commit drop as
select public.create_firm('  New Firm  ', 'Nobody Person') as id;

select isnt((select id from new_firm), null, 'create_firm returns the firm id');
select is((select name from public.firms where id = (select id from new_firm)),
  'New Firm', 'the firm name is trimmed');
select results_eq(
  $$ select role, full_name, email from public.firm_members
     where user_id = '00000000-0000-0000-0000-0000000000d1' $$,
  $$ values ('admin'::text, 'Nobody Person'::text, 'nobody@test.local'::text) $$,
  'the caller becomes admin, with the email from their JWT');
select is((select name from public.templates where firm_id = (select id from new_firm)),
  'Annual tax return (starter)', 'the starter template is seeded');
select results_eq(
  $$ select count(*)::int, count(*) filter (where required)::int,
            count(*) filter (where kind = 'text')::int
     from public.template_items where firm_id = (select id from new_firm) $$,
  $$ values (7, 3, 2) $$,
  'the starter template has 7 items, 3 required, 2 text');

select throws_ok($$ select public.create_firm('Second', 'Nobody Person') $$,
  'P0001', 'not_allowed', 'a user who is already staff cannot create another firm');

select tests.login_as('00000000-0000-0000-0000-0000000000c1', 'contact-a1@test.local');
select throws_ok($$ select public.create_firm('   ', 'Contact') $$,
  '23514', null, 'a blank firm name is rejected');
select throws_ok($$ select public.create_firm(repeat('x', 121), 'Contact') $$,
  '23514', null, 'a firm name over 120 characters is rejected');

reset role;
set local role anon;
select throws_ok($$ select public.create_firm('Anon', 'Anon') $$,
  '42501', null, 'anon cannot call create_firm');

select * from finish();
rollback;
