# PaperLine Backlog: Design Spec

- **Date:** 2026-09-25
- **Status:** Design approved in conversation, section by section, on 2026-09-25
- **Builds on:** [`2026-09-24-client-portal-design.md`](2026-09-24-client-portal-design.md) (the v1 spec). Section numbers like "v1 §7.3" point there.

## 1. Summary

Five features from the backlog, each shippable on its own:

1. **Search and filters:** a new Requests page, search and filters on the client list, and a search box on the dashboard.
2. **Activity timeline:** staff see who did what to a request, and when.
3. **CSV import:** staff import clients and contacts from a spreadsheet.
4. **Orphaned-file cleanup:** a daily job deletes stored files that no item points to.
5. **Drag-and-drop ordering:** items in the editor can be dragged into place.

Email retries, the sixth backlog item, shipped separately (commit `9f6d823`).

## 2. Decisions

| Topic | Decision |
|---|---|
| Request lists | A new Requests page, plus a search box on the dashboard tabs |
| Client list | Search also matches contact names and emails; owner and type filters; server-side paging |
| Timeline audience | Staff only. Clients keep seeing statuses and review notes, as today. |
| Timeline recording | Database triggers. No app code writes events, and no app role can change them. |
| Import of an existing client | Match by name, ignoring case, and add the new contacts. Contacts the client already has are skipped. |
| Drag-and-drop | Native browser drag events, no library (v1 §3). The up and down buttons stay. |
| Cleanup safety | Only files with no `item_files` row that are older than 24 hours |

## 3. Search and filters

### 3.1 Requests page: `/app/requests`

- The sidebar gets a "Requests" link between Clients and Templates.
- A DataTable with columns: client (links to the client), title (links to the request), status Badge, due date with an Overdue badge, and the open item count (`requested` or `needs_changes`).
- **Search** matches the request title or the client name.
- **Status** is a Select: Active (draft, open, and completed; the default), Draft, Open, Completed, Archived, or All.
- **Overdue only** is a checkbox. Overdue means an open request whose due date is before the firm's today, in the firm's time zone.
- Rows sort by due date, then title. 50 rows per page.

### 3.2 Client list: `/app/clients`

- **Search** matches the client name, or any contact's name or email.
- **Owner** is a Select: Anyone (the default), No owner, or one staff member.
- **Type** is a Select: Any, Individual, or Business.
- **Show archived** stays, as a checkbox in the same form.
- Rows sort by name. 50 rows per page.

### 3.3 SQL functions

Both functions are `security invoker` (RLS applies), `stable`, with `set search_path = ''`, and executable by `authenticated` only. Each returns one page of rows plus the total match count in every row (`count(*) over ()`), so one call fills the table and the pager.

```
list_requests(q text, statuses text[], overdue_only boolean, page int)
  returns table (id uuid, title text, status text, due_date date,
                 client_id uuid, client_name text, open_items int, total int)

list_clients(q text, owner text, kind text, include_archived boolean, page int)
  returns table (id uuid, name text, kind text, owner_id uuid,
                 archived boolean, total int)
```

- Rows are limited to the caller's firm with `public.is_firm_member(firm_id)`, so a user who is also another firm's contact does not see that firm's requests here.
- Search is a case-insensitive substring match with `strpos(lower(column), lower(q)) > 0`, so `%` and `_` are plain characters. A null or blank `q` matches everything.
- `owner` is null (anyone), `'none'` (no owner), or a member's user id. The app validates it before the call.
- `page` starts at 1, and the page size is fixed at 50. A page past the end returns no rows; the page then offers a link back to page 1.

### 3.4 URL and forms

- Search and filters live in the URL: `/app/requests?q=tax&status=open&overdue=1&page=2` and `/app/clients?q=smith&owner=none&kind=business&archived=1`.
- Requests params:
  - `q`: search text.
  - `status`: `active`, `draft`, `open`, `completed`, `archived`, or `all`.
  - `overdue`: `1` for overdue only.
  - `page`: page number.
- Clients params:
  - `q`: search text.
  - `owner`: `none` or a member's user id.
  - `kind`: `individual` or `business`.
  - `archived`: `1` to include archived clients.
  - `page`: page number.
- Each page validates its search params with zod. An invalid value falls back to its default, so a hand-edited URL never errors.
- The filter bar is a GET form using `next/form`. Enter submits the search. Changing a Select or checkbox submits the form at once. Changing any filter returns to page 1.
- The pager shows "Showing 51–100 of 230", with Previous and Next links that keep the other params.

### 3.5 Dashboard search

A search box above the two tabs filters the rows already loaded: client and title in "Waiting on clients"; client, request, and item in "Ready for review". It is local state and does not change the URL. The tab labels show the filtered counts.

