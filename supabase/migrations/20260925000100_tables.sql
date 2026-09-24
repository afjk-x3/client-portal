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
