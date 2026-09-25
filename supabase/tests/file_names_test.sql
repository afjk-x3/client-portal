-- register_file keeps an extension that matches the file's type and appends
-- the type's own otherwise, so a download never saves under another type.
begin;
select plan(5);
\ir fixtures/seed.psql

create temp table a4 (prefix text) on commit drop;
insert into a4 values ('f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/');
grant select on a4 to authenticated;
insert into storage.objects (bucket_id, name, metadata, owner_id)
select 'documents', a4.prefix || v.n || '.bin', jsonb_build_object('size', 1, 'mimetype', v.mime),
       '00000000-0000-0000-0000-0000000000c1'
from a4, (values ('1', 'application/pdf'), ('2', 'application/pdf'), ('3', 'application/pdf'),
                 ('4', 'image/jpeg'), ('5', 'image/jpeg')) as v(n, mime);

select tests.login_as('00000000-0000-0000-0000-0000000000c1');
-- Registers object n under the given name and returns the name that was stored.
create function pg_temp.registered(n text, filename text) returns text language plpgsql as $$
declare
  v_id uuid := public.register_file('10000000-0000-0000-0000-0000000000a4', (select prefix from a4) || n || '.bin', filename);
begin
  return (select f.filename from public.item_files f where f.id = v_id);
end;
$$;

select is(pg_temp.registered('1', 'My W-2.pdf'), 'My W-2.pdf', 'a matching extension is kept');
select is(pg_temp.registered('2', 'report'), 'report.pdf', 'a missing extension is added');
select is(pg_temp.registered('3', 'scan.pdf     .js'), 'scan.pdf     .js.pdf', 'a different extension gets the type''s own appended');
select is(pg_temp.registered('4', 'Photo.JPEG'), 'Photo.JPEG', 'any of the type''s extensions is kept, in any case');
select is(pg_temp.registered('5', 'photo.png'), 'photo.png.jpg', 'another image extension is not trusted either');

select * from finish();
rollback;
