-- The completion trigger, exercised as staff (under RLS).
-- Request A1 open has required items a1 (file) and a3 (text) and optional a4.
begin;
select plan(10);
\ir fixtures/seed.psql

select tests.login_as('00000000-0000-0000-0000-0000000000a1');

update public.request_items set status = 'accepted'
where id = '10000000-0000-0000-0000-0000000000a1';
select is((select status from public.requests where id = 'd0000000-0000-0000-0000-0000000000a1'),
  'open', 'stays open while a required item is not accepted');

update public.request_items set status = 'accepted'
where id = '10000000-0000-0000-0000-0000000000a3';
select is((select status from public.requests where id = 'd0000000-0000-0000-0000-0000000000a1'),
  'completed', 'completes when every required item is accepted (optional items ignored)');

insert into public.request_items (id, request_id, firm_id, position, title, kind)
values ('10000000-0000-0000-0000-0000000000a5', 'd0000000-0000-0000-0000-0000000000a1',
        'f0000000-0000-0000-0000-00000000000a', 4, 'Late addition', 'file');
select is((select status from public.requests where id = 'd0000000-0000-0000-0000-0000000000a1'),
  'open', 'adding a required item reopens a completed request');

delete from public.request_items where id = '10000000-0000-0000-0000-0000000000a5';
select is((select status from public.requests where id = 'd0000000-0000-0000-0000-0000000000a1'),
  'completed', 'removing the only open required item completes the request');

update public.request_items set required = true
where id = '10000000-0000-0000-0000-0000000000a4';
select is((select status from public.requests where id = 'd0000000-0000-0000-0000-0000000000a1'),
  'open', 'making an open item required reopens the request');

update public.request_items set required = false
where id = '10000000-0000-0000-0000-0000000000a4';
update public.request_items set status = 'needs_changes', review_note = 'Blurry'
where id = '10000000-0000-0000-0000-0000000000a3';
select is((select status from public.requests where id = 'd0000000-0000-0000-0000-0000000000a1'),
  'open', 'returning an item reopens the request');

update public.requests set status = 'archived' where id = 'd0000000-0000-0000-0000-0000000000a1';
update public.request_items set status = 'accepted', review_note = null
where id = '10000000-0000-0000-0000-0000000000a3';
select is((select status from public.requests where id = 'd0000000-0000-0000-0000-0000000000a1'),
  'archived', 'item changes never touch an archived request');

update public.requests set status = 'open' where id = 'd0000000-0000-0000-0000-0000000000a1';
select public.refresh_request_status('d0000000-0000-0000-0000-0000000000a1');
select is((select status from public.requests where id = 'd0000000-0000-0000-0000-0000000000a1'),
  'completed', 'unarchive then refresh recomputes the status');

update public.request_items set status = 'accepted'
where id = '10000000-0000-0000-0000-0000000000a9';
select is((select status from public.requests where id = 'd0000000-0000-0000-0000-0000000000a9'),
  'draft', 'item changes never touch a draft');

update public.request_items set required = false
where request_id = 'd0000000-0000-0000-0000-0000000000a2';
update public.request_items set status = 'accepted'
where request_id = 'd0000000-0000-0000-0000-0000000000a2';
select is((select status from public.requests where id = 'd0000000-0000-0000-0000-0000000000a2'),
  'open', 'a request with no required items never completes');

select * from finish();
rollback;
