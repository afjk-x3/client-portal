-- Private staff notes on a client or a request. Every member of the firm
-- reads them; only the author may change one, and only its body.

alter table public.requests add constraint requests_id_client_id_key unique (id, client_id);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null,
  client_id uuid not null,
  request_id uuid,
  author_id uuid not null default auth.uid(),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  foreign key (client_id, firm_id) references public.clients (id, firm_id) on delete cascade,
  foreign key (request_id, client_id) references public.requests (id, client_id) on delete cascade
);
create index notes_client_id_created_at_idx on public.notes (client_id, created_at);
create index notes_request_id_created_at_idx on public.notes (request_id, created_at);

alter table public.notes enable row level security;
revoke all on public.notes from anon;
revoke update on public.notes from authenticated;
grant update (body) on public.notes to authenticated;

create policy "Staff can read notes"
  on public.notes for select to authenticated
  using (public.is_firm_member(firm_id));

create policy "Staff can add notes"
  on public.notes for insert to authenticated
  with check (public.is_firm_member(firm_id) and author_id = (select auth.uid()));

create policy "Authors can update notes"
  on public.notes for update to authenticated
  using (public.is_firm_member(firm_id) and author_id = (select auth.uid()));

create policy "Authors can delete notes"
  on public.notes for delete to authenticated
  using (public.is_firm_member(firm_id) and author_id = (select auth.uid()));

create function public.notes_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.notes_set_updated_at();
