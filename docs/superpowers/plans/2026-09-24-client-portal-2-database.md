# Client Portal Phase 2: Database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The complete Supabase schema: tables, row level security, the completion trigger, storage access, RPCs, and hardening against concurrent changes and account pre-registration, proven by pgTAP tests for firm isolation and contact isolation.

**Architecture:** Six migrations, each written test-first. RLS is the security boundary: helper functions are `security definer` with `search_path = ''`, clients write only through RPCs, and child tables reference parents by `(id, firm_id)` so no row can point into another firm. Tests share one fixture and simulate users by setting `request.jwt.claims`, the way PostgREST does.

**Tech Stack:** Supabase CLI 2.117 (local Postgres 17, Auth, Storage, Mailpit), pgTAP.

**Spec:** sections 7, 8, 14 (pgTAP), 16, 17
**Depends on:** Phase 1
**Index:** [2026-09-24-client-portal.md](2026-09-24-client-portal.md)

---

## Files

| File | Responsibility |
|---|---|
| `supabase/config.toml` | Local stack settings (generated, then edited) |
| `supabase/templates/sign-in-code.html` | Auth email that shows the 6-digit code |
| `supabase/migrations/20260925000100_tables.sql` | Tables, constraints, indexes, `documents` bucket, RLS switched on |
| `supabase/migrations/20260925000200_rls.sql` | Helper functions and table policies |
| `supabase/migrations/20260925000300_request_status.sql` | `refresh_request_status` and the completion trigger |
| `supabase/migrations/20260925000400_storage.sql` | `can_read_document`, `can_write_document`, storage policies |
| `supabase/migrations/20260925000500_rpcs.sql` | `create_firm`, `submit_item`, `register_file`, `remove_file`, `admin_user_id_by_email` |
| `supabase/migrations/20260925000600_hardening.sql` | Row locks, fixed request and item links, the admin invariant, document overwrite and delete rules, code-only sign-in |
| `supabase/tests/fixtures/seed.psql` | Shared fixture, included with `\ir` (not run as a test) |
| `supabase/tests/*_test.sql` | pgTAP tests |
| `lib/database.types.ts` | Generated types |

Notes on the local stack that the tests rely on:
- `supabase test db` runs every `*.sql` file in `supabase/tests` with `pg_prove` and pgTAP already installed. Files with other extensions, such as `fixtures/seed.psql`, only run when a test includes them.
- Default privileges grant `anon` and `authenticated` execute on new functions, so each migration revokes what those roles should not call.
- `storage.objects` has a statement trigger that blocks direct `DELETE` unless `storage.allow_delete_query` is `'true'`; the storage test sets it the way the Storage API does.

---

## Task 1: Local Supabase

**Files:**
- Create: `supabase/config.toml` (generated), `supabase/.gitignore` (generated), `supabase/templates/sign-in-code.html`
- Modify: `supabase/config.toml`, `package.json`

- [ ] **Step 1: Install the CLI and initialize**

```bash
npm install -D supabase
npx supabase init
```

Expected: `Finished supabase init.` and a new `supabase/` folder.

- [ ] **Step 2: Show the sign-in code instead of a link**

Create `supabase/templates/sign-in-code.html`:

```html
<h2>Your sign-in code</h2>
<p>Enter this code to sign in to Client Portal:</p>
<p style="font-size: 28px; font-weight: bold; letter-spacing: 6px">{{ .Token }}</p>
<p>The code expires in one hour. If you didn't ask for it, you can ignore this email.</p>
```

In `supabase/config.toml`, set the site URL to the dev server (it is used in emails):

```toml
site_url = "http://localhost:3000"
additional_redirect_urls = ["http://localhost:3000"]
```

Then replace the commented `[auth.email.template.invite]` example in the `[auth.email]` section with:

```toml
# Sign-in uses a 6-digit code, never a link. New users get the confirmation
# template when confirmations are on, existing users the magic_link template.
[auth.email.template.magic_link]
subject = "Your sign-in code"
content_path = "./supabase/templates/sign-in-code.html"

[auth.email.template.confirmation]
subject = "Your sign-in code"
content_path = "./supabase/templates/sign-in-code.html"
```

Leave `otp_length = 6` (the default) in `[auth.email]`. The confirmation template matters in production: when "Confirm email" is on, a brand-new user gets the "Confirm signup" email rather than the magic link email.

- [ ] **Step 3: Add scripts**

In `package.json`, add to `"scripts"`:

```json
"test:db": "supabase test db",
"db:types": "supabase gen types typescript --local > lib/database.types.ts"
```

- [ ] **Step 4: Start the stack**

Docker must be running.

```bash
npx supabase start
```

Expected: ends with the local URLs and keys, including `API_URL` `http://127.0.0.1:54321`, `PUBLISHABLE_KEY`, `SECRET_KEY`, and `MAILPIT_URL` `http://127.0.0.1:54324`. The first start downloads the images and takes several minutes.

- [ ] **Step 5: Commit**

```bash
git add supabase package.json package-lock.json
git commit -m "chore: add local Supabase with code-only sign-in emails"
```

---

## Task 2: Tables and the documents bucket

**Files:**
- Create: `supabase/tests/fixtures/seed.psql`, `supabase/migrations/20260925000100_tables.sql`
- Test: `supabase/tests/schema_test.sql`

- [ ] **Step 1: Write the shared fixture**

Create `supabase/tests/fixtures/seed.psql`. Every test includes it right after `plan()`. `tests.login_as()` switches to the `authenticated` role with the given user's JWT claims for the rest of the transaction; `reset role` switches back to `postgres`.

```sql
-- Shared pgTAP fixture. Include it with \ir right after plan().
--
-- Firm A: admin a1, staff a2, clients A1 (contact c1) and A2 (contact c2).
-- Firm B: admin b1, client B1 (contact c3). User d1 belongs to nothing.
-- Requests: A1 open (items a1 file+file, a3 text, a4 optional file),
--           A1 draft (item a9), A2 open (item a2 + file), B1 open (item b1 + file).
--
-- IDs: users 00000000-…-0000000000xx, firms f…0a/f…0b, clients c…,
--      templates 7…, requests d…, items 1…, files e…

create schema tests;
grant usage on schema tests to authenticated;

-- Act as a signed-in user for the rest of the transaction, as PostgREST does.
create function tests.login_as(user_id uuid, email text default null)
returns void
language sql
as $$
  select set_config('role', 'authenticated', true),
         set_config(
           'request.jwt.claims',
           json_build_object('sub', user_id, 'role', 'authenticated', 'email', email)::text,
           true
         );
$$;
grant execute on function tests.login_as(uuid, text) to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin-a@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'staff-a@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'admin-b@test.local'),
  ('00000000-0000-0000-0000-0000000000c1', 'contact-a1@test.local'),
  ('00000000-0000-0000-0000-0000000000c2', 'contact-a2@test.local'),
  ('00000000-0000-0000-0000-0000000000c3', 'contact-b1@test.local'),
  ('00000000-0000-0000-0000-0000000000d1', 'nobody@test.local');

insert into public.firms (id, name) values
  ('f0000000-0000-0000-0000-00000000000a', 'Firm A'),
  ('f0000000-0000-0000-0000-00000000000b', 'Firm B');

insert into public.firm_members (firm_id, user_id, role, full_name, email) values
  ('f0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'admin', 'Admin A', 'admin-a@test.local'),
  ('f0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 'staff', 'Staff A', 'staff-a@test.local'),
  ('f0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1', 'admin', 'Admin B', 'admin-b@test.local');

insert into public.clients (id, firm_id, name) values
  ('c0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-00000000000a', 'Client A1'),
  ('c0000000-0000-0000-0000-0000000000a2', 'f0000000-0000-0000-0000-00000000000a', 'Client A2'),
  ('c0000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-00000000000b', 'Client B1');

insert into public.client_contacts (client_id, firm_id, user_id, full_name, email) values
  ('c0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 'Contact A1', 'contact-a1@test.local'),
  ('c0000000-0000-0000-0000-0000000000a2', 'f0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c2', 'Contact A2', 'contact-a2@test.local'),
  ('c0000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000c3', 'Contact B1', 'contact-b1@test.local');

insert into public.templates (id, firm_id, name) values
  ('70000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-00000000000a', 'Template A'),
  ('70000000-0000-0000-0000-00000000000b', 'f0000000-0000-0000-0000-00000000000b', 'Template B');

insert into public.template_items (template_id, firm_id, position, title, kind) values
  ('70000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-00000000000a', 1, 'Photo ID', 'file'),
  ('70000000-0000-0000-0000-00000000000b', 'f0000000-0000-0000-0000-00000000000b', 1, 'Photo ID', 'file');

insert into public.requests (id, firm_id, client_id, title, due_date, status, sent_at) values
  ('d0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a1', 'A1 open', current_date + 7, 'open', now()),
  ('d0000000-0000-0000-0000-0000000000a9', 'f0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a1', 'A1 draft', current_date + 7, 'draft', null),
  ('d0000000-0000-0000-0000-0000000000a2', 'f0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a2', 'A2 open', current_date + 7, 'open', now()),
  ('d0000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-0000000000b1', 'B1 open', current_date + 7, 'open', now());

insert into public.request_items (id, request_id, firm_id, position, title, kind, required) values
  ('10000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-00000000000a', 1, 'A1 file', 'file', true),
  ('10000000-0000-0000-0000-0000000000a3', 'd0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-00000000000a', 2, 'A1 text', 'text', true),
  ('10000000-0000-0000-0000-0000000000a4', 'd0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-00000000000a', 3, 'A1 optional file', 'file', false),
  ('10000000-0000-0000-0000-0000000000a9', 'd0000000-0000-0000-0000-0000000000a9', 'f0000000-0000-0000-0000-00000000000a', 1, 'A1 draft item', 'file', true),
  ('10000000-0000-0000-0000-0000000000a2', 'd0000000-0000-0000-0000-0000000000a2', 'f0000000-0000-0000-0000-00000000000a', 1, 'A2 file', 'file', true),
  ('10000000-0000-0000-0000-0000000000b1', 'd0000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-00000000000b', 1, 'B1 file', 'file', true);

insert into storage.objects (bucket_id, name, metadata) values
  ('documents', 'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a1/seed-a1.pdf', '{"size": 100, "mimetype": "application/pdf"}'),
  ('documents', 'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a2/10000000-0000-0000-0000-0000000000a2/seed-a2.pdf', '{"size": 100, "mimetype": "application/pdf"}'),
  ('documents', 'f0000000-0000-0000-0000-00000000000b/c0000000-0000-0000-0000-0000000000b1/10000000-0000-0000-0000-0000000000b1/seed-b1.pdf', '{"size": 100, "mimetype": "application/pdf"}');

insert into public.item_files (id, item_id, firm_id, storage_path, filename, size_bytes, mime) values
  ('e0000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a1/seed-a1.pdf', 'seed-a1.pdf', 100, 'application/pdf'),
  ('e0000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-0000000000a2', 'f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a2/10000000-0000-0000-0000-0000000000a2/seed-a2.pdf', 'seed-a2.pdf', 100, 'application/pdf'),
  ('e0000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-00000000000b', 'f0000000-0000-0000-0000-00000000000b/c0000000-0000-0000-0000-0000000000b1/10000000-0000-0000-0000-0000000000b1/seed-b1.pdf', 'seed-b1.pdf', 100, 'application/pdf');
```

