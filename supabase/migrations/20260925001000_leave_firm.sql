-- Staff (not admins) can leave their firm. Admins add staff without the
-- person's consent, and a user belongs to at most one firm, so without this
-- someone added by mistake could never set up or join another firm. An admin
-- leaves by first being made staff by another admin, so every firm keeps one.
create policy "Staff can leave their firm"
  on public.firm_members for delete to authenticated
  using (user_id = (select auth.uid()) and role = 'staff');
