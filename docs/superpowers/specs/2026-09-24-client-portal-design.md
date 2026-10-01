# Client Portal: Design Spec

- **Date:** 2026-09-24
- **Status:** Approved 2026-09-24
- **Working name:** Client Portal (one `APP_NAME` constant; rename later)

## 1. Summary

Client Portal is a self-serve, multi-tenant micro-SaaS for small accounting, bookkeeping, and law firms. A firm sends a client a checklist of requested documents and questions. The client signs in with a 6-digit code sent by email. They upload files or answer questions item by item, then submit each item. Staff accept each item or return it with a note. Daily reminders chase open items. A daily digest tells staff what arrived. The product replaces the email back-and-forth of tax season.

### Success criteria for v1

- A new firm can sign up, add a client, and send its first request in under 10 minutes without help.
- A client can complete a request on a phone without creating a password.
- Automated database tests prove two isolation rules: no firm can read another firm's data, and no client can read another client's data.
- One staff screen shows which clients are blocking which requests.

## 2. Decisions

| Topic | Decision |
|---|---|
| Product type | Self-serve multi-tenant micro-SaaS |
| Billing | None in v1 (free beta). `firms.plan` defaults to `'beta'` so billing can be added later. |
| Client access | Real Supabase accounts. Sign-in uses a 6-digit email code (OTP). No passwords and no clickable magic links. |
| Client model | A client (household or business) has many contacts. Each contact is a login. |
| Staff roles | `admin` and `staff`. Every staff member sees every client in the firm. |
| Item kinds | `file` (upload one or more files) or `text` (short written answer) |
| Review | Staff accept an item, or return it as `needs_changes` with a note. |
| Emails | Staff added, request sent, item needs changes, daily reminders, daily staff digest |
| Architecture | Next.js monolith on Vercel plus Supabase. Vercel Cron runs daily jobs. Resend sends email. |

Magic links are rejected because corporate email scanners often open a link before the client does, which uses up the token. A code also keeps working when the client opens a reminder days later, because emails link to app pages, not to sign-in tokens.

## 3. Stack

- **Next.js 16 App Router:** React 19, TypeScript in strict mode, `cacheComponents: true`, and `proxy.ts` for session refresh.
- **Supabase:** Postgres 15+ with RLS, Auth (email OTP), and Storage, accessed through `@supabase/ssr` and `@supabase/supabase-js`. The Supabase CLI handles local development, migrations, type generation, and pgTAP tests.
- **Tailwind CSS v4 and shadcn/ui:** Sidebar, DataTable (TanStack Table), Sheet, Dialog, AlertDialog, Form, Calendar, Popover, Tabs, Badge, Progress, Alert, and Sonner.
- **zod:** validation schemas shared by forms and Server Actions.
- **Resend:** transactional email. In production, Resend is also the custom SMTP server for Supabase Auth.
- **`client-zip`:** streaming zip downloads.
- **Testing:** Vitest for unit tests and Playwright for one end-to-end test.

The plan must justify any other runtime dependency. Item reordering uses up and down buttons, not a drag-and-drop library. File picking uses a native `<input type="file" multiple>` plus native drag events, not an upload library.

## 4. Users and roles

| Actor | How they get access | Permissions |
|---|---|---|
| Firm admin | Signs up and creates a firm during onboarding | Everything staff can do, plus managing the team and firm settings |
| Staff | Added by an admin | Manage clients, contacts, templates, and requests; review items |
| Client contact | Added to a client by staff | View their clients' requests; upload, answer, and submit open items |

- A user can be staff of **at most one** firm in v1.
- A user can be a contact of any number of clients, across any number of firms.
- A user can be both staff and a contact. After sign-in such a user lands in `/app` and can open `/portal` directly.

## 5. Scope

### In v1

1. Firm signup and onboarding. Onboarding creates the firm and seeds one starter template (see section 17).
2. Team management (admins only): add staff by email, change roles, remove staff.
3. Clients and contacts: create, edit, archive, and unarchive clients; add and remove contacts.
4. Templates: create, edit, and delete templates with ordered items.
5. Requests:
   - Create from a template or blank.
   - Edit freely while in draft.
   - Send.
   - Make limited edits while open (section 7.3).
   - Archive and unarchive.
   - Delete drafts.
6. Client portal: list requests; upload files, answer questions, and submit items; see review notes.
7. Review: accept an item, or return it with a note. Requests complete automatically.
8. Staff dashboard with two tabs: "Waiting on clients" and "Ready for review".
9. Downloads: single files for staff and clients, and a zip of a whole request for staff.
10. Emails and daily jobs (section 11).
11. Data retention: an admin sets how long files from archived requests are kept, and the daily cleanup job expires them after that period. Account and firm deletion stay manual.

### Out of scope for v1

- Billing
- E-signature
- A questionnaire builder with typed fields or conditional logic
- OCR or AI document classification
- Account or firm deletion (handled manually)
- Custom branding or domains
- "Assigned clients only" permissions
- Staff uploading files for a client
- Staff belonging to several firms
- Changing a user's email address
- Per-firm time zones
- Virus scanning
- An audit log beyond the reviewer and uploader fields
- Drag-and-drop reordering

## 6. Architecture

```
Browser ──► Next.js on Vercel ──(user-scoped client, RLS)──► Postgres
   │           Server Components, Server Actions,
   │           Route Handlers, proxy.ts
   │           └── after() ──► Resend
   │
   └── direct upload (signed upload URL) ──► Supabase Storage

Vercel Cron (daily) ──► /api/cron/daily ──(service-role client)──► Postgres, Resend
```

Principles:

