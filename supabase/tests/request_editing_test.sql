-- save_draft creates a draft, or replaces a draft's fields and items, in one
-- transaction. remove_item removes an untouched item from a sent request.
begin;
select plan(14);
\ir fixtures/seed.psql

create temp table new_draft (id uuid) on commit drop;
grant all on new_draft to authenticated;

select tests.login_as('00000000-0000-0000-0000-0000000000a2');

insert into new_draft
select public.save_draft('c0000000-0000-0000-0000-0000000000a1', 'New draft', current_date + 14,
  '[{"title": "W-2", "description": null, "kind": "file", "required": true}]');
select results_eq(
  $$ select r.status, r.title, r.created_by, (select count(*)::int from public.request_items i where i.request_id = r.id)
     from public.requests r where r.id = (select id from new_draft) $$,
  $$ values ('draft'::text, 'New draft'::text, '00000000-0000-0000-0000-0000000000a2'::uuid, 1) $$,
  'a new draft is created with its items and creator');

select lives_ok($$ select public.save_draft('c0000000-0000-0000-0000-0000000000a1', 'A1 draft v2', current_date + 21,
  '[{"title": "One", "description": null, "kind": "file", "required": true},
    {"title": "Two", "description": null, "kind": "text", "required": false}]',
  'd0000000-0000-0000-0000-0000000000a9') $$,
  'an existing draft can be saved');
select results_eq($$ select position, title from public.request_items
  where request_id = 'd0000000-0000-0000-0000-0000000000a9' order by position $$,
  $$ values (1, 'One'::text), (2, 'Two'::text) $$,
  'its items are replaced, in array order');
select throws_ok($$ select public.save_draft('c0000000-0000-0000-0000-0000000000a1', 'Broken', current_date,
  '[{"title": "", "description": null, "kind": "file", "required": true}]',
  'd0000000-0000-0000-0000-0000000000a9') $$,
  '23514', null, 'an invalid item fails the whole save');
select is((select title from public.requests where id = 'd0000000-0000-0000-0000-0000000000a9'),
  'A1 draft v2', 'and leaves the draft as it was');
select throws_ok($$ select public.save_draft('c0000000-0000-0000-0000-0000000000a1', 'Late', current_date, '[]',
  'd0000000-0000-0000-0000-0000000000a1') $$,
  'P0001', 'invalid_state', 'a sent request cannot be saved as a draft');
select throws_ok($$ select public.save_draft('c0000000-0000-0000-0000-0000000000b1', 'Other firm', current_date, '[]') $$,
  'P0001', 'not_allowed', 'staff cannot create a draft for another firm''s client');

select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select public.save_draft('c0000000-0000-0000-0000-0000000000a1', 'Contact', current_date, '[]') $$,
  'P0001', 'not_allowed', 'contacts cannot create drafts');
select throws_ok($$ select public.remove_item('10000000-0000-0000-0000-0000000000a4') $$,
  'P0001', 'not_allowed', 'contacts cannot remove items');

-- remove_item, as staff. Item a1 has a file; a4 is requested with none.
select tests.login_as('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.remove_item('10000000-0000-0000-0000-0000000000a4') $$,
  'P0001', 'not_allowed', 'staff cannot remove another firm''s item');
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$ select public.remove_item('10000000-0000-0000-0000-0000000000a1') $$,
  'P0001', 'invalid_state', 'an item with files cannot be removed');
reset role;
update public.request_items set status = 'submitted', text_answer = 'Yes'
where id = '10000000-0000-0000-0000-0000000000a3';
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$ select public.remove_item('10000000-0000-0000-0000-0000000000a3') $$,
  'P0001', 'invalid_state', 'a submitted item cannot be removed');
select is(public.remove_item('10000000-0000-0000-0000-0000000000a4'),
  'd0000000-0000-0000-0000-0000000000a1'::uuid, 'a requested item without files is removed; its request id is returned');
select is_empty($$ select 1 from public.request_items where id = '10000000-0000-0000-0000-0000000000a4' $$,
  'and the row is gone');

select * from finish();
rollback;
