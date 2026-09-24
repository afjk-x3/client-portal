-- Helper functions and row level security policies.
-- Helpers are security definer so policies can call them without recursing
-- into the policies of the tables they read.

create function public.is_firm_member(firm_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.firm_members m
    where m.firm_id = is_firm_member.firm_id
      and m.user_id = (select auth.uid())
  );
$$;

create function public.is_firm_admin(firm_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.firm_members m
    where m.firm_id = is_firm_admin.firm_id
      and m.user_id = (select auth.uid())
      and m.role = 'admin'
  );
$$;

create function public.is_client_contact(client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.client_contacts cc
    where cc.client_id = is_client_contact.client_id
      and cc.user_id = (select auth.uid())
  );
$$;

-- True when the caller is a contact of any client in the firm.
create function public.is_firm_contact(firm_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.client_contacts cc
    where cc.firm_id = is_firm_contact.firm_id
      and cc.user_id = (select auth.uid())
  );
$$;

revoke execute on function public.is_firm_member(uuid) from public, anon;
revoke execute on function public.is_firm_admin(uuid) from public, anon;
revoke execute on function public.is_client_contact(uuid) from public, anon;
revoke execute on function public.is_firm_contact(uuid) from public, anon;

-- firms
create policy "Staff can read their firm"
  on public.firms for select to authenticated
  using (public.is_firm_member(id));

create policy "Contacts can read firms they work with"
  on public.firms for select to authenticated
  using (public.is_firm_contact(id));

create policy "Admins can update their firm"
  on public.firms for update to authenticated
  using (public.is_firm_admin(id))
  with check (public.is_firm_admin(id));

-- firm_members: an admin can never change or remove their own row, so every
-- firm keeps at least one admin.
create policy "Staff can read members of their firm"
  on public.firm_members for select to authenticated
  using (public.is_firm_member(firm_id));

create policy "Admins can add members"
  on public.firm_members for insert to authenticated
  with check (public.is_firm_admin(firm_id));

create policy "Admins can update other members"
  on public.firm_members for update to authenticated
  using (public.is_firm_admin(firm_id) and user_id <> (select auth.uid()))
  with check (public.is_firm_admin(firm_id) and user_id <> (select auth.uid()));

create policy "Admins can remove other members"
  on public.firm_members for delete to authenticated
  using (public.is_firm_admin(firm_id) and user_id <> (select auth.uid()));

-- clients
create policy "Staff can read clients"
  on public.clients for select to authenticated
  using (public.is_firm_member(firm_id));

create policy "Contacts can read their clients"
  on public.clients for select to authenticated
  using (public.is_client_contact(id));

create policy "Staff can add clients"
  on public.clients for insert to authenticated
  with check (public.is_firm_member(firm_id));

create policy "Staff can update clients"
  on public.clients for update to authenticated
  using (public.is_firm_member(firm_id))
  with check (public.is_firm_member(firm_id));

-- client_contacts: a contact sees only their own rows, never other contacts.
-- The portal uses these rows to show a user only the clients they belong to,
-- even when the user is also staff.
create policy "Staff can manage contacts"
  on public.client_contacts for all to authenticated
  using (public.is_firm_member(firm_id))
  with check (public.is_firm_member(firm_id));

create policy "Contacts can read their own contact rows"
  on public.client_contacts for select to authenticated
  using (user_id = (select auth.uid()));

-- templates
create policy "Staff can manage templates"
  on public.templates for all to authenticated
  using (public.is_firm_member(firm_id))
  with check (public.is_firm_member(firm_id));

create policy "Staff can manage template items"
  on public.template_items for all to authenticated
  using (public.is_firm_member(firm_id))
  with check (public.is_firm_member(firm_id));

-- requests
create policy "Staff can read requests"
  on public.requests for select to authenticated
  using (public.is_firm_member(firm_id));

create policy "Contacts can read sent requests"
  on public.requests for select to authenticated
  using (status <> 'draft' and public.is_client_contact(client_id));

create policy "Staff can add requests"
  on public.requests for insert to authenticated
  with check (public.is_firm_member(firm_id));

create policy "Staff can update requests"
  on public.requests for update to authenticated
  using (public.is_firm_member(firm_id))
  with check (public.is_firm_member(firm_id));

create policy "Staff can delete drafts"
  on public.requests for delete to authenticated
  using (public.is_firm_member(firm_id) and status = 'draft');

-- request_items: the contact policy's subquery goes through requests RLS.
create policy "Staff can manage request items"
  on public.request_items for all to authenticated
  using (public.is_firm_member(firm_id))
  with check (public.is_firm_member(firm_id));

create policy "Contacts can read items of visible requests"
  on public.request_items for select to authenticated
  using (exists (select 1 from public.requests r where r.id = request_id));

-- item_files: only RPCs write here. The contact policy's subquery goes
-- through request_items RLS.
create policy "Staff can read files"
  on public.item_files for select to authenticated
  using (public.is_firm_member(firm_id));

create policy "Contacts can read files of visible items"
  on public.item_files for select to authenticated
  using (exists (select 1 from public.request_items i where i.id = item_id));

-- notifications_sent has no policies: only the service role can use it.