- **RLS is the security boundary.** User-facing code always uses the user-scoped Supabase client. Layout checks only decide where to send a user; they are not a security boundary.
- **Client writes go through RPCs.** Clients change data only through `security definer` RPCs that check state. Staff writes use normal table access guarded by RLS.
- **The service-role client has three uses.** It lives in `lib/supabase/admin.ts`, which imports `server-only`. Only the two cron routes and `ensureUser()` may call it (section 10.1).
- **Files never pass through Vercel functions.** Vercel caps function request bodies at about 4.5 MB, so the browser uploads directly to Storage.

## 7. Data model

### 7.1 Conventions

- **Standard columns:** Every table has `id uuid primary key default gen_random_uuid()` and `created_at timestamptz not null default now()`, unless the table notes a composite primary key.
- **Enumerations:** stored as `text` columns with `check` constraints.
- **Tenant isolation:**
  - Every table except `firms` and `notifications_sent` has a `firm_id` column.
  - A child table references its parent by `(parent_id, firm_id)`, through a composite foreign key to a `unique (id, firm_id)` constraint on the parent.
  - As a result, a row can never point at another firm's parent row.
- **Indexes:** Every foreign key is indexed, and so is every column that the RLS helper functions filter on.
- **Text limits** are enforced by `check` constraints and by the matching zod schemas:
  - names and titles: 1 to 200 characters
  - descriptions: 2,000 characters or fewer
  - text answers: 5,000 characters or fewer
  - review notes: 1 to 1,000 characters
  - filenames: 255 characters or fewer
  - firm names: 1 to 120 characters

### 7.2 Tables

**`firms`**

| Column | Type | Notes |
|---|---|---|
| `name` | text | 1 to 120 characters |
| `plan` | text | `default 'beta'` |

**`firm_members`**: primary key `(firm_id, user_id)`

| Column | Type | Notes |
|---|---|---|
| `firm_id` | uuid | references `firms`, on delete cascade |
| `user_id` | uuid | references `auth.users`, on delete cascade; **`unique`** (one firm per staff user) |
| `role` | text | `admin` or `staff` |
| `full_name` | text | Needed because the UI cannot read `auth.users` |
| `email` | text | Used for digests, reply-to headers, and the team list |

**`clients`**: `unique (id, firm_id)`

| Column | Type | Notes |
|---|---|---|
| `firm_id` | uuid | references `firms` |
| `name` | text | |
| `kind` | text | `individual` or `business`; default `individual` |
| `owner_id` | uuid, nullable | Staff owner, display only. Composite FK `(firm_id, owner_id)` to `firm_members (firm_id, user_id)` `on delete set null (owner_id)` |
| `archived_at` | timestamptz, nullable | |

**`client_contacts`**: primary key `(client_id, user_id)`

| Column | Type | Notes |
|---|---|---|
| `client_id`, `firm_id` | uuid | FK `(client_id, firm_id)` to `clients`, on delete cascade |
| `user_id` | uuid | references `auth.users`, on delete cascade; indexed |
| `full_name` | text | |
| `email` | text | Copied from the auth user at creation |

**`templates`**: `unique (id, firm_id)`. Columns: `firm_id`, `name`.

**`template_items`**

| Column | Type | Notes |
|---|---|---|
| `template_id`, `firm_id` | uuid | FK `(template_id, firm_id)` to `templates`, on delete cascade |
| `position` | int | Sort by `position`, then `id` |
| `title` | text | |
| `description` | text, nullable | |
| `kind` | text | `file` or `text` |
| `required` | boolean | default `true` |

**`schedules`**: `unique (id, firm_id)`; index `(template_id, firm_id)`, index on `created_by`

| Column | Type | Notes |
|---|---|---|
| `firm_id` | uuid | |
| `template_id` | uuid | FK `(template_id, firm_id)` to `templates`, on delete cascade |
| `title` | text | 1 to 180 characters |
| `every_months` | smallint | 1, 3, or 12 |
| `day_of_month` | smallint | 1 to 31; set from the date when a date changes |
| `next_send_on` | date | Required |
| `due_after_days` | smallint | 1 to 365 |
| `paused` | boolean | default `false` |
| `created_by` | uuid, nullable | references `auth.users`, on delete set null |
| `last_sent_on` | date, nullable | |

**`schedule_clients`**: primary key `(schedule_id, client_id)`

| Column | Type | Notes |
|---|---|---|
| `schedule_id`, `firm_id` | uuid | FK `(schedule_id, firm_id)` to `schedules`, on delete cascade |
| `client_id`, `firm_id` | uuid | FK `(client_id, firm_id)` to `clients`, on delete cascade |

**`requests`**: `unique (id, firm_id)`; index `(firm_id, status)`

| Column | Type | Notes |
|---|---|---|
| `firm_id`, `client_id` | uuid | FK `(client_id, firm_id)` to `clients`, on delete cascade |
| `title` | text | |
| `due_date` | date | Required |
| `status` | text | `draft`, `open`, `completed`, or `archived`; default `draft` |
| `sent_at` | timestamptz, nullable | |
| `message` | text, nullable | Optional personal message to the client; 1 to 2,000 characters when present |
| `created_by` | uuid, nullable | references `auth.users`, on delete set null |

**`request_items`**: `unique (id, firm_id)`

| Column | Type | Notes |
|---|---|---|
| `request_id`, `firm_id` | uuid | FK `(request_id, firm_id)` to `requests`, on delete cascade |
| `position`, `title`, `description`, `kind`, `required` | | Same as `template_items` |
| `status` | text | `requested`, `submitted`, `needs_changes`, or `accepted`; default `requested` |
| `text_answer` | text, nullable | |
| `review_note` | text, nullable | |
| `submitted_at`, `reviewed_at` | timestamptz, nullable | |
| `reviewed_by` | uuid, nullable | references `auth.users`, on delete set null |

