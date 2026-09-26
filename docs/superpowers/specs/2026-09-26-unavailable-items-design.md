# "I Don't Have This": Design Spec

- **Date:** 2026-09-26
- **Status:** Design approved in conversation, section by section, on 2026-09-26
- **Builds on:** [`2026-09-24-client-portal-design.md`](2026-09-24-client-portal-design.md) (the v1 spec, "v1 §7.3") and [`2026-09-25-paperline-backlog-design.md`](2026-09-25-paperline-backlog-design.md) (the backlog spec, including the activity timeline)

## 1. Summary

A client who does not have a requested document can say so in the portal, with a reason, instead of emailing the firm. The answer reaches staff the same way a submission does: staff accept it, which closes the item, or send it back with a note.

Today the only way to say this is an email. The item stays open, so reminders keep going out until staff accept it by hand.

### Success criteria

- On a phone, a client can answer "I don't have this" on a file item with a short reason.
- Staff see the answer under "Ready for review" and in the daily digest, and read the reason before accepting it or sending it back.
- Once answered, the item is no longer open: reminders stop chasing it and progress counts it.
- The Activity section records the answer and its reason.

## 2. Decisions

| Topic | Decision |
|---|---|
| Review | Staff review the answer like a submission. It never closes an item by itself. |
| Item kinds | File items only. Written-answer items already take "No" or "Not applicable" as an answer. |
| Reason | Required, 1 to 1,000 characters. |
| Files | Only on an item with no files, including files staff added. |
| Storage | The item becomes `submitted` and the reason goes in its own column. No new item status. |
| After a send-back | The client can upload and submit, or answer "I don't have this" again with a new reason. |
| Emails | None new. |

## 3. Data and rules

### 3.1 Column

`request_items.unavailable_reason text`, null by default.

- A check allows it only on file items, with 1 to 1,000 characters: `unavailable_reason is null or (kind = 'file' and char_length(unavailable_reason) between 1 and 1000)`.
- The reason is stored trimmed.

### 3.2 `mark_unavailable(item_id uuid, reason text) returns void`

A client-facing RPC, `security definer` with `set search_path = ''`, like `submit_item`. `execute` is revoked from `public` and `anon`.

1. It selects the item with its request and locks the item row (`for update of i`). This is the lock `register_file` takes, so a file cannot be registered between the check and the update.
2. It raises `not_allowed` unless the request is not a draft and the caller is a contact of the request's client (`is_client_contact`), as `submit_item` does.
3. It raises `invalid_state` unless all of these hold:
   - the request is `open`;
   - the item is a `file` item in `requested` or `needs_changes`;
   - the item has no `item_files` row;
   - the trimmed reason has 1 to 1,000 characters.
4. It sets `status = 'submitted'`, `submitted_at = now()`, and `unavailable_reason` to the trimmed reason, in one statement.

### 3.3 When the reason is cleared

- `submit_item` sets `unavailable_reason = null` in its update, so a normal submission after a send-back never shows an old reason.
- A trigger on `item_files` insert sets the item's `unavailable_reason` to null. This covers staff adding the document to a submitted item. The trigger function is `security definer` with `set search_path = ''`, and `execute` is revoked from `public`, `anon`, and `authenticated`.
- Accepting and sending back keep the reason. An accepted item still shows why it has no file.

### 3.4 Timeline

The `submitted` event records the reason in its detail when there is one: `{"reason": "..."}`. `request_items_log_events` builds it from the row after the update. There is no new event kind.

### 3.5 What stays the same

A submitted item is not open, so reminders skip it. Progress counts it, "Ready for review" lists it, the digest includes it (it picks items by `submitted_at`), and accepting every required item completes the request. None of those queries change which items they pick; "Ready for review" and the digest also read `unavailable_reason` to label the item (section 4.2).

## 4. Screens

Staff screens use the label "Not available".

### 4.1 Client portal

- A file item that the client can still change (request `open`, item `requested` or `needs_changes`) and that has no files shows an "I don't have this" button under the upload area.
- The button opens a required text box labeled "Why not?", with the placeholder "For example: no investment account this year", and the buttons "Send to {firm}" and "Cancel".
- On success the toast reads "Sent. {firm} will review it." The page refreshes, and the card shows the "Submitted" badge and "You told {firm} you don't have this: “{reason}”", with no upload controls.
- The line stays while the item is `submitted` or `accepted`. After a send-back, the card shows the existing "Changes requested" note instead.

### 4.2 Staff

- **Request page:** the item's row shows a "Not available" badge next to its status badge.
- **Review sheet:** a file item with a reason shows "The client says they don't have this" and the reason, in place of "No files yet." Accept and "Needs changes" work as today.
- **Dashboard:** in "Ready for review", the item shows the same "Not available" badge.
- **Daily digest email:** the item appears as "{title} (not available)".
- **Activity section:** a `submitted` event with a reason reads "{actor} said they don't have {item}: “{reason}”".

## 5. Errors

- A new Server Action, `markUnavailable(itemId, reason)`, checks the id with `isId` and the reason with a new zod schema before calling the RPC. The schema uses the `text()` helper with a new `LIMITS.unavailableReason` of 1,000, the same number as the column check.
- A validation error returns `{ ok: false, error }` and shows as a toast. The typed reason stays in the box (`submitKeepingValues`).
- `not_allowed` and `invalid_state` map to the existing messages in `lib/errors.ts`. For example, an item that gained a file a moment ago returns "This has changed since the page loaded. Refresh and try again."
- On success the action revalidates the portal request page.

## 6. Tests

- **pgTAP**, in a new file:
  - A contact marks an empty file item: it becomes `submitted`, with the reason and `submitted_at` set.
  - `not_allowed`: another client's contact, and a staff member who is not a contact.
  - `invalid_state`: a written-answer item, an item with files, a draft request, a closed request, a blank reason, a 1,001-character reason, and an item already submitted.
  - `submit_item` after a send-back clears the reason; a file added by staff clears it.
  - Accepting keeps the reason and completes the request.
  - The timeline's `submitted` event carries the reason.
  - The column check refuses a reason on a written-answer item.
- **Unit:** `describeEvent` for a `submitted` event with a reason.
- **Browser:** a contact answers "I don't have this" with a reason; staff see "Not available" under "Ready for review", read the reason in the review sheet, and send it back with a note; the contact sees the note and answers again; staff accept; the request completes, and the Activity section shows the line.

Reminders get no new test: they skip every submitted item, and the pgTAP tests pin that the answer marks the item `submitted`.

## 7. Other changes

- Regenerate `lib/database.types.ts` after the migration.
- README: add the answer to the feature description.

## 8. Out of scope

- Written-answer items.
- Answering while the item has files.
- Staff marking an item not available themselves. They can already accept any item.
- Changing the reason after sending it. The client gets another chance only after a send-back.
- New emails, and counting or reporting items answered this way.
