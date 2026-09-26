# Messages on an Item: Design Spec

- **Date:** 2026-09-26
- **Status:** Design approved in conversation, section by section, on 2026-09-26
- **Builds on:** [`2026-09-24-client-portal-design.md`](2026-09-24-client-portal-design.md) (the v1 spec: emails and the staff digest in §11), [`2026-09-25-paperline-backlog-design.md`](2026-09-25-paperline-backlog-design.md) (the backlog spec: the dashboard search in §3.5), and [`2026-09-26-email-outbox-design.md`](2026-09-26-email-outbox-design.md) (the email outbox, which must be built first)

## 1. Summary

A client stuck on an item, for example "Which bank account do you need?", has to email the firm today, and the answer sits in someone's inbox away from the request. Staff can write to a client only by returning an item with a note.

With this feature, each item has a short conversation. Clients write in the portal and staff on the request page, and both see the whole thread under the item. A client's message reaches staff on the dashboard and in the daily digest; a staff message reaches the client's contacts by email.

### Success criteria

- A contact asks a question on an item in the portal; staff see it in the dashboard's Messages tab and reply on the request page; the contact gets an email and sees the reply under the item.
- Either side can start a conversation, while the request is open or completed.
- Messages are visible only to the firm's staff and the client's contacts, and cannot be edited or deleted.

## 2. Decisions

| Topic | Decision |
|---|---|
| Where | A thread on each item, file and text items alike |
| Who writes | Staff of the firm and contacts of the client, while the request is `open` or `completed`. Archived requests keep a read-only thread. |
| Format | Plain text, 1 to 2,000 characters, line breaks kept |
| Changes | None: messages cannot be edited or deleted |
| Staff alerts | A dashboard tab of items with unread client messages, and a "New messages" list in the daily digest. No immediate email. |
| Client alerts | An email to the client's contacts for each staff message, through the outbox |
| Read state | A client's message is unread until a staff member replies on the item or clicks "Mark as read", for the whole firm |
| Activity | Messages are not recorded there; the thread is its own record. Return notes do not change. |

## 3. Data

### 3.1 Table

```
item_messages
  id           uuid primary key default gen_random_uuid()
  firm_id      uuid not null
  client_id    uuid not null
  request_id   uuid not null
  item_id      uuid not null
  author_id    uuid not null           -- no foreign key: a message outlives its author's account
  author_name  text not null           -- the author's name when they wrote it
  by_staff     boolean not null
  body         text not null check (char_length(body) between 1 and 2000)
  read_at      timestamptz             -- when staff read a client's message
  created_at   timestamptz not null default now()
  foreign key (item_id, firm_id) references request_items (id, firm_id) on delete cascade
  check (read_at is null or not by_staff)
```

- `post_item_message` copies `client_id` and `request_id` from the item, for access checks and queries. Only that function writes rows, so they always match the item.
- `author_name` comes from `firm_members.full_name` or `client_contacts.full_name`. Contacts cannot read other contacts' records, so a stored name is what lets the portal show who wrote. It keeps the name used at the time, even after the author leaves.
- Deleting an item, and so a request or client, deletes its messages.
- Indexes on `(item_id, created_at)` for threads, and on `(firm_id)` for unread client messages (`where not by_staff and read_at is null`) for the dashboard.

### 3.2 Rules

- RLS is enabled with one policy, "Staff and the client's contacts can read messages": `for select to authenticated using (public.is_firm_member(firm_id) or public.is_client_contact(client_id))`.
- `insert`, `update`, and `delete` are revoked from `anon` and `authenticated`. Messages are written only through the functions below.

### 3.3 Functions

Both are `security definer` with `set search_path = ''`, and `execute` is revoked from public and `anon`.

- **`post_item_message(item_id uuid, body text)`** returns `table (email_id bigint, recipient text)`.
  1. The caller must be staff of the item's firm or a contact of its client; otherwise it raises `not_allowed`.
  2. The request must be `open` or `completed`; otherwise it raises `invalid_state`.
  3. It inserts the message with `author_id = auth.uid()`, the author's name, and `by_staff`.
  4. For a staff message, it marks the item's unread client messages read, then queues one `item_message` email per contact of the client in the outbox, held for an hour, with the author as reply-to, and returns them. A contact's message queues nothing and returns no rows.
- **`mark_item_messages_read(item_id uuid)`**: the caller must be staff of the item's firm, or it raises `not_allowed`. It sets `read_at = now()` on the item's unread client messages.

## 4. Screens

### 4.1 Portal

- Under each item, the thread, oldest first. Each message shows who wrote it: "You" for the viewer's own, the firm's name for staff, or the other contact's stored name. It also shows the time in the firm's time zone, and the text with its line breaks.
- An item with no messages shows an "Ask a question" button, which opens the message box. An item with messages shows the box under the thread.
- The box, a textarea labeled "Write a message" (2,000 characters at most) with a "Send" button, shows while the request is open or completed. After sending, a toast says "Message sent." and the thread shows the message.