- [ ] **Step 2: Write the failing test**

Create `supabase/tests/schema_test.sql`:

```sql
begin;
select plan(5);
\ir fixtures/seed.psql

select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0,
  'RLS is enabled on every public table'
);

select throws_ok(
  $$ insert into public.requests (firm_id, client_id, title, due_date)
     values ('f0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000b1', 'Cross firm', current_date) $$,
  '23503', null,
  'a request cannot point at another firm''s client'
);

select throws_ok(
  $$ insert into public.item_files (item_id, firm_id, storage_path, filename, size_bytes, mime)
     values ('10000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-00000000000a', 'x', 'x.pdf', 1, 'application/pdf') $$,
  '23503', null,
  'a file cannot point at another firm''s item'
);

select tests.login_as('00000000-0000-0000-0000-0000000000a1');

select throws_ok(
  $$ select * from public.notifications_sent $$,
  '42501', null,
  'signed-in users cannot read notifications_sent'
);

select throws_ok(
  $$ update public.firms set plan = 'pro' $$,
  '42501', null,
  'signed-in users cannot change a firm''s plan'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `npm run test:db`
Expected: FAIL with `ERROR:  relation "public.firms" does not exist` from `fixtures/seed.psql`, and `You planned 5 tests but ran 0`.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260925000100_tables.sql`. Notes:
- A child row references its parent by `(parent_id, firm_id)`; each parent has `unique (id, firm_id)` for that purpose.
- `on delete set null (owner_id)` (Postgres 15+) clears only `owner_id` when an owner leaves the firm.
- RLS is enabled with no policies, so every table starts closed.
- Users may update `firms.name` but never `firms.plan`, which is reserved for billing.
- The bucket is created here so the fixture can insert storage objects; its policies come in Task 5.

```sql
-- Tables, constraints, indexes, and the documents bucket.
-- Row level security is enabled here with no policies, so every table starts
-- closed. Policies are added in 20260925000200_rls.sql.

create table public.firms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  plan text not null default 'beta',
  created_at timestamptz not null default now()
);

create table public.firm_members (
  firm_id uuid not null references public.firms (id) on delete cascade,
  -- ponytail: one firm per staff user. Upgrade path: drop this unique
  -- constraint and add a firm switcher.
  user_id uuid not null unique references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'staff')),
  full_name text not null check (char_length(full_name) between 1 and 200),
  email text not null,
  created_at timestamptz not null default now(),
  primary key (firm_id, user_id)
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id),
  name text not null check (char_length(name) between 1 and 200),
  kind text not null default 'individual' check (kind in ('individual', 'business')),
  owner_id uuid,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, firm_id),
  foreign key (firm_id, owner_id)
    references public.firm_members (firm_id, user_id)
    on delete set null (owner_id)
);
create index clients_firm_id_owner_id_idx on public.clients (firm_id, owner_id);

create table public.client_contacts (
  client_id uuid not null,
  firm_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 200),
  email text not null,
  created_at timestamptz not null default now(),
  primary key (client_id, user_id),
  foreign key (client_id, firm_id) references public.clients (id, firm_id) on delete cascade
);
create index client_contacts_user_id_firm_id_idx on public.client_contacts (user_id, firm_id);
create index client_contacts_client_id_firm_id_idx on public.client_contacts (client_id, firm_id);

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id),
  name text not null check (char_length(name) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (id, firm_id)
);
create index templates_firm_id_idx on public.templates (firm_id);

create table public.template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null,
  firm_id uuid not null,
  position int not null,
  title text not null check (char_length(title) between 1 and 200),
  description text check (char_length(description) <= 2000),
  kind text not null check (kind in ('file', 'text')),
  required boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (template_id, firm_id) references public.templates (id, firm_id) on delete cascade
);
create index template_items_template_id_firm_id_idx on public.template_items (template_id, firm_id);

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null,
  client_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  due_date date not null,
  status text not null default 'draft'
    check (status in ('draft', 'open', 'completed', 'archived')),
  sent_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, firm_id),
  foreign key (client_id, firm_id) references public.clients (id, firm_id) on delete cascade
);
create index requests_client_id_firm_id_idx on public.requests (client_id, firm_id);
create index requests_firm_id_status_idx on public.requests (firm_id, status);
create index requests_created_by_idx on public.requests (created_by);

create table public.request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  firm_id uuid not null,
  position int not null,
  title text not null check (char_length(title) between 1 and 200),
  description text check (char_length(description) <= 2000),
  kind text not null check (kind in ('file', 'text')),
  required boolean not null default true,
  status text not null default 'requested'
    check (status in ('requested', 'submitted', 'needs_changes', 'accepted')),
  text_answer text check (char_length(text_answer) <= 5000),
  review_note text check (char_length(review_note) between 1 and 1000),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, firm_id),
  foreign key (request_id, firm_id) references public.requests (id, firm_id) on delete cascade
);
create index request_items_request_id_firm_id_idx on public.request_items (request_id, firm_id);
create index request_items_reviewed_by_idx on public.request_items (reviewed_by);

create table public.item_files (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null,
  firm_id uuid not null,
  storage_path text not null unique,
  filename text not null check (char_length(filename) between 1 and 255),
  size_bytes bigint not null,
  mime text not null,
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (item_id, firm_id) references public.request_items (id, firm_id) on delete cascade
);
create index item_files_item_id_firm_id_idx on public.item_files (item_id, firm_id);
create index item_files_uploaded_by_idx on public.item_files (uploaded_by);

-- Internal bookkeeping for the daily cron. Only the service role uses it.
create table public.notifications_sent (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('reminder', 'staff_digest')),
  target_id uuid not null,
  sent_on date not null,
  created_at timestamptz not null default now(),
  unique (kind, target_id, sent_on)
);

alter table public.firms enable row level security;
alter table public.firm_members enable row level security;
alter table public.clients enable row level security;
alter table public.client_contacts enable row level security;
alter table public.templates enable row level security;
alter table public.template_items enable row level security;
alter table public.requests enable row level security;
alter table public.request_items enable row level security;
alter table public.item_files enable row level security;
alter table public.notifications_sent enable row level security;

revoke all on public.notifications_sent from anon, authenticated;

-- Admins may rename their firm but never change its plan.
revoke update on public.firms from anon, authenticated;
grant update (name) on public.firms to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  26214400, -- 25 MB
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
);
```

- [ ] **Step 5: Apply it and run the test**

Run: `npx supabase db reset && npm run test:db`
Expected: `schema_test.sql .. ok`, `Files=1, Tests=5`, `Result: PASS`.

- [ ] **Step 6: Commit**

```bash
git add supabase
git commit -m "feat(db): add tables, composite tenant keys, and documents bucket"
```

---

## Task 3: Helper functions and RLS policies

**Files:**
- Create: `supabase/migrations/20260925000200_rls.sql`
- Test: `supabase/tests/firm_isolation_test.sql`, `supabase/tests/contact_access_test.sql`, `supabase/tests/membership_test.sql`

- [ ] **Step 1: Write the firm isolation test**

Create `supabase/tests/firm_isolation_test.sql`. It runs as firm A's admin, the most privileged firm A user, and checks select, insert, update, and delete against firm B rows in every tenant table.