**`item_files`**

| Column | Type | Notes |
|---|---|---|
| `item_id`, `firm_id` | uuid | FK `(item_id, firm_id)` to `request_items`, on delete cascade |
| `storage_path` | text | `unique` |
| `filename` | text | The original filename, used for display and downloads |
| `size_bytes` | bigint | Read from Storage metadata, not from client input |
| `mime` | text | Read from Storage metadata |
| `uploaded_by` | uuid, nullable | references `auth.users`, on delete set null |

**`item_messages`**: index `(item_id, created_at)`; a partial index on `(firm_id)` where a client message is unread

| Column | Type | Notes |
|---|---|---|
| `firm_id`, `client_id`, `request_id`, `item_id` | uuid | Only `(item_id, firm_id)` is a foreign key, to `request_items (id, firm_id)`, on delete cascade; `client_id` and `request_id` are plain copies, so there is no path from a message to `requests` |
| `author_id` | uuid | No foreign key: a message outlives its author's account |
| `author_name` | text | The display name, copied at write time |
| `by_staff` | boolean | Whether the firm's member wrote it |
| `body` | text | 1 to 2,000 characters, line breaks kept |
| `read_at` | timestamptz, nullable | Null until staff have seen the message; a check keeps it null on staff messages |
| `created_at` | timestamptz | |

Only the two functions in §8.3 write rows: insert, update, and delete are revoked from `anon` and `authenticated`.

**`notes`**: index `(client_id, created_at)` and `(request_id, created_at)`

| Column | Type | Notes |
|---|---|---|
| `firm_id`, `client_id` | uuid | FK `(client_id, firm_id)` to `clients`, on delete cascade |
| `request_id` | uuid, nullable | null for a client note; FK `(request_id, client_id)` to `requests (id, client_id)`, on delete cascade (`requests` is `unique (id, client_id)`), so a note stays on its own client's request |
| `author_id` | uuid | default `auth.uid()`; no foreign key: a note outlives its author |
| `body` | text | 1 to 2,000 characters, line breaks kept |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz, nullable | null until the first edit; a `before update` trigger sets it |

**`notifications_sent`**: internal table with no `firm_id`; only the service role can access it.

| Column | Type | Notes |
|---|---|---|
| `kind` | text | `reminder` or `staff_digest` |
| `target_id` | uuid | Request id for reminders; staff user id for digests |
| `sent_on` | date | UTC date |

Constraint: `unique (kind, target_id, sent_on)`.

**`email_outbox`**: internal table like `notifications_sent`; app roles have no access, only the service role. Rows hold references only, never content.

| Column | Type | Notes |
|---|---|---|
| `firm_id` | uuid | references `firms`, on delete cascade |
| `kind` | text | `request_sent`, `needs_changes`, `reminder`, `staff_added`, `staff_digest`, or `item_message` |
| `recipient` | text | The address, chosen by the database functions, never passed by a caller |
| `request_id`, `item_id`, `reply_to_id` | uuid, nullable | Composite FKs to `requests` / `request_items` `(id, firm_id)`, on delete cascade |
| `window_start`, `window_end` | timestamptz, nullable | The digest window; both required for `staff_digest` |
| `failures` | smallint | default `0` |
| `send_after` | timestamptz | When the row becomes claimable; a claim leases it for an hour |
| `created_at` | timestamptz | default `now()` |

Constraints: a check ties `request_id`, `item_id`, and the window bounds to `kind`, and `unique nulls not distinct (kind, recipient, request_id, item_id, window_end)` keeps one waiting email of each kind per recipient; queuing again replaces the waiting row.

When a template is applied to a request, its items are **copied** into `request_items`. Later edits to the template never change requests that already exist.

### 7.3 Status rules

**Request lifecycle**

| From | Action | To | Rule |
|---|---|---|---|
| `draft` | Send | `open` | The request must have at least one required item. |
| `open` / `completed` | Item change | `completed` / `open` | Automatic, by trigger (see below). |
| `open` / `completed` | Archive | `archived` | Stops reminders. |
| `archived` | Unarchive | `open` or `completed` | Whichever the items call for, in one step (`unarchive_request`). |
| `draft` | Delete | none | Only drafts can be deleted (RLS delete policy). |

**Completion trigger.** After an insert, a delete, or an update of `status` or `required` on `request_items`, the trigger calls `refresh_request_status(request_id)`. For a request in `open` or `completed`, that function sets:

- `completed` when the request has at least one required item and every required item is `accepted`;
- `open` otherwise.

The function does nothing to requests in any other status.

**Item state machine**

| From | Action | Actor | To |
|---|---|---|---|
| `requested`, `needs_changes` | Submit | Contact, through `submit_item` | `submitted` |
| Any state except `accepted` | Accept | Staff | `accepted` |
| `submitted`, `accepted` | Return with note | Staff | `needs_changes` |

Staff can accept an item in any state. This covers documents that arrive outside the portal, such as paper copies.

An **open item** is an item in `requested` or `needs_changes`. The dashboard, the reminders, and the portal all use this definition.

**Editing rules** (enforced in Server Actions):

- **Draft:** everything can be edited, including adding, removing, and reordering items.
- **Open or completed:**
  - Title and due date can be edited.
  - Items can be added. Adding a required item to a completed request reopens it through the trigger.
  - An item can be removed only while it is `requested` and has no files.
- **Limits:** at most 100 items per request and at most 20 files per item.

## 8. Authorization

### 8.1 Helper functions

Every helper is `security definer`, `stable`, and sets `set search_path = ''`. Each one uses `(select auth.uid())`.