### 3.6 Send-to-clients picker

`/app/templates/[id]/send` reads every active client that has a contact in pages of 1,000, using keyset paging on `id`, then sorts by name. Firms with more than 1,000 such clients see all of them. The keyset reader moves from `lib/daily-jobs.ts` to `lib/supabase/read-all.ts`, so both callers share it.

### 3.7 Tests

- pgTAP for both functions:
  - Firm isolation, including a user who is staff of one firm and a contact of another.
  - Each filter.
  - Search on client name, contact email, and title.
  - A literal `%` in the search.
  - Paging and the total count.
  - Overdue measured by the firm's date.
- A browser test for each page: search, a filter, and paging through the URL.

## 4. Activity timeline

### 4.1 Table

```
request_events
  id          bigint generated always as identity primary key
  firm_id     uuid not null
  request_id  uuid not null
  item_id     uuid            -- no foreign key: the event outlives a removed item
  actor_id    uuid            -- auth.uid() at the time; no foreign key: outlives the user
  kind        text not null   -- see 4.2
  detail      jsonb not null default '{}'
  created_at  timestamptz not null default now()
  foreign key (request_id, firm_id) references requests (id, firm_id) on delete cascade
```

- The table has an index on `(request_id, id)`.
- RLS allows `select` to staff of the firm (`is_firm_member(firm_id)`). Insert, update, and delete are revoked from `anon` and `authenticated`, so only the trigger functions write rows.
- Events are ordered by `id`, because events written in one transaction share `now()`.

### 4.2 Events

Every trigger function is `security definer` with `set search_path = ''`, and `execute` on it is revoked from public, `anon`, and `authenticated`. A request in `draft` records nothing: history starts when it is sent.

| Kind | Written when | Detail |
|---|---|---|
| `sent` | `requests.status` changes from draft to open | none |
| `details_changed` | title or due date of a sent request changes | the changed fields, each as `[old, new]` |
| `item_added` | an item is inserted into a sent request | `title` |
| `item_removed` | an item is deleted from a sent request | `title` |
| `file_added` | an `item_files` row is inserted | `filename`, `by_staff` |
| `file_removed` | an `item_files` row is deleted | `filename`, `by_staff` |
| `submitted` | an item's status becomes `submitted` | none |
| `accepted` | an item's status becomes `accepted` | none |
| `returned` | an item's status becomes `needs_changes` | `note` |
| `reminder_sent` | a `notifications_sent` row of kind `reminder` is inserted | `manual` (true when a user sent it) |
| `archived` | a request's status becomes archived | none |
| `unarchived` | a request's status leaves archived | none |
| `completed` | a request's status changes from open to completed | none |
| `reopened` | a request's status changes from completed to open | none |

- `actor_id` is `auth.uid()`. It is null for the daily job, which uses the service role.
- The item triggers are named so they run before `request_items_refresh_status`: an item's event is written before the request's `completed` or `reopened` event that it causes.
- Delete triggers skip logging when the parent request no longer exists, so cascading deletes (a firm deleted by hand) never fail.
- Bulk send inserts items while its requests are still drafts, so it logs one `sent` event per request and no `item_added` events.

### 4.3 Screen

- The staff request page gets an "Activity" section under the items, newest first. Each line reads, for example, "Maria Santos accepted *Photo ID* · Sep 25, 9:30 AM GMT+8", with times in the firm's time zone.
- Actor names come from the firm's staff (`firm_members`), then from the request's client's contacts (`client_contacts`). A user found in neither shows as "Former user". A null actor shows as "PaperLine".
- Requests sent before this change show "No activity recorded yet." There is no backfill.

### 4.4 Tests

- pgTAP:
  - Each event kind, with its actor and detail.
  - Nothing is logged for drafts.
  - Item events come before the request's `completed` event.
  - Isolation: another firm and the client's contacts read nothing.
  - No role can insert, update, or delete.
  - A cascading delete succeeds.
- A browser test: upload, submit, and accept appear in the Activity section with the right names.

## 5. CSV import

### 5.1 Format

- A header row, `client_name,client_type,contact_name,contact_email`, matched ignoring case and surrounding spaces. Then one row per contact.
- A client with no contacts is a row whose contact columns are empty.
- `client_type` is `individual` or `business`, ignoring case. It is optional and defaults to individual.
- At most 500 rows and 1 MB.
- The import page offers a template file to download.

### 5.2 Flow