```sql
-- Admin A (the most privileged firm A user) cannot touch any firm B row.
begin;
select plan(36);
\ir fixtures/seed.psql

select tests.login_as('00000000-0000-0000-0000-0000000000a1');

-- select: only firm A rows are visible
select results_eq($$ select id from public.firms $$,
  $$ values ('f0000000-0000-0000-0000-00000000000a'::uuid) $$, 'firms: only own firm');
select results_eq($$ select distinct firm_id from public.firm_members $$,
  $$ values ('f0000000-0000-0000-0000-00000000000a'::uuid) $$, 'firm_members: only own firm');
select results_eq($$ select distinct firm_id from public.clients $$,
  $$ values ('f0000000-0000-0000-0000-00000000000a'::uuid) $$, 'clients: only own firm');
select results_eq($$ select distinct firm_id from public.client_contacts $$,
  $$ values ('f0000000-0000-0000-0000-00000000000a'::uuid) $$, 'client_contacts: only own firm');
select results_eq($$ select distinct firm_id from public.templates $$,
  $$ values ('f0000000-0000-0000-0000-00000000000a'::uuid) $$, 'templates: only own firm');
select results_eq($$ select distinct firm_id from public.template_items $$,
  $$ values ('f0000000-0000-0000-0000-00000000000a'::uuid) $$, 'template_items: only own firm');
select results_eq($$ select distinct firm_id from public.requests $$,
  $$ values ('f0000000-0000-0000-0000-00000000000a'::uuid) $$, 'requests: only own firm');
select results_eq($$ select distinct firm_id from public.request_items $$,
  $$ values ('f0000000-0000-0000-0000-00000000000a'::uuid) $$, 'request_items: only own firm');
select results_eq($$ select distinct firm_id from public.item_files $$,
  $$ values ('f0000000-0000-0000-0000-00000000000a'::uuid) $$, 'item_files: only own firm');

-- insert: every firm B row is rejected
select throws_ok($$ insert into public.firms (name) values ('Sneaky') $$,
  '42501', null, 'firms: cannot insert');
select throws_ok($$ insert into public.firm_members (firm_id, user_id, role, full_name, email)
  values ('f0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000d1', 'staff', 'X', 'x@test.local') $$,
  '42501', null, 'firm_members: cannot insert into firm B');
select throws_ok($$ insert into public.clients (firm_id, name)
  values ('f0000000-0000-0000-0000-00000000000b', 'X') $$,
  '42501', null, 'clients: cannot insert into firm B');
select throws_ok($$ insert into public.client_contacts (client_id, firm_id, user_id, full_name, email)
  values ('c0000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000d1', 'X', 'x@test.local') $$,
  '42501', null, 'client_contacts: cannot insert into firm B');
select throws_ok($$ insert into public.templates (firm_id, name)
  values ('f0000000-0000-0000-0000-00000000000b', 'X') $$,
  '42501', null, 'templates: cannot insert into firm B');
select throws_ok($$ insert into public.template_items (template_id, firm_id, position, title, kind)
  values ('70000000-0000-0000-0000-00000000000b', 'f0000000-0000-0000-0000-00000000000b', 2, 'X', 'file') $$,
  '42501', null, 'template_items: cannot insert into firm B');
select throws_ok($$ insert into public.requests (firm_id, client_id, title, due_date)
  values ('f0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-0000000000b1', 'X', current_date) $$,
  '42501', null, 'requests: cannot insert into firm B');
select throws_ok($$ insert into public.request_items (request_id, firm_id, position, title, kind)
  values ('d0000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-00000000000b', 2, 'X', 'file') $$,
  '42501', null, 'request_items: cannot insert into firm B');
select throws_ok($$ insert into public.item_files (item_id, firm_id, storage_path, filename, size_bytes, mime)
  values ('10000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-00000000000b', 'x/y', 'x.pdf', 1, 'application/pdf') $$,
  '42501', null, 'item_files: cannot insert into firm B');

-- update: no firm B row is affected
select is_empty($$ update public.firms set name = 'X'
  where id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'firms: cannot update firm B');
select is_empty($$ update public.firm_members set role = 'staff'
  where firm_id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'firm_members: cannot update firm B');
select is_empty($$ update public.clients set name = 'X'
  where firm_id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'clients: cannot update firm B');
select is_empty($$ update public.client_contacts set full_name = 'X'
  where firm_id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'client_contacts: cannot update firm B');
select is_empty($$ update public.templates set name = 'X'
  where firm_id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'templates: cannot update firm B');
select is_empty($$ update public.template_items set title = 'X'
  where firm_id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'template_items: cannot update firm B');
select is_empty($$ update public.requests set title = 'X'
  where firm_id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'requests: cannot update firm B');
select is_empty($$ update public.request_items set status = 'accepted'
  where firm_id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'request_items: cannot update firm B');
select is_empty($$ update public.item_files set filename = 'x.pdf'
  where firm_id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'item_files: cannot update firm B');

-- delete: no firm B row is affected
select is_empty($$ delete from public.firms
  where id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'firms: cannot delete firm B');
select is_empty($$ delete from public.firm_members
  where firm_id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'firm_members: cannot delete firm B');
select is_empty($$ delete from public.clients
  where firm_id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'clients: cannot delete firm B');
select is_empty($$ delete from public.client_contacts
  where firm_id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'client_contacts: cannot delete firm B');
select is_empty($$ delete from public.templates
  where firm_id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'templates: cannot delete firm B');
select is_empty($$ delete from public.template_items
  where firm_id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'template_items: cannot delete firm B');
select is_empty($$ delete from public.requests
  where firm_id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'requests: cannot delete firm B');
select is_empty($$ delete from public.request_items
  where firm_id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'request_items: cannot delete firm B');
select is_empty($$ delete from public.item_files
  where firm_id = 'f0000000-0000-0000-0000-00000000000b' returning 1 $$, 'item_files: cannot delete firm B');

select * from finish();
rollback;
```

- [ ] **Step 2: Write the contact access test**

Create `supabase/tests/contact_access_test.sql`. A contact sees their own client's sent requests, items, and files, the firm they work with, and their own `client_contacts` row; never drafts, other clients' rows, other contacts, members, or templates; and cannot write any table directly.

```sql
-- A contact sees only their own clients' sent requests and can write nothing
-- directly.
begin;
select plan(15);
\ir fixtures/seed.psql

select tests.login_as('00000000-0000-0000-0000-0000000000c1');

select results_eq($$ select id from public.requests $$,
  $$ values ('d0000000-0000-0000-0000-0000000000a1'::uuid) $$,
  'contact sees only the sent request of their client (no drafts, no other clients)');
select results_eq($$ select id from public.request_items order by position $$,
  $$ values ('10000000-0000-0000-0000-0000000000a1'::uuid),
            ('10000000-0000-0000-0000-0000000000a3'::uuid),
            ('10000000-0000-0000-0000-0000000000a4'::uuid) $$,
  'contact sees only items of visible requests');
select results_eq($$ select id from public.item_files $$,
  $$ values ('e0000000-0000-0000-0000-0000000000a1'::uuid) $$,
  'contact sees only files of visible items');
select results_eq($$ select id from public.clients $$,
  $$ values ('c0000000-0000-0000-0000-0000000000a1'::uuid) $$,
  'contact sees only their own client');
select results_eq($$ select id from public.firms $$,
  $$ values ('f0000000-0000-0000-0000-00000000000a'::uuid) $$,
  'contact sees the firm they work with');
select results_eq($$ select user_id from public.client_contacts $$,
  $$ values ('00000000-0000-0000-0000-0000000000c1'::uuid) $$,
  'contact reads only their own client_contacts row');
select is_empty($$ select 1 from public.firm_members $$, 'contact cannot read firm_members');
select is_empty($$ select 1 from public.templates $$, 'contact cannot read templates');

select is_empty($$ update public.request_items set status = 'accepted'
  where id = '10000000-0000-0000-0000-0000000000a1' returning 1 $$,
  'contact cannot update request_items directly');
select is_empty($$ update public.requests set status = 'completed' returning 1 $$,
  'contact cannot update requests');
select is_empty($$ delete from public.item_files returning 1 $$,
  'contact cannot delete item_files directly');
select throws_ok($$ insert into public.item_files (item_id, firm_id, storage_path, filename, size_bytes, mime)
  values ('10000000-0000-0000-0000-0000000000a4', 'f0000000-0000-0000-0000-00000000000a', 'x/y', 'x.pdf', 1, 'application/pdf') $$,
  '42501', null, 'contact cannot insert item_files directly');
select throws_ok($$ insert into public.clients (firm_id, name)
  values ('f0000000-0000-0000-0000-00000000000a', 'X') $$,
  '42501', null, 'contact cannot insert clients');

select tests.login_as('00000000-0000-0000-0000-0000000000d1');
select is_empty($$ select 1 from public.requests $$, 'a user with no rows sees no requests');
select is_empty($$ select 1 from public.firms $$, 'a user with no rows sees no firms');

select * from finish();
rollback;
```

- [ ] **Step 3: Write the membership test**

Create `supabase/tests/membership_test.sql`:

```sql
begin;
select plan(11);
\ir fixtures/seed.psql

-- Staff (non-admin) cannot manage members or the firm.
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$ insert into public.firm_members (firm_id, user_id, role, full_name, email)
  values ('f0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000d1', 'staff', 'New', 'nobody@test.local') $$,
  '42501', null, 'staff cannot add members');
select is_empty($$ update public.firm_members set role = 'admin'
  where user_id = '00000000-0000-0000-0000-0000000000a2' returning 1 $$,
  'staff cannot promote themselves');
select is_empty($$ delete from public.firm_members
  where user_id = '00000000-0000-0000-0000-0000000000a1' returning 1 $$,
  'staff cannot remove members');
select is_empty($$ update public.firms set name = 'Renamed' returning 1 $$,
  'staff cannot rename the firm');

-- Admins manage everyone except themselves.
select tests.login_as('00000000-0000-0000-0000-0000000000a1');
select is_empty($$ update public.firm_members set role = 'staff'
  where user_id = '00000000-0000-0000-0000-0000000000a1' returning 1 $$,
  'admin cannot change their own role');
select is_empty($$ delete from public.firm_members
  where user_id = '00000000-0000-0000-0000-0000000000a1' returning 1 $$,
  'admin cannot remove themselves');
select isnt_empty($$ update public.firm_members set role = 'admin'
  where user_id = '00000000-0000-0000-0000-0000000000a2' returning 1 $$,
  'admin can change another member''s role');
select lives_ok($$ insert into public.firm_members (firm_id, user_id, role, full_name, email)
  values ('f0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000d1', 'staff', 'New', 'nobody@test.local') $$,
  'admin can add a member');
select throws_ok($$ insert into public.firm_members (firm_id, user_id, role, full_name, email)
  values ('f0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b1', 'staff', 'B', 'admin-b@test.local') $$,
  '23505', null, 'a user cannot join a second firm');
select isnt_empty($$ delete from public.firm_members
  where user_id = '00000000-0000-0000-0000-0000000000d1' returning 1 $$,
  'admin can remove another member');
select isnt_empty($$ update public.firms set name = 'Renamed' returning 1 $$,
  'admin can rename the firm');

select * from finish();
rollback;
```

- [ ] **Step 4: Run them to make sure they fail**

Run: `npm run test:db`
Expected: FAIL. With no policies, nobody sees anything, so for example `contact_access_test.sql` reports `Looks like you failed 6 tests of 15`.

- [ ] **Step 5: Write the migration**

Create `supabase/migrations/20260925000200_rls.sql`. Notes:
- Helpers are `security definer`, so a policy on `firm_members` can call `is_firm_member()` without recursing into its own policies.
- Policies for the same command are ORed. That is why a user who is both staff and a contact sees both sets of rows, and why the app filters staff pages by `firm_id` and portal pages by the user's own `client_contacts` rows.
- "Contacts can read their own contact rows" lets the portal find the user's clients even when the user is also staff. It exposes only the caller's own rows, never other contacts.

```sql
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
```

- [ ] **Step 6: Apply it and run the tests**

Run: `npx supabase db reset && npm run test:db`
Expected: all four files `ok`, `Files=4, Tests=67`, `Result: PASS`.

- [ ] **Step 7: Commit**

```bash
git add supabase
git commit -m "feat(db): add RLS helpers and policies with isolation tests"
```

---

## Task 4: Completion trigger

**Files:**
- Create: `supabase/migrations/20260925000300_request_status.sql`
- Test: `supabase/tests/request_status_test.sql`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/request_status_test.sql`. It runs as staff, under RLS, exactly as the app's review actions do.

```sql
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:db`
Expected: FAIL. `request_status_test.sql` reports `function public.refresh_request_status(unknown) does not exist`, and the status assertions that expect `completed` fail.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260925000300_request_status.sql`. `refresh_request_status` is security invoker (spec section 8.3): staff calls run under RLS, and calls from inside the definer RPCs run with the RPC owner's rights. It only touches requests that are `open` or `completed`, and skips the write when nothing changes.

```sql
-- Keeps requests.status in sync with its items.
-- Security invoker: staff calls run under RLS; calls made from inside a
-- security definer RPC run with the RPC owner's rights.
create function public.refresh_request_status(request_id uuid)
returns void
language sql
set search_path = ''
as $$
  update public.requests r
  set status = computed.status
  from (
    select case
      when exists (
        select 1 from public.request_items i
        where i.request_id = refresh_request_status.request_id and i.required
      )
      and not exists (
        select 1 from public.request_items i
        where i.request_id = refresh_request_status.request_id
          and i.required
          and i.status <> 'accepted'
      )
      then 'completed'
      else 'open'
    end as status
  ) computed
  where r.id = refresh_request_status.request_id
    and r.status in ('open', 'completed')
    and r.status <> computed.status;
$$;

revoke execute on function public.refresh_request_status(uuid) from public, anon;

create function public.request_items_refresh_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_request_status(old.request_id);
  else
    perform public.refresh_request_status(new.request_id);
  end if;
  return null;
end;
$$;

create trigger request_items_refresh_status
  after insert or delete or update of status, required on public.request_items
  for each row execute function public.request_items_refresh_status();
```

- [ ] **Step 4: Apply it and run the tests**

Run: `npx supabase db reset && npm run test:db`
Expected: `Files=5, Tests=77`, `Result: PASS`.

- [ ] **Step 5: Commit**

```bash
git add supabase
git commit -m "feat(db): recompute request status when items change"
```

---

## Task 5: Storage access

**Files:**
- Create: `supabase/migrations/20260925000400_storage.sql`
- Test: `supabase/tests/storage_test.sql`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/storage_test.sql`. Inserting into `storage.objects` as `authenticated` is what the Storage API does on upload, so the insert policy is tested directly.

```sql
-- storage.objects policies for the documents bucket.
begin;
select plan(14);
\ir fixtures/seed.psql

set local storage.allow_delete_query = 'true';

select tests.login_as('00000000-0000-0000-0000-0000000000c1');

select lives_ok($$ insert into storage.objects (bucket_id, name) values ('documents',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/new.pdf') $$,
  'a contact can upload to an open file item of their client');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('documents',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a3/new.pdf') $$,
  '42501', null, 'a contact cannot upload to a text item');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('documents',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a2/10000000-0000-0000-0000-0000000000a2/new.pdf') $$,
  '42501', null, 'a contact cannot upload to another client''s item');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('documents',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a2/10000000-0000-0000-0000-0000000000a4/new.pdf') $$,
  '42501', null, 'the client segment must match the item');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('documents',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/extra/new.pdf') $$,
  '42501', null, 'paths must have exactly four segments');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('documents', 'not/a/valid/path.pdf') $$,
  '42501', null, 'a malformed path is rejected without a cast error');
select is(public.can_read_document('garbage'), false, 'can_read_document returns false for garbage');

select results_eq($$ select name from storage.objects where bucket_id = 'documents' order by name $$,
  $$ values ('f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a1/seed-a1.pdf'),
            ('f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/new.pdf') $$,
  'a contact reads only their client''s objects');
select is_empty($$ update storage.objects set name = name || '.bak' returning 1 $$,
  'objects can never be overwritten');
select is_empty($$ delete from storage.objects
  where name like 'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a2/%' returning 1 $$,
  'a contact cannot delete another client''s object');
select isnt_empty($$ delete from storage.objects
  where name like '%/10000000-0000-0000-0000-0000000000a4/new.pdf' returning 1 $$,
  'a contact can delete from an open file item');

reset role;
update public.requests set status = 'archived' where id = 'd0000000-0000-0000-0000-0000000000a1';
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('documents',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/late.pdf') $$,
  '42501', null, 'a contact cannot upload once the request is closed');

select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select results_eq($$ select name from storage.objects where bucket_id = 'documents' order by name $$,
  $$ values ('f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a1/seed-a1.pdf'),
            ('f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a2/10000000-0000-0000-0000-0000000000a2/seed-a2.pdf') $$,
  'staff read only their own firm''s objects');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('documents',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a2/10000000-0000-0000-0000-0000000000a2/staff.pdf') $$,
  '42501', null, 'staff cannot upload');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:db`
Expected: FAIL. `storage_test.sql` reports `function public.can_read_document(unknown) does not exist` and fails `a contact can upload to an open file item of their client`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260925000400_storage.sql`. The helpers compare path segments as text (`m.firm_id::text = split_part(name, '/', 1)`) instead of casting segments to `uuid`, so a malformed path returns `false` and can never raise inside a Storage query.

```sql
-- Storage access for the documents bucket.
-- Object paths are {firm_id}/{client_id}/{item_id}/{random uuid}-{safe name}.
-- The helpers compare path segments as text and never cast them, so a
-- malformed path returns false instead of raising.

create function public.can_read_document(name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.firm_members m
    where m.user_id = (select auth.uid())
      and m.firm_id::text = split_part(can_read_document.name, '/', 1)
  )
  or exists (
    select 1
    from public.client_contacts cc
    where cc.user_id = (select auth.uid())
      and cc.client_id::text = split_part(can_read_document.name, '/', 2)
  );
$$;

create function public.can_write_document(name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select cardinality(string_to_array(can_write_document.name, '/')) = 4
    and split_part(can_write_document.name, '/', 4) <> ''
    and exists (
      select 1
      from public.client_contacts cc
      join public.requests r on r.client_id = cc.client_id and r.firm_id = cc.firm_id
      join public.request_items i on i.request_id = r.id and i.firm_id = r.firm_id
      where cc.user_id = (select auth.uid())
        and r.firm_id::text = split_part(can_write_document.name, '/', 1)
        and r.client_id::text = split_part(can_write_document.name, '/', 2)
        and i.id::text = split_part(can_write_document.name, '/', 3)
        and i.kind = 'file'
        and i.status in ('requested', 'needs_changes')
        and r.status = 'open'
    );
$$;

revoke execute on function public.can_read_document(text) from public, anon;
revoke execute on function public.can_write_document(text) from public, anon;

create policy "Staff and contacts can read documents"
  on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.can_read_document(name));

create policy "Contacts can upload to open file items"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.can_write_document(name));

create policy "Contacts can delete from open file items"
  on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.can_write_document(name));

-- No update policy: objects can never be overwritten.
```

- [ ] **Step 4: Apply it and run the tests**

Run: `npx supabase db reset && npm run test:db`
Expected: `Files=6, Tests=91`, `Result: PASS`.