- `is_firm_member(firm_id uuid)`
- `is_firm_admin(firm_id uuid)`
- `is_client_contact(client_id uuid)`
- `is_firm_contact(firm_id uuid)`: true when the caller is a contact of any client in the firm.
- `can_read_document(name text)` and `can_write_document(name text)`: parse a Storage path. For a malformed path they return `false` and never raise, so a cast error cannot break a Storage query.

### 8.2 Table policies

RLS is enabled on every table. A table with no policy for a role grants that role no access.

| Table | Staff (firm member) | Admin only | Client contact |
|---|---|---|---|
| `firms` | select | update | select, via `is_firm_contact(id)` |
| `firm_members` | select | insert; update and delete only for rows where `user_id` is not the caller | none |
| `clients` | select, insert, update | delete, only for archived clients | select, via `is_client_contact(id)` |
| `client_contacts` | all | none | none |
| `templates`, `template_items` | all | none | none |
| `schedules`, `schedule_clients` | select, insert, delete; update of `schedules` only `title`, `every_months`, `day_of_month`, `next_send_on`, `due_after_days`, and `paused` | none | none |
| `requests` | select, insert, update; delete only when `status = 'draft'` | none | select when `status <> 'draft'` and `is_client_contact(client_id)` |
| `request_items` | all | none | select when the parent request is visible to the contact (the policy subquery on `requests` goes through `requests` RLS) |
| `item_files` | select | none | select when the parent item is visible to the contact (goes through `request_items` RLS) |
| `item_messages` | select | none | select, via `is_client_contact(client_id)`; no write for anyone, the functions in §8.3 write |
| `notes` | select, insert; update and delete only for the caller's own notes, and only `body` can be updated | none | none |
| `notifications_sent` | none | none | none |
| `email_outbox` | none | none | none |

Two guarantees follow from these policies:

- An admin cannot change or remove their own membership, so every firm always keeps at least one admin.
- Clients never get a direct insert, update, or delete on any table.

### 8.3 RPCs

Every RPC in this table is `security definer` with `set search_path = ''`, except `refresh_request_status`, `unarchive_request`, `template_from_request`, and `retention_preview`. Those are security invoker: staff calls run under RLS, and calls made from inside a definer RPC run with the RPC owner's rights. The first two take the completion rule from `computed_request_status`. `save_schedule` and `set_schedule_paused` are also security invoker, and `next_schedule_date` is `immutable`.

| Function | Caller | Checks | Effect |
|---|---|---|---|
| `create_firm(name, full_name)` | Signed-in user who is not already staff | Name length | Inserts the firm, an admin membership (email taken from `auth.jwt()`), and the starter template. Returns the firm id. |
| `submit_item(item_id, text_answer)` | Contact | The request is `open`. The item is `requested` or `needs_changes`. A file item has at least one file. A text item has an answer of 1 to 5,000 characters. | Sets `status = 'submitted'` and `submitted_at = now()`. Saves `text_answer` for text items. |
| `register_file(item_id, storage_path, filename)` | Contact | The same open-item checks. The item kind is `file`. The path starts with `{firm_id}/{client_id}/{item_id}/`. The object exists in the `documents` bucket. The item has fewer than 20 files. | Inserts into `item_files`, taking `size_bytes` and `mime` from `storage.objects.metadata`. Sets `uploaded_by` to the caller. |
| `remove_file(file_id)` | Contact | The same open-item checks | Deletes the row and returns `storage_path`. |
| `post_item_message(item_id, body)` | Staff of the item's firm, or a contact of its client; execute revoked from `public` and `anon` | Definer: `is_firm_member`, or `is_client_contact` on a non-draft. The request is `open` or `completed`. | Inserts the message. A staff message marks the item's unread client messages read and queues one `item_message` email per contact, held for an hour; a contact's message queues nothing. Returns `(email_id, recipient)`, empty for a contact's message. |
| `mark_item_messages_read(item_id)` | Staff of the item's firm; execute revoked from `public` and `anon` | Definer: `is_firm_member` | Sets `read_at = now()` on the item's unread client messages. |
| `refresh_request_status(request_id)` | The trigger | Security invoker, so RLS applies | Recomputes the request status. |
| `unarchive_request(request_id)` | Staff (for Unarchive) | Security invoker, so RLS applies. The request is `archived`. | Sets `open` or `completed`, whichever the items call for, in one statement, so the timeline records one `unarchived` event. Returns the id, or null when nothing changed. |
| `template_from_request(request_id)` | Staff (Save as template) | Security invoker, so RLS applies. Not a draft. | Creates a template named after the request, with its items renumbered, and returns its id or null. |
| `retention_preview(years)` | Firm member (`is_firm_member`); execute revoked from `public` and `anon` | Security invoker, so RLS applies | Returns how many of the firm's archived requests are past the period with files still attached. |
| `expire_files(max_rows)` | `service_role` only; execute is revoked from `public`, `anon`, and `authenticated` | None | Deletes files from archived requests past their firm's retention period, up to `max_rows`, stamps `files_deleted_at` on the touched requests, and logs a `file_removed` event per request. Returns the number of files deleted. |
| `admin_user_id_by_email(email)` | `service_role` only; execute is revoked from `public`, `anon`, and `authenticated` | None | Returns the `auth.users` id. |
| `queue_request_emails(kind, request_id, item_id)` | Staff member of the request's firm | Definer: `is_firm_member`; `request_sent` requires a `draft`, `needs_changes` a submitted or accepted item of an open or completed request, and `reminder` is refused | Queues one outbox row per contact of the client **before** the action changes anything, replacing a waiting row. Returns `(email_id, recipient)`, so the action can send at once. |
| `queue_staff_added(user_id)` | Admin | Definer: the caller is an admin; a user who already belongs to a firm raises the unique-violation code | Queues the invitation before the membership row exists, then returns the row id. |
| `claim_due_emails(max_rows)` | `service_role` only; execute is revoked from `public`, `anon`, and `authenticated` | None | Leases the oldest due outbox rows for an hour with `for update skip locked`, so no two runs send the same row, and returns them. |
| `record_email_result(email_id, reason, retry)` | Staff of the row's firm (the action's `after()` records it through the user-scoped client), or `service_role`; execute revoked from `public` and `anon` | Firm member only: an outcome recorded by staff of another firm, or by a contact, changes nothing; the service role bypasses | Applies one outcome: sent deletes the row (logging `email_sent_late` when it had failed before); a retryable failure with fewer than 3 failures keeps it an hour later; anything else deletes it and logs `email_failed` on the request. |
| `save_schedule(schedule_id, template_id, title, every_months, next_send_on, due_after_days, client_ids)` | Staff; security invoker, execute revoked from `public` and `anon` | RLS decides: the template is visible on create, the schedule on update; otherwise `not_allowed`, and a missing schedule raises `invalid_state`. A null `schedule_id` creates; a null `next_send_on` keeps the current date. | Creates or updates the schedule and replaces its client list in one transaction, setting `day_of_month` from the date. Returns the id. |
| `set_schedule_paused(schedule_id, paused)` | Staff; security invoker, execute revoked from `public` and `anon` | RLS decides; returns null when the schedule is missing or already in that state | Pauses or resumes. Resuming moves a `next_send_on` at or before today past today, so dates missed while paused are not sent. Returns the id. |
| `next_schedule_date(from_date, every_months, day_of_month, after)` | Staff; `immutable`, execute revoked from `public` and `anon` | None | The first date after `after` in the series stepping `every_months` months, each on `day_of_month` or the month's last day when the month is shorter. |
| `send_scheduled_requests(schedule_id, today)` | `service_role` only; execute is revoked from `public`, `anon`, and `authenticated` | The schedule is not paused and is due; the template has a required item | Per eligible client (not archived, at least one contact): creates an open request titled `{title} – {period}`, copies the template's items, queues `request_sent`, and logs one `sent` event with no actor. Always moves `next_send_on` past `today`, and sets `last_sent_on` when it sent. Returns the number created. |

