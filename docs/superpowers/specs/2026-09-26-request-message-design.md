# A Personal Message with a Request: Design Spec

- **Date:** 2026-09-26
- **Status:** Design approved in conversation on 2026-09-26
- **Builds on:** [`2026-09-24-client-portal-design.md`](2026-09-24-client-portal-design.md) (the v1 spec) and [`2026-09-26-copy-request-design.md`](2026-09-26-copy-request-design.md) (copying a request)

## 1. Summary

Staff can add an optional personal message to a request, for example "Hi Maria, these are for your 2025 return. Please upload by the 15th." The message appears in the "request sent" email and at the top of the client's portal page. It makes a request clearer and easier to trust, which matters while emails come from a Gmail address and link to a `vercel.app` page.

### Success criteria

- Staff can type an optional message while preparing a request, in the draft editor or on the bulk send page, and change it later in Edit details.
- The message appears in the "request sent" email above the link, and at the top of the portal request page.
- With no message, every screen and email works exactly as today.

## 2. Decisions

| Topic | Decision |
|---|---|
| Storage | An optional `message` column on `requests` |
| Format | Plain text, up to 2,000 characters, line breaks kept |
| After sending | Editable in Edit details. The portal shows the new text; emails already sent keep the old one. |
| Reminders | Do not repeat the message |
| Templates | No default message |
| Copy | Does not carry the message; the copy spec carries only the title and items |

## 3. Data

- `requests.message text`, null by default. A check allows 1 to 2,000 characters when present. The app stores it trimmed, and a blank message as null.
- `save_draft` gains an optional last argument, `message text default null`, saved on the draft.
- `send_requests` gains the same argument and stores the message on every request it creates.
- The migration drops the old `save_draft` and `send_requests` and creates the new versions, then repeats their `revoke` statements. Adding an argument with `create or replace` would leave two overloads, and a call without the argument could not choose between them.
- `updateRequestDetails` (Edit details) saves the message with the title and due date, through the existing staff update policy on `requests`.

## 4. Screens and email

### 4.1 Where staff type it

A textarea labeled "Message to the client (optional)", 2,000 characters at most, under the due date in three places:

- the draft editor, on the New request page and on a draft's page;
- the bulk send page (`/app/templates/[id]/send`);
- the Edit details dialog on a sent request.

### 4.2 Where clients see it

- **"Request sent" email:** `requestSentEmail` takes an optional `message`. When present, it is a paragraph after "It has {n} items and is due {date}." and before the "Open the request" link, HTML-escaped with its line breaks kept, in both the HTML and the text version. Single and bulk sends both pass it.
- **Portal request page:** a card at the top, above the progress bar, titled "Message from {firm}", shows the message with its line breaks kept. No card appears without a message.
- Reminders, templates, and copies do not show or carry the message.

## 5. Errors

- A zod schema for the message, built with the `text()` helper and 2,000 characters, runs in the draft, bulk send, and Edit details actions. An empty field becomes null. A message that is too long returns the helper's error as a toast, and the form keeps what was typed.
- The column check refuses anything the schema let through by mistake.

## 6. Tests

- **pgTAP:** `save_draft` and `send_requests` store the message; a request without one stores null; the check refuses 2,001 characters.
- **Unit:** `requestSentEmail` with a message (escaped, with its line breaks) and without one (unchanged).
- **Browser:** staff write a message in a draft and send it; the contact sees it on the portal page; staff change it in Edit details, and the portal shows the new text.

## 7. Other changes

- Regenerate `lib/database.types.ts` after the migration.
- v1 spec §7.2: add `message` to the `requests` table.
- README: mention the message in the feature description.

## 8. Out of scope

- Recording message edits in the Activity section, which logs changes to the title and due date only.
- Formatting or links in the message.
- A default message on templates.