1. **Read:** staff open `/app/clients/import` from an "Import CSV" button on the clients page and pick a file. The browser reads it with `lib/csv.ts`: quoted fields, `""` escapes, commas and line breaks inside quotes, CRLF, and a leading byte-order mark.
2. **Preview:** a Server Action receives the rows, checks them, and returns each row's outcome. Nothing is saved.
3. **Import:** staff click "Import", and a second Server Action checks every row again and saves them. The result lists clients created, contacts added, rows skipped, and rows failed, with row numbers.

Both actions call `requireStaff()`, validate every row with zod, and share the row checks in `lib/client-import.ts`. The page sets `maxDuration = 300`.

### 5.3 Outcomes per row

| Outcome | When |
|---|---|
| New client | No client in the firm has this name, ignoring case |
| Adds to existing client | An active client has this name |
| Contact already there, skipped | That client already has a contact with this email, ignoring case |
| Error | Missing client name; invalid email; a contact name without an email, or an email without a name; invalid type; a duplicate of an earlier row; or the matching client is archived ("unarchive it first") |

- Rows for one new client can disagree on `client_type`; the first row's type wins.
- Contacts are added the way `addContact` adds them: `ensureUser(email)`, then an insert into `client_contacts` through the user-scoped client. No email is sent.
- Running the same file again changes nothing. If an import stops partway, staff run it again.

### 5.4 Tests

- Unit tests for `lib/csv.ts`: quotes, embedded commas and line breaks, CRLF, the byte-order mark, and a trailing newline.
- Unit tests for the row checks.
- A browser test imports a file with a new client, a row for an existing client, and a bad row, and checks the preview and the result.

## 6. Orphaned-file cleanup

### 6.1 Function

```
orphaned_documents(older_than interval default '24 hours', max_rows int default 1000)
  returns setof text   -- object names in the documents bucket
```

- `security definer`, `stable`, with `set search_path = ''`. It returns objects in the `documents` bucket that have no `item_files` row with that `storage_path` and were created before `now() - older_than`, oldest first, up to `max_rows`.
- `execute` is revoked from public, `anon`, and `authenticated`, and granted to `service_role`.
- 24 hours is safe for uploads in progress: signed upload URLs expire after 2 hours.

### 6.2 Route and schedule

- `/api/cron/cleanup` checks `CRON_SECRET` exactly like the daily route. The check moves to a shared `lib/cron.ts`.
- The route calls the function with the service-role client. It deletes the objects through the Storage API in chunks of 100, so the stored bytes are removed and not only the database row.
- It logs `{"job":"cleanup","found":n,"deleted":n,"failed":n}` and returns 500 when any delete failed.
- `vercel.json` adds a second cron at `0 2 * * *` (02:00 UTC, 10 am in UTC+8), an hour after the daily job. More than 1,000 orphans wait for the next run.
- `lib/supabase/admin.ts` now has three allowed callers: the two cron routes and `ensureUser()`.

### 6.3 Tests

- pgTAP: only unregistered objects older than the cutoff are returned, and `authenticated` cannot call the function.
- An integration test against local Supabase uploads an orphan and a registered file, backdates both, runs the cleanup, and checks that only the orphan is gone, both in Storage and in `storage.objects`.

## 7. Drag-and-drop ordering

- The item editor (`components/item-editor.tsx`, used by templates and draft requests) gets a drag handle on each row. Dropping moves the item. A line shows where it will land.
- Native `dragstart`, `dragover`, and `drop` events are used, with no library.
- The up and down buttons stay. Keyboard users need them, and touch screens do not fire browser drag events.
- A pure `moveItem(items, from, to)` in `lib/editor-items.ts` serves both the buttons and the drop.
- Sent requests keep their order, as today.
- Tests: a unit test for `moveItem`, and a browser test that drags an item in a draft, saves, and reloads.

## 8. Other changes

- v1 §6: the service-role client has three uses (6.2).
- v1 §18: remove the orphaned-object limit.
- Code: remove the two `ponytail:` comments about orphans.
- README: add the Requests page and the import to the feature description, and the cleanup job to Deploying.
- Regenerate `lib/database.types.ts` after the migrations.

## 9. Out of scope

- Clients seeing the timeline.
- Backfilling events for requests sent before the timeline existed.
- An owner column in the CSV, updating existing contacts' names from the CSV, and exporting clients to CSV.
- Sorting the lists by clicking column headers.
- Reordering items of sent requests.
- Full-text search and trigram indexes. Substring search on one firm's rows is enough at this scale.

## 10. Build order

Each phase ends with every check passing (pgTAP, Vitest, integration, typecheck, lint, build, and the browser tests) and a commit.

1. Search and filters (section 3)
2. Activity timeline (section 4)
3. CSV import (section 5)
4. Orphaned-file cleanup (section 6)
5. Drag-and-drop ordering (section 7)