Client-facing RPCs raise an exception with one of two messages:

- `not_allowed`: the caller has no access, or the row was not found.
- `invalid_state`: the row is in the wrong status.

`lib/errors.ts` maps these messages to user-facing text.

### 8.4 Storage

**Bucket.** `documents` is private and is created by a migration. It allows files up to 25 MB and these declared MIME types:

- PDF
- JPEG, PNG, WebP, HEIC
- CSV
- XLS, XLSX
- DOC, DOCX

**Path.** Every object is stored at `{firm_id}/{client_id}/{item_id}/{random uuid}-{safe name}`.

- `safe name` replaces every character outside `[A-Za-z0-9._-]` with `_` and is truncated to 100 characters.
- `item_files.filename` keeps the original filename.

**Policies on `storage.objects`.** Every policy also requires `bucket_id = 'documents'`.

| Operation | Condition |
|---|---|
| Select | `can_read_document(name)`: the caller is a member of the firm in segment 1, or a contact of the client in segment 2. |
| Insert and delete | `can_write_document(name)`, which requires all of the following: the caller is a contact of the client in segment 2; the item in segment 3 belongs to that client and to the firm in segment 1; the item kind is `file`; the item status is `requested` or `needs_changes`; the request is `open`. |
| Update | No policy, so objects can never be overwritten. |

**Downloads.** File links point to `/api/files/[fileId]`. The handler:

1. Selects the `item_files` row with the user-scoped client (RLS decides access).
2. Creates a 60-second signed URL with the user-scoped client.
3. Redirects to it.

With `?download=1` the handler sets the `download` option to the original filename. Otherwise the file opens in a new tab.

## 9. Routes and screens

### 9.1 Public

- **`/`:** static landing page with a call to action that links to `/login`.
- **`/login`:** The user enters an email, then the 6-digit code.
  - Code request: `signInWithOtp({ email, options: { shouldCreateUser: true } })`.
  - Code check: `verifyOtp({ email, token, type: 'email' })`.
  - Destination after sign-in:
    1. The `next` parameter, if it is a safe relative path (see `safeNextPath`).
    2. Otherwise `/app` for staff.
    3. Otherwise `/portal` for contacts.
    4. Otherwise `/onboarding`.
- **`/onboarding`:** A form asks for the firm name and the user's full name, then calls `create_firm` and redirects to `/app`. A user who is already staff is redirected to `/app`.

`proxy.ts` refreshes the Supabase session. It redirects signed-out users away from `/app`, `/portal`, and `/onboarding` to `/login?next=…`. It never redirects `/api/*` routes. API handlers check the session themselves, and the cron route uses a bearer secret.

### 9.2 Staff area: `/app`

The layout uses the shadcn Sidebar. It sends non-members to `/portal` if they are contacts, and to `/onboarding` if they are not.

- **`/app` (dashboard)** has two Tabs. Each tab is a DataTable sorted by date.
  - **Waiting on clients:** one row per open request that still has items in `requested` or `needs_changes`. Columns: client, request title, due date, open item count, and an Overdue badge when `due_date` is before today (UTC).
  - **Ready for review:** one row per `submitted` item. Columns: client, request, item, and submitted time.
- **`/app/clients`:** DataTable with name search and a "Show archived" toggle. A "New client" Dialog collects name, kind, and owner.
- **`/app/clients/[id]`:**
  - Client details.
  - Contacts: add through a Dialog; remove through an AlertDialog.
  - The client's requests, with a "New request" button.
  - Archive and unarchive.
