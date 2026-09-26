# Archive Requests in Bulk: Design Spec

- **Date:** 2026-09-26
- **Status:** Design approved in conversation on 2026-09-26
- **Builds on:** [`2026-09-25-paperline-backlog-design.md`](2026-09-25-paperline-backlog-design.md) (the backlog spec: the Requests page in §3.1 and the activity timeline in §4)

## 1. Summary

Staff can tick requests on the Requests page and archive them together, for example at the end of tax season, instead of opening each one. The default "Active" view then shows only work in progress.

### Success criteria

- Staff tick requests, click Archive, confirm, and the requests are archived with the same effect as archiving each one: reminders stop and the portal becomes read-only.
- Each request's Activity section records "archived" under the staff member's name.

## 2. Decisions

| Topic | Decision |
|---|---|
| Which requests | Open and completed, as with a single archive. The confirmation counts the open ones. |
| Selection | Rows on the current page, up to 50, with a checkbox for the whole page |
| Mechanism | One Server Action with one update under the existing staff rules on `requests`. No database change. |
| Who | Any staff member, as with a single archive |

## 3. Table and toolbar

- `RequestsTable` gains a first column of checkboxes. Each open or completed row has one, labeled "Select {title}"; draft and archived rows have none. The header has a checkbox labeled "Select all on this page", which ticks or clears every selectable row.
- The selection lives in `RequestsTable`'s state as a set of request ids; `DataTable` does not change. The table is keyed by the page's filters and page number, so changing either clears the selection.
- With at least one row ticked, a bar above the table shows "{n} selected", an "Archive {n} requests" button, and "Clear".

## 4. Confirmation

The button opens an AlertDialog:

- Title: "Archive {n} requests?"
- Text: "Reminders stop and clients can no longer upload or submit. You can unarchive any of them later."
- When some of them are open, it adds: "{k} of them are still open."
- Buttons: "Cancel" and "Archive".

## 5. Server Action: `archiveRequests(requestIds)`

1. Calls `requireStaff()`. A zod schema requires 1 to 50 ids, each passing `isId`.
2. Runs one update through the user-scoped client: `status = 'archived'` where `id` is in the list, `firm_id` is the staff member's firm, and `status` is `open` or `completed`, returning the ids.
3. Revalidates `/app/requests` and returns the count. The existing timeline trigger records `archived` for each row, with the staff member as the actor.

The toast reads "Archived {n} requests." When fewer rows changed than were selected, it reads "Archived {n} of {m} requests. The rest had already changed." Afterwards the selection clears and the list refreshes; in the default Active view, the archived rows disappear.

## 6. Errors

- An invalid list (empty, more than 50, or a malformed id) returns the existing `not_allowed` message as a toast.
- Database errors map through `lib/errors.ts`.
- No rows changed returns the existing `invalid_state` message: "This has changed since the page loaded. Refresh and try again."

## 7. Tests

- **Browser:** staff tick two open requests; the dialog says "2 of them are still open"; after confirming, both leave the Active view and appear under the Archived status filter; a draft row has no checkbox.
- **Database:** none; nothing changes there.

## 8. Out of scope

- Unarchiving in bulk.
- Selecting across pages.
- Other bulk actions, such as reminders or deletion.
