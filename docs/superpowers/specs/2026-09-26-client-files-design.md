# A Client's Files in One Place: Design Spec

- **Date:** 2026-09-26
- **Status:** Design approved in conversation on 2026-09-26
- **Builds on:** [`2026-09-24-client-portal-design.md`](2026-09-24-client-portal-design.md) (the v1 spec: downloads in §8.4, the client page in §9.2)

## 1. Summary

The client page gets a Files section that lists every file from all of the client's requests, archived ones included, with a search box. Staff can find a document from an earlier season, such as last year's ID, without remembering which request held it.

### Success criteria

- On a client's page, staff see every file from the client's requests, newest first, with its name, request, item, date, and who added it.
- Typing part of a name, request, or item narrows the list at once.
- Files open and download through the existing file route and its access checks.

## 2. Decisions

| Topic | Decision |
|---|---|
| Placement | A "Files" section on the client page, under the requests |
| Search | A box that filters the loaded list as staff type, like the dashboard's search |
| Data | One query under RLS, read with the shared keyset reader. No database change. |
| Scope | Read-only; uploading and removing files do not change |

## 3. Data

- The client page reads `item_files` with `id, filename, size_bytes, created_at, by_staff`, and through inner joins the item's `title` and the request's `id` and `title`, filtered to the client's id and the staff member's firm, with the user-scoped client.
- It reads them with `readAll` from `lib/supabase/read-all.ts`, 1,000 rows per page by `id`, so a long history is never cut off, then sorts them by `created_at`, newest first.
- Files that retention or a removal deleted have no row, so they do not appear.

## 4. Section

- A heading "Files ({count})" under the client's requests.
- A search box labeled "Search this client's files" filters the rows as staff type: a case-insensitive substring match on the file name, the request title, or the item title. It is local state and does not change the URL.
- A table with the columns:
  - **File:** the name, opening `/api/files/{id}` in a new tab.
  - **Request:** the title, linking to `/app/requests/{id}`.
  - **Item:** the item's title.
  - **Added:** the date in the firm's time zone.
  - **By:** "Client", or "Firm" for files staff added.
  - **Size:** in KB or MB, the way the portal shows it. `formatSize` moves from `app/portal/requests/[id]/item-card.tsx` to `lib/files.ts` so both places share it.
  - A "Download" link to `/api/files/{id}?download=1`.
- "No files yet." when the client has none, and "No files match." when the search finds nothing.

## 5. Errors

A database error while reading the files goes to the error page, like every page query.

## 6. Tests

- **Browser:** a client has files in two requests, one of them archived; staff see both files in the section; typing part of one file's name leaves only that file; its Download link points at `/api/files/{id}?download=1`.
- **Database:** none; nothing changes there.

## 7. Out of scope

- A zip of all of a client's files.
- Deleting or moving files from this list.
- Paging, and thumbnails.