- **`/app/requests/new?client=<id>`:**
  - Template picker, or "Start blank".
  - Title, and a due date (Calendar in a Popover).
  - Item editor: add, edit, remove, move up, move down.
  - **Save draft** and **Send** buttons.
- **`/app/requests/[id]`:**
  - **Draft:** the same editor, plus **Delete draft**.
  - **Sent:** the review view.
    - The item list shows a status Badge for each item. Clicking an item opens a Sheet, which contains:
      - the description and the text answer;
      - files with **Open** and **Download** links;
      - the current review note;
      - **Accept** and **Needs changes** (the note is required);
      - **Remove item**, when section 7.3 allows it.
    - Header actions: edit title and due date, **Add item**, **Download all (.zip)**, and **Archive** or **Unarchive**.
- **`/app/templates` and `/app/templates/[id]`:** the template list and the template editor. The editor reuses the item editor component.
- **`/app/settings`:**
  - Firm name, editable by admins.
  - Team table: an "Add staff" Dialog (email, name, role), role changes, and removal. An admin's own row is read-only.

### 9.3 Client area: `/portal`

The portal is mobile-first with a single column.

- **`/portal`:**
  - **Open requests:** each shows a progress bar.
  - **Past requests:** completed and archived requests.
  - Requests are grouped by firm when the user is a contact at more than one firm. A user with no contact rows sees an empty state.
  - **Progress** is the number of required items that are `submitted` or `accepted`, divided by the number of required items.
- **`/portal/requests/[id]`:** a progress bar, then one Card per item. Each Card shows:
  - the title, the description, a Required or Optional label, and a status Badge;
  - for `needs_changes` items, the review note in an Alert;
  - for file items: a multi-file picker with native drag-and-drop, and the list of uploaded files, each with **Download** and **Remove**;
  - for text items: a Textarea;
  - a **Submit** button for the item.

  The page is read-only unless the request is `open`.

### 9.4 Rendering and actions

- **Session reads:** Layouts and pages read the session inside `<Suspense>` boundaries, as `cacheComponents` requires. No user data uses `'use cache'` in v1. The landing page is fully static.
- **Hidden records:** A record hidden by RLS renders `notFound()`. The app never returns a 403, because a 403 would reveal that the record exists.
- **Server Actions** live in an `actions.ts` file per route segment. Each action:
  1. validates its input with zod;
  2. uses the user-scoped client;
  3. returns `{ ok: true, data? }` or `{ ok: false, error }`;
  4. revalidates the affected path.

  Forms use `useActionState` and Sonner toasts.

## 10. Key flows

### 10.1 `ensureUser(email)`

This is a server-only helper that uses the service-role client.

1. It calls `auth.admin.createUser({ email, email_confirm: true })`, which sends no email.
2. If the result has error code `email_exists`, it calls `admin_user_id_by_email`.
3. It returns the user id.

The Server Actions that call `ensureUser` first confirm the caller's role with the user-scoped client. No auth user is created for an unauthorized caller.

### 10.2 Add staff (admins only)

1. Confirm that the caller is an admin.
2. Call `ensureUser(email)`.
3. Insert the `firm_members` row. RLS allows this for admins only. A violation of the unique `user_id` constraint shows the message "This person already belongs to a firm."
4. In `after()`, send the `staff_added` email.

### 10.3 Add contact (staff)

1. Confirm that the caller is a firm member.
2. Call `ensureUser(email)`.
3. Insert the `client_contacts` row.

No email is sent at this point. A contact's first email is `request_sent`.

### 10.4 Send a request

1. Validate that the request has at least one required item and a due date.
2. Run `update requests set status = 'open', sent_at = now() where id = $1 and status = 'draft' returning id`. Continue only if a row came back. This makes double-clicks safe.
3. Load the contacts and the firm name. In `after()`, send a `request_sent` email to each contact, with reply-to set to the sender.

### 10.5 Upload (contact)

1. "Scan pages" joins a photo set into one PDF in the browser before the usual upload: each photo becomes one A4 page, and the PDF then follows the steps below.
2. The browser checks file size and type. This check is for user experience only; the bucket and the policies enforce the real limits.
3. The Server Action `createUploadUrl(itemId, filename)` builds the object path. It calls `can_write_document(path)` through RPC and stops with `not_allowed` if the result is false. Only then does it call `createSignedUploadUrl` with the user-scoped client. The explicit check means safety does not depend on when Storage evaluates its insert policy for signed uploads.
4. The browser calls `uploadToSignedUrl(path, token, file)`. It uploads files one at a time and shows a status for each file: pending, uploading, done, or failed with a retry button.
5. The Server Action `registerFile(itemId, path, filename)` calls the `register_file` RPC, then revalidates the page.

To remove a file:

1. The Server Action calls the `remove_file` RPC.
2. It deletes the object with the user-scoped client, which the Storage delete policy allows.

### 10.6 Submit an item (contact)

The Server Action calls the `submit_item` RPC.

### 10.7 Review an item (staff)

- **Accept:**

  ```sql
  update request_items
  set status = 'accepted', review_note = null, reviewed_by = $user, reviewed_at = now()
  where id = $1 and status <> 'accepted'
  returning id
  ```

- **Needs changes** (note of 1 to 1,000 characters required):

  ```sql
  update request_items
  set status = 'needs_changes', review_note = $note, reviewed_by = $user, reviewed_at = now()
  where id = $1 and status in ('submitted', 'accepted')
  returning id
  ```

  If a row came back, `after()` sends a `needs_changes` email to each contact, with reply-to set to the reviewer.