- [ ] **Step 5: Commit**

```bash
git add supabase
git commit -m "feat(db): add storage path helpers and documents policies"
```

---

## Task 6: RPCs

**Files:**
- Create: `supabase/migrations/20260925000500_rpcs.sql`
- Test: `supabase/tests/create_firm_test.sql`, `supabase/tests/submit_item_test.sql`, `supabase/tests/item_files_test.sql`, `supabase/tests/admin_rpc_test.sql`

- [ ] **Step 1: Write the `create_firm` test**

Create `supabase/tests/create_firm_test.sql`:

```sql
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
```

- [ ] **Step 2: Write the `submit_item` test**

Create `supabase/tests/submit_item_test.sql`:

```sql
-- submit_item as contact c1 (client A1). Item a1: file with one file;
-- a3: text; a4: optional file with no files; a9: in a draft.
begin;
select plan(14);
\ir fixtures/seed.psql

select tests.login_as('00000000-0000-0000-0000-0000000000c1');

select throws_ok($$ select public.submit_item('10000000-0000-0000-0000-0000000000a3') $$,
  'P0001', 'invalid_state', 'a text item needs an answer');
select throws_ok($$ select public.submit_item('10000000-0000-0000-0000-0000000000a3', '   ') $$,
  'P0001', 'invalid_state', 'a blank answer is rejected');
select throws_ok($$ select public.submit_item('10000000-0000-0000-0000-0000000000a3', repeat('x', 5001)) $$,
  'P0001', 'invalid_state', 'an answer over 5,000 characters is rejected');
select throws_ok($$ select public.submit_item('10000000-0000-0000-0000-0000000000a4') $$,
  'P0001', 'invalid_state', 'a file item needs at least one file');
select throws_ok($$ select public.submit_item('10000000-0000-0000-0000-0000000000a2') $$,
  'P0001', 'not_allowed', 'another client''s item is not found');
select throws_ok($$ select public.submit_item('10000000-0000-0000-0000-0000000000a9') $$,
  'P0001', 'not_allowed', 'an item in a draft is not found');

select lives_ok($$ select public.submit_item('10000000-0000-0000-0000-0000000000a3', '  No changes  ') $$,
  'a text item with an answer can be submitted');
select results_eq(
  $$ select status, text_answer, submitted_at is not null from public.request_items
     where id = '10000000-0000-0000-0000-0000000000a3' $$,
  $$ values ('submitted'::text, 'No changes'::text, true) $$,
  'the item is submitted with the trimmed answer and a timestamp');
select throws_ok($$ select public.submit_item('10000000-0000-0000-0000-0000000000a3', 'Again') $$,
  'P0001', 'invalid_state', 'a submitted item cannot be submitted again');

select lives_ok($$ select public.submit_item('10000000-0000-0000-0000-0000000000a1') $$,
  'a file item with a file can be submitted');

reset role;
update public.request_items set status = 'needs_changes', review_note = 'Wrong year'
where id = '10000000-0000-0000-0000-0000000000a1';
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$ select public.submit_item('10000000-0000-0000-0000-0000000000a1') $$,
  'an item returned with needs_changes can be submitted again');

reset role;
update public.requests set status = 'archived' where id = 'd0000000-0000-0000-0000-0000000000a1';
update public.request_items set status = 'requested' where id = '10000000-0000-0000-0000-0000000000a3';
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select public.submit_item('10000000-0000-0000-0000-0000000000a3', 'Late') $$,
  'P0001', 'invalid_state', 'items of an archived request cannot be submitted');

select tests.login_as('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.submit_item('10000000-0000-0000-0000-0000000000a3', 'Staff') $$,
  'P0001', 'not_allowed', 'staff cannot submit items');

reset role;
set local role anon;
select throws_ok($$ select public.submit_item('10000000-0000-0000-0000-0000000000a3', 'Anon') $$,
  '42501', null, 'anon cannot call submit_item');

select * from finish();
rollback;
```

- [ ] **Step 3: Write the `register_file` and `remove_file` test**

Create `supabase/tests/item_files_test.sql`. Uploads are simulated by inserting `storage.objects` rows as `postgres`.

```sql
-- register_file and remove_file as contact c1. Uploads are simulated by
-- inserting storage.objects rows as postgres.
begin;
select plan(13);
\ir fixtures/seed.psql

-- Path prefix for the optional file item a4 of client A1.
create temp table a4 (prefix text) on commit drop;
insert into a4 values ('f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/');
grant select on a4 to authenticated;

insert into storage.objects (bucket_id, name, metadata)
select 'documents', prefix || 'w2.pdf', '{"size": 2048, "mimetype": "application/pdf"}' from a4;

select tests.login_as('00000000-0000-0000-0000-0000000000c1');

select throws_ok(
  $$ select public.register_file('10000000-0000-0000-0000-0000000000a4',
       'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a1/seed-a1.pdf', 'w2.pdf') $$,
  'P0001', 'not_allowed', 'a path outside the item prefix is rejected');
select throws_ok(
  $$ select public.register_file('10000000-0000-0000-0000-0000000000a4', (select prefix from a4) || 'missing.pdf', 'missing.pdf') $$,
  'P0001', 'not_allowed', 'a missing object is rejected');
select throws_ok(
  $$ select public.register_file('10000000-0000-0000-0000-0000000000a2',
       'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a2/10000000-0000-0000-0000-0000000000a2/seed-a2.pdf', 'x.pdf') $$,
  'P0001', 'not_allowed', 'another client''s item is not found');
select throws_ok(
  $$ select public.register_file('10000000-0000-0000-0000-0000000000a3',
       'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a3/x.pdf', 'x.pdf') $$,
  'P0001', 'invalid_state', 'a text item cannot take files');

select lives_ok(
  $$ select public.register_file('10000000-0000-0000-0000-0000000000a4', (select prefix from a4) || 'w2.pdf', 'My W-2.pdf') $$,
  'a contact can register an uploaded object');
select results_eq(
  $$ select filename, size_bytes, mime, uploaded_by from public.item_files
     where item_id = '10000000-0000-0000-0000-0000000000a4' $$,
  $$ values ('My W-2.pdf'::text, 2048::bigint, 'application/pdf'::text, '00000000-0000-0000-0000-0000000000c1'::uuid) $$,
  'size and mime come from storage metadata; uploaded_by is the caller');

-- Fill the item up to 20 files, then the 21st is rejected.
reset role;
insert into storage.objects (bucket_id, name, metadata)
select 'documents', prefix || 'bulk-' || n || '.pdf', '{"size": 1, "mimetype": "application/pdf"}'
from a4, generate_series(1, 20) n;
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select lives_ok(
  $$ select count(public.register_file('10000000-0000-0000-0000-0000000000a4',
       (select prefix from a4) || 'bulk-' || n || '.pdf', 'bulk.pdf'))
     from generate_series(1, 19) n $$,
  'an item can hold 20 files');
select throws_ok(
  $$ select public.register_file('10000000-0000-0000-0000-0000000000a4', (select prefix from a4) || 'bulk-20.pdf', 'bulk.pdf') $$,
  'P0001', 'invalid_state', 'the 21st file is rejected');

select throws_ok($$ select public.remove_file('e0000000-0000-0000-0000-0000000000a2') $$,
  'P0001', 'not_allowed', 'another client''s file cannot be removed');
select is(public.remove_file('e0000000-0000-0000-0000-0000000000a1'),
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a1/seed-a1.pdf',
  'remove_file returns the storage path');
select is_empty($$ select 1 from public.item_files where id = 'e0000000-0000-0000-0000-0000000000a1' $$,
  'the file row is deleted');

reset role;
update public.request_items set status = 'submitted' where id = '10000000-0000-0000-0000-0000000000a4';
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok(
  $$ select public.register_file('10000000-0000-0000-0000-0000000000a4', (select prefix from a4) || 'bulk-20.pdf', 'bulk.pdf') $$,
  'P0001', 'invalid_state', 'a submitted item cannot take files');
select throws_ok(
  $$ select public.remove_file((select id from public.item_files where item_id = '10000000-0000-0000-0000-0000000000a4' limit 1)) $$,
  'P0001', 'invalid_state', 'files of a submitted item cannot be removed');

select * from finish();
rollback;
```

- [ ] **Step 4: Write the `admin_user_id_by_email` test**

Create `supabase/tests/admin_rpc_test.sql`:

```sql
begin;
select plan(3);
\ir fixtures/seed.psql

select tests.login_as('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.admin_user_id_by_email('admin-b@test.local') $$,
  '42501', null, 'signed-in users cannot look up users by email');

reset role;
set local role anon;
select throws_ok($$ select public.admin_user_id_by_email('admin-b@test.local') $$,
  '42501', null, 'anon cannot look up users by email');

reset role;
set local role service_role;
select is(public.admin_user_id_by_email('ADMIN-B@test.local'),
  '00000000-0000-0000-0000-0000000000b1'::uuid,
  'the service role can look up a user by email, case-insensitively');

select * from finish();
rollback;
```

- [ ] **Step 5: Run them to make sure they fail**

Run: `npm run test:db`
Expected: FAIL, with `function public.create_firm(unknown, unknown) does not exist` and the same for the other RPCs.

- [ ] **Step 6: Write the migration**

Create `supabase/migrations/20260925000500_rpcs.sql`. Notes:
- Parameter names match the spec (`item_id`, `text_answer`, …) because PostgREST passes RPC arguments by name. Inside the bodies they are qualified with the function name (`submit_item.item_id`) to avoid clashing with column names.
- The contact RPCs treat items in a draft as not found (`not_allowed`), matching the rule that contacts never see drafts.
- `for update of i` locks the item row, so concurrent `register_file` calls cannot both pass the 20-file check.
- `create_firm` raises `not_allowed` for a user who is already staff and relies on the check constraints for name length.

