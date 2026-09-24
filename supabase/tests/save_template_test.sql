-- save_template replaces a template's name and items in one transaction.
begin;
select plan(6);
\ir fixtures/seed.psql

select tests.login_as('00000000-0000-0000-0000-0000000000a2');

select lives_ok($$ select public.save_template('70000000-0000-0000-0000-00000000000a', 'Renamed',
  '[{"title": "One", "description": null, "kind": "file", "required": true},
    {"title": "Two", "description": "Details", "kind": "text", "required": false}]') $$,
  'staff can save their firm''s template');
select results_eq($$ select position, title, description, kind, required from public.template_items
  where template_id = '70000000-0000-0000-0000-00000000000a' order by position $$,
  $$ values (1, 'One'::text, null::text, 'file'::text, true), (2, 'Two'::text, 'Details'::text, 'text'::text, false) $$,
  'the items are replaced, in array order');
select throws_ok($$ select public.save_template('70000000-0000-0000-0000-00000000000a', 'Broken',
  '[{"title": "Fine", "description": null, "kind": "file", "required": true},
    {"title": "Bad", "description": null, "kind": "video", "required": true}]') $$,
  '23514', null, 'an invalid item fails the whole save');
select results_eq($$ select t.name, (select count(*)::int from public.template_items i where i.template_id = t.id)
  from public.templates t where t.id = '70000000-0000-0000-0000-00000000000a' $$,
  $$ values ('Renamed'::text, 2) $$,
  'and leaves the name and items as they were');
select throws_ok($$ select public.save_template('70000000-0000-0000-0000-00000000000b', 'Mine', '[]') $$,
  'P0001', 'not_allowed', 'staff cannot save another firm''s template');

select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select public.save_template('70000000-0000-0000-0000-00000000000a', 'Mine', '[]') $$,
  'P0001', 'not_allowed', 'contacts cannot save templates');

select * from finish();
rollback;