In both cases the completion trigger then updates the request status.

### 10.8 Zip download (staff)

`GET /api/requests/[id]/zip`:

1. The caller must be a member of the request's firm.
2. The handler lists the request's `item_files` rows.
3. It streams the files with `client-zip` `downloadZip`. Each entry is named `{NN} {item title}/{filename}`. Names are sanitized, and duplicates get a numeric suffix.

The route sets `maxDuration = 300`.

## 11. Email and daily jobs

### 11.1 Sending

- **Wrapper:** `lib/email/send.ts` wraps Resend. When `RESEND_API_KEY` is unset (development and tests), the wrapper logs each message instead of sending it.
- **Templates:** plain TypeScript functions that return `{ subject, html, text }`. They HTML-escape every interpolated value.
- **Sender:** `EMAIL_FROM`, with the display name "{Firm name} via Client Portal".
- **Links:** absolute URLs built from `NEXT_PUBLIC_SITE_URL`. They point to app pages, never to auth tokens.
- **Event emails** are queued in `email_outbox` (§7.2) through §8.3's functions **before the action changes anything**; the queue doubles as validation, so a rejected call raises the usual `not_allowed` or `invalid_state` error and changes nothing. The Server Action gathers all the data it needs; `after()` sends the queued rows at once and `record_email_result` deletes each row it sends. A failed send is logged as an `email_failed` Activity event, stays in the outbox, and goes out in a later daily run (§11.2).

| Email | Trigger | Recipients | Content | Reply-to |
|---|---|---|---|---|
| `staff_added` | Admin adds staff | The new staff member | Firm name, sign-in link | The admin |
| `request_sent` | Send | Every contact of the client | Firm, title, due date, item count, link | The sender |
| `needs_changes` | Staff return an item | Every contact of the client | Item title, note, link | The reviewer |
| `reminder` | Daily cron | Every contact of the client | Open items, due date, overdue flag, link | The request creator, if still a member |
| `staff_digest` | Daily cron | Every member of the firm | Submitted items and new client message counts, grouped by client and request, with links | None |
| `item_message` | Staff write on an item | Every contact of the client | Firm, item title, the message, link | The staff member |

### 11.2 Daily cron

- **Schedule:** `vercel.json` contains `{"crons":[{"path":"/api/cron/daily","schedule":"0 1 * * *"}]}`: 01:00 UTC, 9 am in UTC+8, where the first customers are. On the Hobby plan the job runs once, at some point within that hour.
- **Authentication:** `GET /api/cron/daily` returns 401 unless the request has the header `Authorization: Bearer ${CRON_SECRET}`. The route sets `maxDuration = 300` and uses the service-role client.
- **Date:** `today` is the current UTC date.

**Reminders.**

1. Candidates are requests that are `open`, whose client is not archived, and that have at least one item in `requested` or `needs_changes`.
2. For each candidate where `reminderDue({ dueDate, sentOn, today })` is true, claim a row:

   ```sql
   insert into notifications_sent (kind, target_id, sent_on)
   values ('reminder', request_id, today)
   on conflict do nothing
   returning id
   ```

3. If the claim returns a row, queue one outbox email per contact.

**`reminderDue`** (pure function in `lib/reminders.ts`). Let `d` be `dueDate − today` in days.

- Return false when `sentOn = today`.
- Return true when `d = 7`, when `d = 0`, or when `d < 0` and `−d` is divisible by 3.
- Return false in every other case.

**Staff digest.** For each staff member:

1. The window starts at the `created_at` of their latest earlier `staff_digest` claim, or 24 hours ago if there is none. Because of this, a missed day is covered by the next run.
2. Select items in their firm with `submitted_at` in the window, and client messages (`by_staff = false`) with `created_at` in the window.
3. If there are neither, skip the member without claiming.
4. Otherwise claim `('staff_digest', user_id, today)`, then queue an outbox row. The email lists the submitted items as always, and a "New messages" section with each item's message count, grouped like the items.

**Schedules.** After a firm's reminders and digests are claimed, each of its schedules that is not paused and whose `next_send_on` is at or before the firm's local today is sent through `send_scheduled_requests(schedule_id, today)` — one transaction per schedule, so a failure fails that firm while the firm's earlier schedules, reminders, and digests stand. The route's JSON summary includes `scheduled`, the number of requests created.

**Delivery.**

- After each firm's claims, its outbox rows are upserted with `failures = 0` and `send_after = now`, replacing any waiting row of the same kind.
- `sendDueEmails` then loops: `claim_due_emails(100)` leases due rows for an hour, `renderQueued` rebuilds each email from current data (a row whose request is no longer open, was archived, is already covered, or whose recipient left the firm maps to null and is deleted unsent as `dropped`), messages go out with `resend.batch.send` at most 100 per call, and `record_email_result` records each outcome — until a claim returns nothing.
- A failed send keeps its row for an hour, up to 3 failures; then it is dropped with an `email_failed` event (`outcome` `retrying`, `gave_up`, or `failed`). A row that succeeds after an earlier failure logs `email_sent_late`. An email is therefore sent at most once, and retries happen in later runs.
- Each firm is processed inside its own try/catch block. A database error in the send loop stops it and sets `outboxFailed`. The route logs a JSON summary of the counts; it returns an error status when any firm failed, the send loop errored, or any row ended retrying or gave up.

## 12. Error handling

- **Expected failures** return `{ ok: false, error }`, which the UI shows as a toast. These include:
  - zod validation errors;
  - `not_allowed` and `invalid_state`;
  - unique constraint violations.