```sql
-- RPCs. Client-facing RPCs raise 'not_allowed' (no access or not found) or
-- 'invalid_state' (wrong status); lib/errors.ts maps them to user text.

-- Creates a firm, makes the caller its admin, and seeds the starter template.
create function public.create_firm(name text, full_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_email text := (select auth.jwt()) ->> 'email';
  v_firm_id uuid;
  v_template_id uuid;
begin
  if v_user_id is null or v_email is null then
    raise exception 'not_allowed';
  end if;
  if exists (select 1 from public.firm_members m where m.user_id = v_user_id) then
    raise exception 'not_allowed';
  end if;

  -- Length limits are enforced by the check constraints on the trimmed values.
  insert into public.firms (name)
  values (btrim(create_firm.name))
  returning id into v_firm_id;

  insert into public.firm_members (firm_id, user_id, role, full_name, email)
  values (v_firm_id, v_user_id, 'admin', btrim(create_firm.full_name), v_email);

  insert into public.templates (firm_id, name)
  values (v_firm_id, 'Annual tax return (starter)')
  returning id into v_template_id;

  insert into public.template_items (template_id, firm_id, position, title, kind, required)
  values
    (v_template_id, v_firm_id, 1, 'Government-issued photo ID', 'file', true),
    (v_template_id, v_firm_id, 2, 'Income statements from all employers', 'file', true),
    (v_template_id, v_firm_id, 3, 'Bank and investment statements', 'file', false),
    (v_template_id, v_firm_id, 4, 'Receipts for deductible expenses', 'file', false),
    (v_template_id, v_firm_id, 5, 'Last year''s tax return, if we did not prepare it', 'file', false),
    (v_template_id, v_firm_id, 6, 'Did your household or dependents change this year?', 'text', true),
    (v_template_id, v_firm_id, 7, 'Anything else we should know?', 'text', false);

  return v_firm_id;
end;
$$;

-- Contact submits an open item. File items need at least one file; text
-- items need an answer of 1 to 5,000 characters.
create function public.submit_item(item_id uuid, text_answer text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_status text;
  v_request_status text;
  v_answer text := nullif(btrim(submit_item.text_answer), '');
begin
  select i.kind, i.status, r.status
  into v_kind, v_status, v_request_status
  from public.request_items i
  join public.requests r on r.id = i.request_id
  where i.id = submit_item.item_id
    and r.status <> 'draft'
    and public.is_client_contact(r.client_id)
  for update of i;

  if not found then
    raise exception 'not_allowed';
  end if;
  if v_request_status <> 'open' or v_status not in ('requested', 'needs_changes') then
    raise exception 'invalid_state';
  end if;

  if v_kind = 'file' then
    if not exists (select 1 from public.item_files f where f.item_id = submit_item.item_id) then
      raise exception 'invalid_state';
    end if;
    v_answer := null;
  elsif v_answer is null or char_length(v_answer) > 5000 then
    raise exception 'invalid_state';
  end if;

  update public.request_items
  set status = 'submitted',
      submitted_at = now(),
      text_answer = v_answer
  where id = submit_item.item_id;
end;
$$;

-- Contact registers an object they uploaded to an open file item.
create function public.register_file(item_id uuid, storage_path text, filename text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_firm_id uuid;
  v_client_id uuid;
  v_kind text;
  v_status text;
  v_request_status text;
  v_size bigint;
  v_mime text;
  v_file_id uuid;
begin
  select i.firm_id, r.client_id, i.kind, i.status, r.status
  into v_firm_id, v_client_id, v_kind, v_status, v_request_status
  from public.request_items i
  join public.requests r on r.id = i.request_id
  where i.id = register_file.item_id
    and r.status <> 'draft'
    and public.is_client_contact(r.client_id)
  for update of i;

  if not found then
    raise exception 'not_allowed';
  end if;
  if v_request_status <> 'open'
     or v_status not in ('requested', 'needs_changes')
     or v_kind <> 'file' then
    raise exception 'invalid_state';
  end if;
  if not starts_with(
    register_file.storage_path,
    v_firm_id::text || '/' || v_client_id::text || '/' || register_file.item_id::text || '/'
  ) then
    raise exception 'not_allowed';
  end if;

  select (o.metadata ->> 'size')::bigint, o.metadata ->> 'mimetype'
  into v_size, v_mime
  from storage.objects o
  where o.bucket_id = 'documents'
    and o.name = register_file.storage_path;

  if not found then
    raise exception 'not_allowed';
  end if;
  if (select count(*) from public.item_files f where f.item_id = register_file.item_id) >= 20 then
    raise exception 'invalid_state';
  end if;

  insert into public.item_files (item_id, firm_id, storage_path, filename, size_bytes, mime, uploaded_by)
  values (
    register_file.item_id,
    v_firm_id,
    register_file.storage_path,
    register_file.filename,
    coalesce(v_size, 0),
    coalesce(v_mime, 'application/octet-stream'),
    (select auth.uid())
  )
  returning id into v_file_id;

  return v_file_id;
end;
$$;

-- Contact removes a file from an open item. Returns the storage path so the
-- caller can delete the object.
create function public.remove_file(file_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
  v_status text;
  v_request_status text;
begin
  select f.storage_path, i.status, r.status
  into v_path, v_status, v_request_status
  from public.item_files f
  join public.request_items i on i.id = f.item_id
  join public.requests r on r.id = i.request_id
  where f.id = remove_file.file_id
    and r.status <> 'draft'
    and public.is_client_contact(r.client_id)
  for update of i;

  if not found then
    raise exception 'not_allowed';
  end if;
  if v_request_status <> 'open' or v_status not in ('requested', 'needs_changes') then
    raise exception 'invalid_state';
  end if;

  delete from public.item_files where id = remove_file.file_id;
  return v_path;
end;
$$;

-- Used by ensureUser() when auth.admin.createUser reports email_exists.
create function public.admin_user_id_by_email(email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from auth.users u
  where lower(u.email) = lower(admin_user_id_by_email.email)
  limit 1;
$$;

revoke execute on function public.create_firm(text, text) from public, anon;
revoke execute on function public.submit_item(uuid, text) from public, anon;
revoke execute on function public.register_file(uuid, text, text) from public, anon;
revoke execute on function public.remove_file(uuid) from public, anon;
revoke execute on function public.admin_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.admin_user_id_by_email(text) to service_role;
```

- [ ] **Step 7: Apply it and run the whole suite**

Run: `npx supabase db reset && npm run test:db`
Expected: all ten files `ok`, `Files=10, Tests=130`, `Result: PASS`.

- [ ] **Step 8: Lint the database functions**

Run: `npx supabase db lint --level warning`
Expected: `No schema errors found`.

- [ ] **Step 9: Commit**

```bash
git add supabase
git commit -m "feat(db): add firm creation, item submission, and file RPCs"
```

---

## Task 7: Generate TypeScript types

**Files:**
- Create: `lib/database.types.ts` (generated)

- [ ] **Step 1: Generate**

Run: `npm run db:types`
Expected: `lib/database.types.ts` exists and contains `create_firm: {` under `Functions`.

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/database.types.ts
git commit -m "chore: generate database types"
```

Regenerate this file after every migration change: `npx supabase db reset && npm run db:types`.

---

## Task 8: Hardening

**Files:**
- Create: `supabase/migrations/20260925000600_hardening.sql`
- Test: `supabase/tests/hardening_test.sql`, `supabase/tests/access_rules_test.sql`
- Modify: `supabase/config.toml`, `lib/database.types.ts` (generated)

Tasks 1–6 hold for one request at a time and for writes that go through RLS. A security review found gaps that show up only under concurrency, through Supabase services that bypass RLS, or through Auth itself:
- **Completion race.** `refresh_request_status` computes from its own snapshot and locks the request only when it writes. Two reviews on one request could leave it `open` with every required item accepted, or `completed` with an item just returned, which blocks the contact from resubmitting.
- **Overwrites.** A signed upload URL is checked against the policies only when it is created, and the upload runs as the storage service, which upserts when the token allows it. So a contact who creates their own URL with `upsert: true` could replace a file after staff accepted it.
- **Dangling files.** A contact could delete a registered object straight through Storage, leaving an `item_files` row that points at nothing.
- **Deleting sent requests.** Staff could set a sent request back to `draft` and then delete it with the client's files.
- **Last admin.** Two admins demoting each other at the same moment could leave a firm with none.
- **Account pre-registration.** Auth still accepts password sign-ups. Someone could register another person's address with a password; when a firm later added that address, `ensureUser()` would link the firm to their account.

`access_rules_test.sql` also pins down existing rules whose weakening broke tenant isolation without failing any test, such as a contact moving their own `client_contacts` row to another firm's client.

- [ ] **Step 1: Write the hardening test**

Create `supabase/tests/hardening_test.sql`:

```sql
-- Request and item identity, the admin invariant, document read, delete and
-- overwrite rules, password stripping, and refresh_request_status under RLS.
begin;
select plan(20);
\ir fixtures/seed.psql

set local storage.allow_delete_query = 'true';

-- Requests and items keep their identity.
select tests.login_as('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ update public.requests set status = 'draft'
  where id = 'd0000000-0000-0000-0000-0000000000a1' $$,
  'P0001', 'invalid_state', 'a sent request cannot become a draft again');
