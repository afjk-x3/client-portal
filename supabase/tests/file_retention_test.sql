-- File retention: the archived_at clock, the firm's period, and expire_files.
-- Seed: firm A period null, requests A1 and A2 open with one file each; firm B
-- period null, request B1 open with one file.
begin;
select plan(19);
\ir fixtures/seed.psql

-- The archived_at trigger.
update public.requests set status = 'archived' where id = 'd0000000-0000-0000-0000-0000000000a1';
select ok((select archived_at is not null from public.requests
           where id = 'd0000000-0000-0000-0000-0000000000a1'),
  'archiving sets archived_at');
select tests.login_as('00000000-0000-0000-0000-0000000000a1');
select public.unarchive_request('d0000000-0000-0000-0000-0000000000a1');
select ok((select archived_at is null from public.requests
           where id = 'd0000000-0000-0000-0000-0000000000a1'),
  'unarchive_request clears archived_at');
reset role;
update public.requests set status = 'archived' where id = 'd0000000-0000-0000-0000-0000000000a1';
update public.requests set status = 'open' where id = 'd0000000-0000-0000-0000-0000000000a1';
select ok((select archived_at is null from public.requests
           where id = 'd0000000-0000-0000-0000-0000000000a1'),
  'a direct status change clears archived_at');

-- Only the listed periods.
select throws_ok($$ update public.firms set file_retention_years = 4 $$,
  '23514', null, 'only the listed retention periods');

-- retention_preview: the caller's firm's archived requests, old enough, with files.
update public.requests set status = 'archived' where id = 'd0000000-0000-0000-0000-0000000000a1';
update public.requests set archived_at = now() - interval '2 years'
  where id = 'd0000000-0000-0000-0000-0000000000a1';
update public.requests set status = 'archived' where id = 'd0000000-0000-0000-0000-0000000000a2';
update public.requests set archived_at = now() - interval '1 day'
  where id = 'd0000000-0000-0000-0000-0000000000a2';
select tests.login_as('00000000-0000-0000-0000-0000000000a1');
select is(public.retention_preview(1), 1, 'one archived request is old enough');
reset role;
update public.requests set status = 'archived' where id = 'd0000000-0000-0000-0000-0000000000b1';
update public.requests set archived_at = now() - interval '2 years'
  where id = 'd0000000-0000-0000-0000-0000000000b1';
select tests.login_as('00000000-0000-0000-0000-0000000000a1');
select is(public.retention_preview(1), 1, 'another firm''s request does not count');
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select is(public.retention_preview(1), 0, 'a client contact sees nothing');

-- expire_files as the service role: firm A keeps files for 1 year, firm B forever.
reset role;
update public.firms set file_retention_years = 1 where id = 'f0000000-0000-0000-0000-00000000000a';
insert into public.item_files (id, item_id, firm_id, storage_path, filename, size_bytes, mime)
  values ('e0000000-0000-0000-0000-0000000000a9', '10000000-0000-0000-0000-0000000000a1',
          'f0000000-0000-0000-0000-00000000000a',
          'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a1/second.pdf',
          'second.pdf', 100, 'application/pdf');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is(public.expire_files(1), 1, 'the first run deletes one file');
select is((select count(*) from public.item_files
           where item_id = '10000000-0000-0000-0000-0000000000a1'),
  1::bigint, 'one of the request''s files remains');
select is(public.expire_files(1), 1, 'the second run deletes the other');
select is(public.expire_files(1), 0, 'the third run finds nothing');
select is_empty($$ select id from public.item_files
                   where item_id = '10000000-0000-0000-0000-0000000000a1' $$,
  'the expired file records are gone');
select ok((select files_deleted_at is not null from public.requests
           where id = 'd0000000-0000-0000-0000-0000000000a1'),
  'files_deleted_at is set');
select is((select count(*) from public.item_files
           where item_id = '10000000-0000-0000-0000-0000000000a2'),
  1::bigint, 'a request archived yesterday keeps its files');
select is((select count(*) from public.item_files
           where item_id = '10000000-0000-0000-0000-0000000000b1'),
  1::bigint, 'a firm with no retention keeps its files');
select ok(exists(select 1 from public.request_events
                 where request_id = 'd0000000-0000-0000-0000-0000000000a1'
                   and kind = 'file_removed'
                   and actor_id is null),
  'the run records file_removed events with no actor');

-- An open request with an old archived_at set by hand is not a target.
reset role;
update public.requests set status = 'open' where id = 'd0000000-0000-0000-0000-0000000000a2';
update public.requests set archived_at = now() - interval '3 years'
  where id = 'd0000000-0000-0000-0000-0000000000a2';
set local role service_role;
select is(public.expire_files(1), 0, 'an open request with an old archived_at is not a target');
select is((select count(*) from public.item_files
           where item_id = '10000000-0000-0000-0000-0000000000a2'),
  1::bigint, 'the open request keeps its file');

reset role;
select tests.login_as('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.expire_files() $$,
  '42501', null, 'authenticated cannot call expire_files');

select * from finish();
rollback;
