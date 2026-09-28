-- Admins can remove archived clients; the existing foreign keys cascade
-- to contacts, requests, items, file records, and activity history.
create policy "Admins can delete archived clients"
  on public.clients for delete to authenticated
  using (public.is_firm_admin(firm_id) and archived_at is not null);