select throws_ok($$ update public.requests set client_id = 'c0000000-0000-0000-0000-0000000000a2'
  where id = 'd0000000-0000-0000-0000-0000000000a1' $$,
  'P0001', 'invalid_state', 'a request cannot move to another client');
select throws_ok($$ update public.request_items set request_id = 'd0000000-0000-0000-0000-0000000000a2'
  where id = '10000000-0000-0000-0000-0000000000a4' $$,
  'P0001', 'invalid_state', 'an item cannot move to another request');
select isnt_empty($$ update public.requests set status = 'open', sent_at = now()
  where id = 'd0000000-0000-0000-0000-0000000000a9' returning 1 $$,
  'a draft can still be sent');

-- Every firm keeps an admin, even for callers that bypass RLS.
reset role;
select throws_ok($$ update public.firm_members set role = 'staff'
  where user_id = '00000000-0000-0000-0000-0000000000b1' $$,
  'P0001', 'invalid_state', 'the last admin cannot be demoted');
select throws_ok($$ delete from public.firm_members
  where user_id = '00000000-0000-0000-0000-0000000000b1' $$,
  'P0001', 'invalid_state', 'the last admin cannot be removed');
update public.firm_members set role = 'admin' where user_id = '00000000-0000-0000-0000-0000000000a2';
select lives_ok($$ update public.firm_members set role = 'staff'
  where user_id = '00000000-0000-0000-0000-0000000000a1' $$,
  'an admin can be demoted while another admin remains');
insert into public.firms (id, name) values ('f0000000-0000-0000-0000-00000000000c', 'Firm C');
insert into public.firm_members (firm_id, user_id, role, full_name, email)
values ('f0000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000d1', 'admin', 'Nobody', 'nobody@test.local');
select lives_ok($$ delete from public.firms where id = 'f0000000-0000-0000-0000-00000000000c' $$,
  'deleting a firm removes its last admin with it');

-- Documents.
insert into storage.objects (bucket_id, name) values
  ('documents', 'f0000000-0000-0000-0000-00000000000b/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/wrong-firm.pdf'),
  ('documents', 'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a1/unregistered.pdf');

select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select is_empty($$ select 1 from storage.objects where name like 'f0000000-0000-0000-0000-00000000000b/%' $$,
  'a contact cannot read an object whose firm segment is not their client''s firm');
select is_empty($$ delete from storage.objects where name like '%/seed-a1.pdf' returning 1 $$,
  'a contact cannot delete an object that is registered as a file');
select isnt_empty($$ delete from storage.objects where name like '%/unregistered.pdf' returning 1 $$,
  'a contact can delete an unregistered upload');
select lives_ok($$ select public.remove_file('e0000000-0000-0000-0000-0000000000a1') $$,
  'remove_file deletes the file row');
select isnt_empty($$ delete from storage.objects where name like '%/seed-a1.pdf' returning 1 $$,
  'after remove_file, the contact can delete the object');

reset role;
set local role service_role;
select throws_ok($$ insert into storage.objects (bucket_id, name, version)
  values ('documents', 'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a2/10000000-0000-0000-0000-0000000000a2/seed-a2.pdf', 'v2')
  on conflict (bucket_id, name) do update set version = excluded.version $$,
  'P0001', 'invalid_state', 'an upsert cannot replace a document, even as the storage service');
select lives_ok($$ update storage.objects set metadata = '{"size": 100, "mimetype": "application/pdf", "eTag": "e1"}'
  where name like '%/seed-a2.pdf' $$,
  'metadata updates still work');

-- Passwords are never stored.
reset role;
insert into auth.users (id, email, encrypted_password)
values ('00000000-0000-0000-0000-0000000000e1', 'password@test.local', '$2a$10$abcdefghijklmnopqrstuv');
select is((select encrypted_password from auth.users where id = '00000000-0000-0000-0000-0000000000e1'),
  '', 'a password set on sign-up is not stored');
update auth.users set encrypted_password = '$2a$10$abcdefghijklmnopqrstuv'
where id = '00000000-0000-0000-0000-0000000000e1';
select is((select encrypted_password from auth.users where id = '00000000-0000-0000-0000-0000000000e1'),
  '', 'a password set later is not stored');

-- refresh_request_status locks and updates only rows the caller may update.
update public.requests set status = 'completed' where id = 'd0000000-0000-0000-0000-0000000000a2';
select tests.login_as('00000000-0000-0000-0000-0000000000c2');
select lives_ok($$ select public.refresh_request_status('d0000000-0000-0000-0000-0000000000a2') $$,
  'a contact can call refresh_request_status');
reset role;
select is((select status from public.requests where id = 'd0000000-0000-0000-0000-0000000000a2'),
  'completed', 'but it changes nothing for them');
select tests.login_as('00000000-0000-0000-0000-0000000000a1');
select public.refresh_request_status('d0000000-0000-0000-0000-0000000000a2');
reset role;
select is((select status from public.requests where id = 'd0000000-0000-0000-0000-0000000000a2'),
  'open', 'a staff call recomputes the status');

select * from finish();
rollback;
```

- [ ] **Step 2: Write the access rules test**

Create `supabase/tests/access_rules_test.sql`:

```sql
-- Access rules that guard the tenant and client boundaries: contact writes,
-- upload paths and item states, RPCs on drafts and archived requests,
-- catalog-wide guards, users with both roles, and anon.
begin;
select plan(23);
\ir fixtures/seed.psql

set local storage.allow_delete_query = 'true';

-- A contact cannot write client_contacts, not even their own row.
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ insert into public.client_contacts (client_id, firm_id, user_id, full_name, email)
  values ('c0000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-00000000000b',
          '00000000-0000-0000-0000-0000000000c1', 'Me', 'contact-a1@test.local') $$,
  '42501', null, 'a contact cannot add contact rows');
select is_empty($$ update public.client_contacts
  set client_id = 'c0000000-0000-0000-0000-0000000000b1', firm_id = 'f0000000-0000-0000-0000-00000000000b'
  where user_id = '00000000-0000-0000-0000-0000000000c1' returning 1 $$,
  'a contact cannot move their own contact row to another client');
select is_empty($$ delete from public.client_contacts
  where user_id = '00000000-0000-0000-0000-0000000000c1' returning 1 $$,
  'a contact cannot delete their own contact row');

-- Uploads need the item's own firm and an open item.
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('documents',
  'f0000000-0000-0000-0000-00000000000b/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/new.pdf') $$,
  '42501', null, 'the firm segment must match the item');
reset role;
update public.request_items set status = 'submitted' where id = '10000000-0000-0000-0000-0000000000a4';
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('documents',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/new.pdf') $$,
  '42501', null, 'a contact cannot upload to a submitted item');