### 4.2 Request page

- Each item's details get a "Messages" block with the thread, showing each author's stored name. Unread client messages carry a "New" badge.
- "Mark as read" shows when the item has unread client messages.
- A textarea labeled "Write to the client" (2,000 characters at most), the hint "The client's contacts get this by email.", and "Send", while the request is open or completed.
- Each item's details get `id="item-{id}"`, so links can land on them.

### 4.3 Dashboard

- A third tab, "Messages ({n})", after "Waiting on clients" and "Ready for review". It lists items with unread client messages on open or completed requests, newest first:
  - the client and the request;
  - the item, linking to `/app/requests/{id}#item-{itemId}`;
  - the first 100 characters of its latest client message, and when it was written.
- The dashboard's search filters it like the other tabs, by client, request, or item.

## 5. Emails

### 5.1 Staff message email

`itemMessageEmail({ firmName, itemTitle, message, requestId })` returns:

- Subject: "{firm} sent you a message about {item title}".
- Body: "{firm} sent you a message about **{item title}**:", then the message, HTML-escaped with its line breaks kept, then the "Open the request" link. The text version has the same content.

### 5.2 Outbox

The outbox gains a sixth kind, `item_message`:

- It references the request and the item; the outbox's check on references allows it.
- It is queued only by `post_item_message`, as §3.3 describes.
- Rebuilt, it uses the item's latest staff message. It is sent only while the request is `open` or `completed` and the recipient is still a contact of its client.
- Under the outbox's unique key, a newer staff message's email replaces one still waiting for the same item and contact. The email carries the latest message, and its link opens the whole thread.
- Failures show in Activity as "the message about {item}", like the other request emails.

The staff action sends the emails at once in `after()` and records the outcomes, as the outbox spec describes for other actions.

### 5.3 Digest

- `staffDigestEmail` gains a "New messages" list, grouped by request, with each item and its number of new client messages.
- The daily job counts client messages written in each member's window, as it does for submitted items. A member gets a digest when there are new submissions, new messages, or both.
- The outbox's rebuild rule for digests changes to match: a digest is sent while items were submitted, or client messages were written, in its window.

## 6. Server Actions

- **Portal, `postItemMessage(itemId, body)`:** validates the id with `isId` and the body with the `text()` helper (2,000 characters), calls `post_item_message` through the user-scoped client, and revalidates the portal request page.
- **Staff, `postStaffMessage(itemId, body)`:**
  1. Calls `requireStaff()` and validates as above.
  2. Builds the email from the item's title and the firm's name before changing anything.
  3. Calls `post_item_message`.
  4. Sends the returned emails in `after()`, and revalidates the request page and the dashboard.
- **Staff, `markItemMessagesRead(itemId)`:** calls `requireStaff()`, validates the id, calls the function, and revalidates the request page and the dashboard.

## 7. Errors

- An empty or too-long message returns the `text()` helper's error as a toast, and the box keeps what was typed.
- A request that is not open or completed returns the `invalid_state` message: "This has changed since the page loaded. Refresh and try again."
- A caller without access returns the `not_allowed` message: "That isn't available to you. It may have been removed."
- Other database errors map through `lib/errors.ts`.

## 8. Tests

- **pgTAP**, in a new file:
  - Staff of the firm and contacts of the client read an item's messages; another firm's staff, another client's contacts, and `anon` read nothing.
  - Nobody can insert, update, or delete messages directly.
  - `post_item_message`:
    - a staff message is marked `by_staff` with the staff member's name, marks the item's client messages read, and queues one `item_message` email per contact;
    - a contact's message is not `by_staff`, stays unread, and queues nothing;
    - outsiders are refused, as are archived and draft requests, an empty body, and 2,001 characters.
  - `mark_item_messages_read` works for the firm's staff only.
  - Deleting an item, a request, or a client removes its messages.
- **Unit:**
  - `itemMessageEmail`: escaped, with line breaks kept.
  - `staffDigestEmail` with new messages, and with messages only.
- **Integration:** the daily digest lists new client messages, and goes out when there are only messages.
- **Browser:**
  - A contact asks a question on an item. Staff see it in the Messages tab, reply on the request page, and the tab empties. The contact sees the reply under the item.
  - A second question is cleared with "Mark as read".

## 9. Other changes

- Regenerate `lib/database.types.ts` after the migration.
- v1 spec: add `item_messages` to §7.2, its policy to §8.2, and the functions to §8.3; add the email to the table in §11.1 and the new messages to the digest in §11.2.
- Outbox spec: add `item_message` to its kinds, its rebuild table, and its Activity names.
- README: mention messages in the feature description.

## 10. Out of scope

- Attachments in messages; files belong on the item.
- Editing or deleting messages.
- Replying by email.
- Read receipts for clients.
- Live updates without reloading the page.
- Activity entries for messages.
- Messages about a request as a whole.