- **Unexpected exceptions** reach the segment's `error.tsx`, which shows a generic message and logs the error.
- **Upload failures** mark the file as failed and offer a retry. Nothing is registered for a failed upload.
- **Email failures** are logged only. **Cron failures** are isolated per firm.

## 13. Security

- **Tenant isolation:** RLS on every table, plus `firm_id` on every tenant table with composite foreign keys.
- **Client writes:** only through RPCs that check state. Clients never get direct table writes.
- **Service-role key:**
  - It lives only in `lib/supabase/admin.ts`, which imports `server-only`.
  - It is used only by the two cron routes and `ensureUser`.
  - Callers of `ensureUser` check the caller's role first.
- **Definer functions:** every `security definer` function sets `search_path = ''` and uses fully qualified names. Only `service_role` can execute `admin_user_id_by_email`.
- **Redirects:** the `next` parameter is accepted only as a relative path: it must start with `/` and must not start with `//`.
- **Downloads:** each click gets a fresh 60-second signed URL, issued after an RLS check.
- **Uploads:** the bucket enforces size and declared MIME type. The declared type is not checked against file content, and v1 has no virus scanning.
- **Email content:** every value a user typed is HTML-escaped.
- **Cron:** the route requires `CRON_SECRET`.

## 14. Testing

### pgTAP (`supabase test db`)

Each test runs in a transaction and simulates users by setting `request.jwt.claims`. The tests cover:

- **Firm isolation:** staff of firm A cannot select, insert, or update any row of firm B, in any table.
- **Contact visibility:** a contact cannot see drafts; other clients' requests, items, or files; or `client_contacts`.
- **Contact writes:** a contact cannot update `request_items` directly. `submit_item` rejects wrong states, file items without files, and text items without an answer.
- **`register_file`:** rejects a wrong path prefix, a missing object, a closed item, and a 21st file.
- **Storage:**
  - A contact can insert only into an open file item of their own client.
  - A contact cannot read other clients' objects.
  - Staff can read only their own firm's objects.
- **Membership:** an admin cannot update or delete their own membership. Staff cannot manage members.
- **Completion trigger:** completes a request when every required item is accepted; reopens it when a required item is added or an item is returned.
- **`create_firm`:** fails for a user who is already staff.

### Vitest

- `reminderDue`: `d` = 8, 7, 1, 0, −1, −3, −6, and the case `sentOn = today`.
- `sanitizeFilename`
- `safeNextPath`

### Playwright

One test, run against local Supabase with Resend in log mode:

1. Staff signs up and creates a firm.
2. Staff adds a client with one contact.
3. Staff sends a request with one required item.
4. The contact signs in with the code read from the local mail catcher.
5. The contact uploads a PDF and submits the item.
6. Staff accepts the item.
7. The request shows as Completed.

## 15. Project layout

```
proxy.ts
vercel.json
app/
  page.tsx                      landing page
  login/  onboarding/
  app/                          staff area (URL /app)
    page.tsx  clients/  requests/  templates/  settings/
  portal/                       client area
  api/
    cron/daily/route.ts
    files/[id]/route.ts
    requests/[id]/zip/route.ts
lib/
  supabase/{server,client,admin}.ts
  email/{send,templates}.ts
  reminders.ts  files.ts  auth.ts  errors.ts
  database.types.ts             generated by `supabase gen types`
supabase/
  config.toml  migrations/  tests/
```

## 16. Configuration and deployment

- **Environment variables:**
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or the legacy anon key)
  - `SUPABASE_SECRET_KEY` (or the legacy service-role key)
  - `NEXT_PUBLIC_SITE_URL`
  - `RESEND_API_KEY`
  - `EMAIL_FROM`
  - `CRON_SECRET`
- **Supabase Auth settings:**
  - Email OTP length: 6.
  - The "Magic Link" email template shows `{{ .Token }}` instead of a link.
  - In production, custom SMTP uses Resend.
  - Site URL: the production domain.

  Local equivalents live in `supabase/config.toml`.
- **Migrations** are applied with `supabase db push`.
- **Before charging customers:** Vercel Hobby is for non-commercial use only, and inactive Supabase free projects are paused. Move both to paid plans before a paid launch.

## 17. Starter template

`create_firm` seeds one template named "Annual tax return (starter)". It is written to fit any country; firms can edit it or delete it.

| # | Item | Kind | Required |
|---|---|---|---|
| 1 | Government-issued photo ID | file | yes |
| 2 | Income statements from all employers | file | yes |
| 3 | Bank and investment statements | file | no |
| 4 | Receipts for deductible expenses | file | no |
| 5 | Last year's tax return, if we did not prepare it | file | no |
| 6 | Did your household or dependents change this year? | text | yes |
| 7 | Anything else we should know? | text | no |

## 18. Known ceilings

Each ceiling is marked in code with a `ponytail:` comment that names the upgrade path.

| Ceiling | Upgrade path |
|---|---|
| The daily job runs once, at 01:00 UTC (9 am in UTC+8), so firms in other time zones get their emails at other local hours. (Dates follow each firm's time zone since `firms.time_zone`.) | Run the job hourly (Vercel Pro) and send at a set local hour per firm. |
| A staff user can belong to only one firm. | Drop the unique `user_id` constraint and add a firm switcher. |
| Zip size is limited by the 300-second function duration. | Download files individually, or build zips in a background job. |
| Optional items lock when a request completes. | Allow optional submissions on completed requests. |
| The MIME type is the declared type only, and files are not virus-scanned. | Add a scanning step before `register_file`. |
| Either side can delete the other side's upload before it is registered. | An `owner_id` check in the delete policy, with `removeFile` deleting the object through the service role. |
| Gmail over SMTP sends about 500 emails a day. | A domain verified in Resend, with `SMTP_HOST` removed. |