reset role;
update public.request_items set status = 'accepted' where id = '10000000-0000-0000-0000-0000000000a4';
insert into storage.objects (bucket_id, name) values ('documents',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/kept.pdf');
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('documents',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/new.pdf') $$,
  '42501', null, 'a contact cannot upload to an accepted item');
select is_empty($$ delete from storage.objects where name like '%/kept.pdf' returning 1 $$,
  'a contact cannot delete from an accepted item');
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select is_empty($$ delete from storage.objects where bucket_id = 'documents' returning 1 $$,
  'staff cannot delete objects');

-- File RPCs treat drafts as not found and refuse archived requests.
reset role;
insert into storage.objects (bucket_id, name) values ('documents',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a9/draft.pdf');
insert into public.item_files (id, item_id, firm_id, storage_path, filename, size_bytes, mime) values
  ('e0000000-0000-0000-0000-0000000000a9', '10000000-0000-0000-0000-0000000000a9', 'f0000000-0000-0000-0000-00000000000a',
   'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a9/draft.pdf',
   'draft.pdf', 1, 'application/pdf');
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select public.register_file('10000000-0000-0000-0000-0000000000a9',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a9/draft.pdf', 'draft.pdf') $$,
  'P0001', 'not_allowed', 'register_file treats an item in a draft as not found');
select throws_ok($$ select public.remove_file('e0000000-0000-0000-0000-0000000000a9') $$,
  'P0001', 'not_allowed', 'remove_file treats a file in a draft as not found');
reset role;
update public.requests set status = 'archived' where id = 'd0000000-0000-0000-0000-0000000000a1';
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select public.register_file('10000000-0000-0000-0000-0000000000a1',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a1/seed-a1.pdf', 'x.pdf') $$,
  'P0001', 'invalid_state', 'register_file refuses an archived request');
select throws_ok($$ select public.remove_file('e0000000-0000-0000-0000-0000000000a1') $$,
  'P0001', 'invalid_state', 'remove_file refuses an archived request');

-- Only drafts can be deleted.
select tests.login_as('00000000-0000-0000-0000-0000000000a1');
select is_empty($$ delete from public.requests where id = 'd0000000-0000-0000-0000-0000000000a2' returning 1 $$,
  'staff cannot delete a sent request');

-- Catalog-wide guards, so a new function or policy cannot quietly open a hole.
reset role;
select is_empty($$
  select p.oid::regprocedure::text
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.prosecdef
    and (not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
         or has_function_privilege('anon', p.oid, 'execute')) $$,
  'security definer functions pin search_path and are closed to anon');
select is_empty($$ select tablename || '.' || policyname from pg_policies
  where schemaname = 'public' and roles <> '{authenticated}' $$,
  'every policy applies to signed-in users only');

-- A user who is staff of firm A and a contact of client B1.
insert into public.client_contacts (client_id, firm_id, user_id, full_name, email) values
  ('c0000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-00000000000b',
   '00000000-0000-0000-0000-0000000000a2', 'Staff A', 'staff-a@test.local');
insert into public.requests (id, firm_id, client_id, title, due_date, status) values
  ('d0000000-0000-0000-0000-0000000000b9', 'f0000000-0000-0000-0000-00000000000b',
   'c0000000-0000-0000-0000-0000000000b1', 'B1 draft', current_date + 7, 'draft');
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select results_eq($$ select id from public.requests order by id $$,
  $$ values ('d0000000-0000-0000-0000-0000000000a1'::uuid), ('d0000000-0000-0000-0000-0000000000a2'::uuid),
            ('d0000000-0000-0000-0000-0000000000a9'::uuid), ('d0000000-0000-0000-0000-0000000000b1'::uuid) $$,
  'a user with both roles sees their firm''s requests and the other firm''s sent request only');
select results_eq($$ select id from public.clients order by id $$,
  $$ values ('c0000000-0000-0000-0000-0000000000a1'::uuid), ('c0000000-0000-0000-0000-0000000000a2'::uuid),
            ('c0000000-0000-0000-0000-0000000000b1'::uuid) $$,
  'and their firm''s clients plus the client they are a contact of');
select is_empty($$ update public.requests set title = 'X'
  where id = 'd0000000-0000-0000-0000-0000000000b1' returning 1 $$,
  'but cannot change the other firm''s request');
select is_empty($$ select 1 from public.firm_members where firm_id = 'f0000000-0000-0000-0000-00000000000b' $$,
  'or read the other firm''s members');
select throws_ok($$ insert into public.clients (firm_id, name) values ('f0000000-0000-0000-0000-00000000000b', 'X') $$,
  '42501', null, 'or add clients to the other firm');

-- anon reads nothing.
reset role;
set local role anon;
select is_empty($$
  select 1 from public.firms union all select 1 from public.firm_members
  union all select 1 from public.clients union all select 1 from public.client_contacts
  union all select 1 from public.templates union all select 1 from public.template_items
  union all select 1 from public.requests union all select 1 from public.request_items
  union all select 1 from public.item_files $$,
  'anon reads no rows from any table');
select is_empty($$ select 1 from storage.objects where bucket_id = 'documents' $$,
  'anon reads no documents');
select throws_ok($$ select 1 from public.notifications_sent $$,
  '42501', null, 'anon cannot read notifications_sent');

select * from finish();
rollback;
```

- [ ] **Step 3: Run them to make sure the hardening test fails**

Run: `npx supabase db reset && npm run test:db`
Expected: FAIL. `hardening_test.sql` reports `Looks like you failed 12 tests of 20` (`Failed tests:  1-3, 5-6, 9, 11-14, 16-17`; some fail only because an earlier unguarded update changed the fixture). `access_rules_test.sql` passes: it pins down rules that already hold.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260925000600_hardening.sql`. Notes:
- It replaces `refresh_request_status` and `can_read_document` with `create or replace`, which keeps their grants.
- The request lock cannot be shown in pgTAP, which runs each test in one transaction. With two concurrent sessions, both races above end in the wrong status without the lock and the right one with it.
- The overwrite trigger compares `version`, which Storage changes on every upload, so metadata updates still work.
- The trigger on `auth.users` blanks every password, including the random one Auth stores for code-only users. Nobody knows that one, so nothing that worked stops working.

```sql
-- Hardening: row locks for concurrent reviews and admin changes, overwrite
-- and delete protection for uploaded files, fixed request and item identity,
-- and code-only sign-in.

-- Replaces the version from 20260925000300. The request row is locked first:
-- two item changes on one request would otherwise each compute from a
-- snapshot that misses the other and leave the wrong status (open with every
-- required item accepted, or completed with one returned). Under READ
-- COMMITTED the update below sees the other change once it has committed.
create or replace function public.refresh_request_status(request_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform 1
  from public.requests r
  where r.id = refresh_request_status.request_id
    and r.status in ('open', 'completed')
  for no key update;

  if not found then
    return;
  end if;

  update public.requests r
  set status = computed.status
  from (
    select case
      when exists (
        select 1 from public.request_items i
        where i.request_id = refresh_request_status.request_id and i.required
      )
      and not exists (
        select 1 from public.request_items i
        where i.request_id = refresh_request_status.request_id
          and i.required
          and i.status <> 'accepted'
      )
      then 'completed'
      else 'open'
    end as status
  ) computed
  where r.id = refresh_request_status.request_id
    and r.status <> computed.status;
end;
$$;

-- Only drafts can be deleted, so a sent request never becomes a draft again.
-- Contact access and file paths follow the request's client, and item status
-- follows its request, so neither link ever changes.
create function public.requests_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'draft' and old.status <> 'draft' then
    raise exception 'invalid_state';
  end if;
  if new.client_id <> old.client_id then
    raise exception 'invalid_state';
  end if;
  return new;
end;
$$;

create trigger requests_guard_update
  before update of status, client_id on public.requests
  for each row execute function public.requests_guard_update();

create function public.request_items_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.request_id <> old.request_id then
    raise exception 'invalid_state';
  end if;
  return new;
end;
$$;

create trigger request_items_guard_update
  before update of request_id on public.request_items
  for each row execute function public.request_items_guard_update();

-- Every firm keeps an admin. RLS stops admins from changing their own row,
-- but two admins demoting or removing each other at the same moment would
-- each see the other still in place. Locking the firm row serializes them.
-- A firm that is being deleted takes its members with it.
create function public.firm_members_keep_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin') then
    perform 1 from public.firms f where f.id = old.firm_id for no key update;
    if found and not exists (
      select 1
      from public.firm_members m
      where m.firm_id = old.firm_id
        and m.role = 'admin'
        and m.user_id <> old.user_id
    ) then
      raise exception 'invalid_state';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.firm_members_keep_admin() from public, anon, authenticated;

create trigger firm_members_keep_admin
  before update of role or delete on public.firm_members
  for each row execute function public.firm_members_keep_admin();

-- Replaces the version from 20260925000400: a contact's reads also require
-- the firm segment to match the client's firm.
create or replace function public.can_read_document(name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.firm_members m
    where m.user_id = (select auth.uid())
      and m.firm_id::text = split_part(can_read_document.name, '/', 1)
  )
  or exists (
    select 1
    from public.client_contacts cc
    where cc.user_id = (select auth.uid())
      and cc.firm_id::text = split_part(can_read_document.name, '/', 1)
      and cc.client_id::text = split_part(can_read_document.name, '/', 2)
  );
$$;

-- A contact may delete only an upload that is not registered as a file, so
-- an item_files row never points at a missing object. remove_file deletes
-- the row first, then the caller deletes the object.
create function public.can_delete_document(name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_write_document(can_delete_document.name)
    and not exists (
      select 1
      from public.item_files f
      where f.storage_path = can_delete_document.name
    );
$$;

revoke execute on function public.can_delete_document(text) from public, anon;

drop policy "Contacts can delete from open file items" on storage.objects;

create policy "Contacts can delete unregistered uploads from open file items"
  on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.can_delete_document(name));

-- Signed upload URLs are checked against the policies only when they are
-- created, and the upload itself runs as the storage service, which upserts
-- when the token allows it. So the missing update policy alone does not stop
-- a contact from replacing a file after it was accepted. A new version of an
-- existing document is an overwrite: refuse it. Metadata updates still work.
create function public.documents_no_overwrite()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.bucket_id = 'documents' and new.version is distinct from old.version then
    raise exception 'invalid_state';
  end if;
  return new;
end;
$$;

create trigger documents_no_overwrite
  before update on storage.objects
  for each row execute function public.documents_no_overwrite();

-- Sign-in is by emailed code only. Auth still accepts password sign-ups, and
-- a password someone set before the address's owner first signed in would
-- keep working on the owner's account. Nothing in the app uses passwords, so
-- none is ever stored. This relies on "Confirm email" being on, so that a
-- password sign-up gets no session.
create function public.auth_users_no_password()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.encrypted_password := '';
  return new;
end;
$$;

create trigger auth_users_no_password
  before insert or update of encrypted_password on auth.users
  for each row execute function public.auth_users_no_password();
```

- [ ] **Step 5: Apply it and run the whole suite**

Run: `npx supabase db reset && npm run test:db`
Expected: all twelve files `ok`, `Files=12, Tests=173`, `Result: PASS`.

- [ ] **Step 6: Turn on email confirmation**

The password trigger stops a password from ever working, but with confirmations off, a password sign-up still gets a session for the address right away. Hosted projects have "Confirm email" on by default; turn it on locally too. In `supabase/config.toml`, under `[auth.email]`, replace:

```toml
# If enabled, users need to confirm their email address before signing in.
enable_confirmations = false
```

with:

```toml
# If enabled, users need to confirm their email address before signing in.
# On, as in hosted projects: otherwise a password sign-up gets a session for any address.
enable_confirmations = true
```

Then restart the stack so Auth picks it up:

Run: `npx supabase stop && npx supabase start`
Expected: the same URLs and keys as before. New users now get the "Confirm signup" email, which shows the same code.

- [ ] **Step 7: Lint and regenerate the types**

Run: `npx supabase db lint --level warning && npm run db:types && npm run typecheck`
Expected: `No schema errors found`; `lib/database.types.ts` gains `can_delete_document` under `Functions`; no type errors.

- [ ] **Step 8: Commit**

```bash
git add supabase lib/database.types.ts
git commit -m "feat(db): harden concurrent reviews, uploads, and sign-in"
```
