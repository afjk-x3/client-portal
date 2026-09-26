# Copy a Request, or Save It as a Template: Design Spec

- **Date:** 2026-09-26
- **Status:** Design approved in conversation, section by section, on 2026-09-26
- **Builds on:** [`2026-09-24-client-portal-design.md`](2026-09-24-client-portal-design.md) (the v1 spec) and [`2026-09-25-paperline-backlog-design.md`](2026-09-25-paperline-backlog-design.md) (the backlog spec)

## 1. Summary

Staff can reuse a checklist they have already tuned:

- **Copy** starts a new request for the same client with the same title and items, for example next year's tax return from this year's.
- **Save as template** turns a request's items into a new template that works for any client.

Today a request can start only from a template or from blank.

### Success criteria

- From a client's sent request, including an archived one from last year, staff start a new request with the same items in one click, set the new due date, adjust anything, and save or send it.
- From a sent request, staff save its items as a new template, which then works everywhere templates do: "Start from" and "Send to clients".
- Only the checklist carries over. None of the client's answers, files, statuses, or review notes do.

## 2. Decisions

| Topic | Decision |
|---|---|
| Copy target | The same client only. To reuse a list for other clients, save it as a template. |
| Copy title | The copy starts with the original title; staff edit it in the editor. |
| Copy due date | Empty; staff pick one. |
| Copy mechanism | The New request page opens pre-filled. Nothing is saved until Save draft or Send. No database change. |
| Save as template | One database function creates the template and its items together, then the template editor opens. |
| Template name | The request's title. Template names need not be unique, so saving twice makes two templates. |
| Which requests | Sent requests (open, completed, or archived). Drafts get neither action. |
| Carried over | Each item's title, description, type, and required flag, in order. |

Drafts are left out because a copy of a draft for the same client adds nothing, and saving a draft as a template would take its last saved version and miss edits still open in the editor.

## 3. Copy

### 3.1 Button

The header of a sent request's page (next to Archive) gets an outline "Copy" link to `/app/requests/new?client={client_id}&from={request_id}`.

### 3.2 New request page

- The page reads `from` from its search params. When it is a well-formed id, the page loads that request with its items, sorted by `position` then `id`, limited to requests that belong to the staff member's firm and to the page's client and are not drafts.
- A match opens the editor with the request's title, its items (through `newEditorItem`), and no due date. A line under the heading reads "Copy of “{title}”".
- A `from` that does not match falls back to the blank editor, the way the list pages treat hand-edited URLs. The page's existing check stays: the client must belong to the firm, or the page shows "not found".
- The editor is keyed by client and source (`{client_id}:{from}`), so moving between a blank new request and a copy starts fresh. Next keeps this page mounted without its search params, which is why it is keyed at all.
- The "Start from" template picker still works on a copy. Save draft and Send work as they do today.

## 4. Save as template

### 4.1 Button and action

- The same header gets an outline "Save as template" button, an `ActionButton` like Archive.
- A new Server Action, `saveRequestAsTemplate(requestId)`, calls `requireStaff()`, checks the id with `isId`, and calls the database function. A null result returns the `not_allowed` message. On success it redirects to `/app/templates/{id}`, as `createTemplate` does.

### 4.2 `template_from_request(request_id uuid) returns uuid`

`security invoker`, so RLS applies and only the firm's staff can use it, with `set search_path = ''`. `execute` is revoked from `public` and `anon`. In one transaction it:

1. Inserts a template for the request's firm, named after the request's title, when the request exists, is visible to the caller, and is not a draft.
2. Copies the request's items into `template_items`: title, description, kind, and required, renumbered 1, 2, 3… in `position`, then `id`, order.
3. Returns the template's id, or null when no template was created. The template and its items are written together, so a failure never leaves an empty template behind.

The new template is an ordinary template. Editing it never changes the request it came from.

## 5. Errors

- **Copy:** a `from` that does not match is not an error; the blank editor opens. A database error while loading the source goes to the error page, like every page query.
- **Save as template:** the `ActionButton` shows progress and reports errors as a toast.
  - A malformed id, a draft, or a request that is not the caller's returns the existing `not_allowed` message: "That isn't available to you. It may have been removed."
  - Other database errors map through `lib/errors.ts`.
  - Success opens the template editor.

## 6. Tests

- **pgTAP**, in a new file:
  - Staff turn a sent request into a template named after it, with every item copied (description, type, required) in order.
  - Items whose positions have gaps come out numbered 1, 2, 3.
  - A draft returns null and creates nothing, and so does another firm's request.
  - A client contact is refused.
  - `anon` cannot call it.
- **Browser**, one new test:
  1. Staff send a request, click Copy, and see "Copy of “…”" with the same title and items and no due date.
  2. They set a due date and save the draft, which has the same items.
  3. On the original request, "Save as template" opens the template editor with that title and those items.
  4. The template appears in "Start from" on another client's New request page.
- **Unit:** none; there is no new pure logic.

## 7. Other changes

- Regenerate `lib/database.types.ts` after the migration.
- v1 spec §8.3: add `template_from_request` to the RPC table.
- README: mention copying a request and saving it as a template in the feature description.

## 8. Out of scope

- Copying or saving drafts.
- Copying to another client.
- Updating an existing template from a request.
- Carrying over answers, files, statuses, or review notes.
- A Copy link on the client page's request list.
