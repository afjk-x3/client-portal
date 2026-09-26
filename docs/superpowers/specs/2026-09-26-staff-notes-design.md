# Private Staff Notes: Design Spec

- **Date:** 2026-09-26
- **Status:** Design approved in conversation, section by section, on 2026-09-26
- **Builds on:** [`2026-09-24-client-portal-design.md`](2026-09-24-client-portal-design.md) (the v1 spec) and [`2026-09-25-paperline-backlog-design.md`](2026-09-25-paperline-backlog-design.md) (the backlog spec: the Activity section in §4)

## 1. Summary

Staff can write short notes on a client or a request, such as "Called Maria, she'll drop off the rest Friday" or "Her husband handles the documents". Every staff member of the firm sees them; clients never do. Anyone on staff can pick up where a colleague left off.

### Success criteria

- Staff add a note on a client's page or a request's page, and every staff member of the firm sees it with its author and time.
- The author can fix or remove their own note; nobody changes a colleague's words.
- Clients never see notes, in the portal or in any email.

## 2. Decisions

| Topic | Decision |
|---|---|
| Where | Clients and requests. The client page also lists its requests' notes. |
| Editing | Only the author edits or deletes a note; an edited note shows "edited" |
| Layout | A "Notes" section of its own, above Activity on the request page |
| Storage | A `notes` table under RLS. Notes are not timeline events. |
| Format | Plain text, 1 to 2,000 characters, line breaks kept |

## 3. Data

### 3.1 Table

```
notes
  id          uuid primary key default gen_random_uuid()
  firm_id     uuid not null
  client_id   uuid not null
  request_id  uuid                         -- null for a client note
  author_id   uuid not null default auth.uid()  -- no foreign key: a note outlives its author's account
  body        text not null check (char_length(body) between 1 and 2000)
  created_at  timestamptz not null default now()
  updated_at  timestamptz                  -- null until the first edit
  foreign key (client_id, firm_id) references clients (id, firm_id) on delete cascade
  foreign key (request_id, client_id) references requests (id, client_id) on delete cascade
```

- `requests` gains `unique (id, client_id)` for the second foreign key, which makes a request note belong to the note's client. The request's own foreign key to `clients` then keeps it in the same firm.
- Indexes on `(client_id, created_at)` and `(request_id, created_at)`.
- Deleting a client, or a draft request, removes its notes.

### 3.2 Rules

RLS is enabled. Contacts and `anon` get no access.

| Operation | Allowed when |
|---|---|
| Select | `is_firm_member(firm_id)` |
| Insert | `is_firm_member(firm_id)` and `author_id = (select auth.uid())` |
| Update | `is_firm_member(firm_id)` and `author_id = (select auth.uid())` |
| Delete | `is_firm_member(firm_id)` and `author_id = (select auth.uid())` |

- Column privileges limit updates to `body`: `update` is revoked from `authenticated` on the table and granted on `(body)` only. A note cannot move to another client, request, or author.
- A `before update` trigger sets `updated_at = now()`.
- A staff member who leaves the firm keeps their notes in place; they show as "Former staff member", and nobody can edit them, since only the author could.

## 4. Screens

### 4.1 Request page

- A "Notes" section above Activity, on every request page, drafts included.
- A textarea labeled "Add a note" (2,000 characters at most) and an "Add note" button.
- The list, newest first: "{author} · {date and time in the firm's time zone}", with " · edited" when `updated_at` is set, and the text below it with its line breaks kept.
- On the author's own notes: "Edit", which turns the text into a textarea with "Save" and "Cancel", and "Delete", which asks "Delete this note?" in an AlertDialog.
- Author names come from the firm's `firm_members`; a user not found there shows as "Former staff member".

### 4.2 Client page

- A "Notes" section listing the client's notes and its requests' notes together, newest first.
- A request note is labeled "On {request title}" and links to the request.
- The section's box adds a client note (no request).

### 4.3 Limit

Each list shows the newest 200 notes and says "Older notes are not shown." when there are more, as the Activity section does. PostgREST would otherwise cut the list off at 1,000 rows without saying so.

## 5. Server Actions

`addNote(clientId, requestId | null, body)`, `updateNote(noteId, body)`, and `deleteNote(noteId)`:

1. Call `requireStaff()` and validate the ids with `isId` and the body with a zod schema (the `text()` helper, 2,000 characters).
2. Write through the user-scoped client, so RLS decides; an update or delete returns the affected id.
3. Revalidate the request page and the client page.

## 6. Errors

- A validation error shows as a toast, and the form keeps what was typed.
- An update or delete that changes nothing (not the author, or the note is gone) returns the existing `invalid_state` message: "This has changed since the page loaded. Refresh and try again."
- Database errors map through `lib/errors.ts`.

## 7. Tests

- **pgTAP**, in a new file:
  - Staff read their firm's notes; another firm's staff and the client's contacts read nothing.
  - Staff add notes as themselves only; a note with another `author_id` is refused.
  - Only the author updates or deletes a note; only `body` can change; an update sets `updated_at`.
  - A note naming another client's request is refused by the foreign key.
  - Deleting a client removes its notes.
  - `anon` has no access.
- **Browser:**
  1. One staff member adds a request note; a second staff member sees it without Edit or Delete.
  2. The author edits it, and it shows "edited".
  3. The client page shows it, labeled "On {request title}".
  4. The contact's portal never shows it.
  5. The author deletes it.

## 8. Other changes

- Regenerate `lib/database.types.ts` after the migration.
- v1 spec: add `notes` to §7.2 and its policies to §8.2.
- README: mention notes in the feature description.

## 9. Out of scope

- Mentions and notifications.
- Attachments on notes.
- Formatting, pinning, and search.
- Recording notes in the Activity section.
