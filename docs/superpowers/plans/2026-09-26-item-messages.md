# Messages on an Item: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each item gets a short conversation between the client's contacts and the firm's staff. Client messages reach staff on the dashboard and in the digest, and staff messages reach the client by email.

**Architecture:** An `item_messages` table that only two `security definer` functions write: `post_item_message` and `mark_item_messages_read`. A staff message queues an `item_message` email in the outbox, a new sixth kind, in the same transaction. The portal and the request page render the thread. The dashboard gains a Messages tab, and the daily digest a "New messages" list.

**Tech Stack:** Next.js 16 (App Router, `after()`), Supabase (Postgres, RLS, pgTAP), zod 4, Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-26-item-messages-design.md`](../specs/2026-09-26-item-messages-design.md)

**Build order:** 12 of 12, after [photos into one PDF](2026-09-26-scan-pages.md). It requires [the email outbox](2026-09-26-email-outbox.md) (plan 9): `deliver`, `renderQueued`, the `email_outbox_references_check` constraint, and the digest window logic.

**Commands:** as in the backlog plan's [How to run things](2026-09-25-paperline-backlog.md#how-to-run-things-windows).

**Execution:** Native, chosen by the user on 2026-09-26. One session implements this plan's tasks in order (superpowers:executing-plans), then one fresh reviewer checks this plan's diff before the next plan starts. Start only when the user says so.

## Global Constraints

- Messages are plain text, 1 to 2,000 characters, with line breaks kept (`LIMITS.itemMessage = 2000`). They cannot be edited or deleted.
- Staff of the firm and contacts of the client may write while the request is `open` or `completed`. Archived requests show a read-only thread.
- `author_name` is stored when the message is written: `firm_members.full_name` for staff, `client_contacts.full_name` for contacts.
- A client message is unread until a staff member replies on that item or clicks "Mark as read", which applies to the whole firm.
- No Activity entries for messages. Return notes stay as they are.
- Copy, verbatim:
  - The portal: "Ask a question"; "Write a message"; "Send"; "Message sent."; "You" for the viewer's own messages, and the firm's name for staff messages.
  - The request page: "Messages"; "New"; "Mark as read"; "Write to the client"; "The client's contacts get this by email."
  - The dashboard: "Messages ({n})".
  - The email: "{firm} sent you a message about {item title}".
  - The digest: "New messages".
  - The outbox's Activity label: "the message about {item}".
- **Decisions the spec leaves open.**
  - The digest subject is "{n} items submitted at {firm}" as today when it has only items; "{m} new messages at {firm}" with only messages; and "{n} items submitted and {m} new messages at {firm}" with both, each noun singular for 1.
  - A link to `#item-{id}` opens that item's review sheet on the request page.
- Add a new migration only; run `npm run db:types` after it. One Conventional Commit per task, with no AI attribution lines. Do not push.

## Review Focus

1. **A contact of another client**, or staff of another firm, cannot read or post on an item. Pinned in Task 1 (pgTAP).
2. **A second staff message while the first email is still waiting** leaves one email, carrying the latest text. Pinned in Task 1 (pgTAP: same outbox id) and Task 2 (unit: render uses the latest staff message).
3. **A client message written just before archiving** never shows in the Messages tab, since the request is closed. Pinned in Task 4 (browser: archive, then the tab count drops).
4. **Line breaks and `<b>` in a message** show as typed on both sides and are escaped in the email. Pinned in Task 2 (unit) and Task 3 (browser, two lines).
5. **A digest with only messages** still goes out, with the right subject. Pinned in Task 2 (unit and integration).

---

### Task 1: Messages in the database

**Files:**
- Create: `supabase/migrations/20260926001200_item_messages.sql`
- Create: `supabase/tests/item_messages_test.sql`
- Modify: `lib/database.types.ts` (generated)

**Interfaces:**
- Produces: table `item_messages`, as in spec §3.1; `post_item_message(item_id uuid, body text) returns table (email_id bigint, recipient text)`; `mark_item_messages_read(item_id uuid) returns void`; outbox kind `item_message`.

- [ ] **Step 1: Write the failing pgTAP test** `item_messages_test.sql`, with the shared seed:
  - As c1: `post_item_message(a1, 'Which bank?')` returns no rows. The message has `by_staff = false`, `author_name = 'Contact A1'`, and a null `read_at`.
  - As a2: `post_item_message(a1, 'The BDO one')` returns one row for `contact-a1@test.local`. The message has `by_staff = true` and `author_name = 'Staff A'`. c1's message now has `read_at` set. The outbox row has `kind = 'item_message'`, `item_id = a1`, `reply_to_id = a2`, and a one-hour hold.
  - As a1: a second staff message returns the same `email_id`.
  - Reading: a1, a2, and c1 see both messages; c2, b1, and `anon` see none. An `insert`, `update`, or `delete` on `item_messages` as a1 throws `42501`.
  - Refusals:
    - c2 on a1 raises `not_allowed`, and so does b1;
    - on the draft's item a9, c1 gets `not_allowed` (drafts stay invisible to contacts) and a1 gets `invalid_state`;
    - after request A1 is archived as postgres, a new message raises `invalid_state`;
    - an empty body or 2,001 characters throws `23514`.
  - `mark_item_messages_read(a1)`: as c1 it raises `not_allowed`. As a1, after a new c1 message, it sets that message's `read_at`.
  - Deleting item a1 as postgres removes its messages.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:db`
Expected: FAIL.

- [ ] **Step 3: Write the migration**
  - The table, check, foreign key, and indexes from spec §3.1, with RLS and the one select policy from spec §3.2. Revoke `insert, update, delete` from `anon, authenticated`.
  - The outbox: replace `email_outbox_kind_check` to allow `item_message`, and replace `email_outbox_references_check` so `item_message`, like `needs_changes`, needs a request and an item.
  - `post_item_message`: `security definer`, following spec §3.3.
    - Load the item with its request's firm, client, and status. Decide `by_staff` with `is_firm_member`, or accept a contact through `is_client_contact` only when the request is not a draft; otherwise `not_allowed`.
    - The request must be `open` or `completed`, or `invalid_state`.
    - Insert the message with the author's name.
    - For staff: set `read_at` on the item's unread client messages, then insert one `item_message` outbox row per contact (held an hour, `reply_to_id = auth.uid()`) with `on conflict on constraint email_outbox_waiting_key do update`, and `return query` them.
  - `mark_item_messages_read`: `security definer`; staff of the item's firm, or `not_allowed`.
  - Revoke `execute` on both from `public, anon`.

- [ ] **Step 4: Apply, regenerate, and test**

Run: `npx supabase migration up --local`, `npm run db:types`, `npm run test:db`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase lib/database.types.ts
git commit -m "feat: add item messages and queue staff replies in the outbox"
```

---

### Task 2: The email, the digest, and the outbox kind

**Files:**
- Modify: `lib/email/templates.ts`, `lib/email/templates.test.ts`
- Modify: `lib/email/outbox.ts`, `lib/daily-jobs.ts`, `lib/activity.ts`, `lib/activity.test.ts`
- Modify: `integration/outbox.test.ts`

**Interfaces:**
- Produces:
  - `itemMessageEmail({ firmName, itemTitle, message, requestId }): EmailContent`;
  - `DigestMessageGroup = { clientName: string; requestTitle: string; requestId: string; items: { title: string; count: number }[] }`;
  - `staffDigestEmail({ firmName, groups, messages })`, where `messages: DigestMessageGroup[]` defaults to `[]`.

- [ ] **Step 1: Write the failing tests**
  - `templates.test.ts`:
    - `itemMessageEmail({ firmName: "Smith & Co", itemTitle: "Bank statement", message: "Hi <b>Pat</b>\nThe BDO one", requestId: "r1" })` has the subject `Smith & Co sent you a message about Bank statement`. Its HTML contains `Hi &lt;b&gt;Pat&lt;/b&gt;<br>The BDO one`, its text contains `Hi <b>Pat</b>\nThe BDO one`, and it links to `/portal/requests/r1`.
    - A digest with only messages has the subject `2 new messages at Smith & Co`, a "New messages" section, and the line `Bank statement (2 new messages)`.
    - A digest with both has the subject `1 item submitted and 1 new message at Smith & Co`.
    - The existing items-only digest tests are unchanged.
  - `activity.test.ts`: `describeEvent("email_failed", { email: "item_message", to: "pat@example.com", reason: "connection problem", outcome: "retrying" }, "Bank statement")` is `"couldn't send the message about “Bank statement” to pat@example.com (connection problem). Trying again tomorrow."`.
  - `integration/outbox.test.ts`:
    - An `item_message` row is sent with the item's latest staff message.
    - It is dropped once the request is archived.
    - A digest run with one new client message and no submissions sends that member a digest.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run lib/email/templates.test.ts lib/activity.test.ts`, `npm run test:integration`
Expected: FAIL.

- [ ] **Step 3: Implement**
  - The template, and the digest's messages section and subject rules from Global Constraints.
  - `renderQueued` handles `item_message`, following spec §5.2: the item's latest staff message, sent only while the request is `open` or `completed` and the recipient is a contact.
  - The daily job's digest check counts client messages (`by_staff = false`) written in the member's window as well as submitted items. `renderQueued` builds the `messages` groups for `staff_digest` rows from the same window.
  - `describeEvent`'s label helper maps `item_message` to `the message about ${quoted(item)}`.

- [ ] **Step 4: Run them to verify they pass**

Run: `npm test`, `npm run test:integration`, `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib integration
git commit -m "feat: email staff messages and add new messages to the digest"
```

---

### Task 3: The thread in the portal

**Files:**
- Modify: `lib/constants.ts`, `lib/validation.ts`, `lib/validation.test.ts`
- Modify: `app/portal/requests/[id]/actions.ts`, `app/portal/requests/[id]/page.tsx`, `app/portal/requests/[id]/item-card.tsx`
- Create: `components/item-thread.tsx`, shared with Task 4
- Create: `e2e/item-messages.spec.ts`

**Interfaces:**
- Consumes: `post_item_message` (Task 1).
- Produces:
  - `LIMITS.itemMessage = 2000`; `itemMessageSchema = text("Message", LIMITS.itemMessage)`;
  - `postItemMessage(itemId: string, body: string): Promise<ActionResult>`;
  - `ThreadMessage = { id: string; author: string; body: string; at: string; isNew?: boolean }`;
  - `ItemThread({ messages, canWrite, label, hint, send, emptyButton })`, which renders the list and the box. `emptyButton` names the button that opens the box when there are no messages: "Ask a question" in the portal, and none for staff.

- [ ] **Step 1: Write the failing tests**
  - `lib/validation.test.ts`: `itemMessageSchema` trims, refuses blank text with "Message is required.", and refuses 2,001 characters with "Message must be 2,000 characters or fewer.".
  - `e2e/item-messages.spec.ts`, test "a client asks and staff answer", the portal part:
    1. Staff send "Pat Client" a request with the item "Bank statement".
    2. The contact clicks "Ask a question", types "Which bank?\nI have two accounts.", and clicks "Send".
    3. The toast reads "Message sent." The thread shows "You" and both lines.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run lib/validation.test.ts`, `npx playwright test e2e/item-messages.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**
  - The schema, and `postItemMessage`: `isId`; the schema; `rpc("post_item_message")`; `fail`; `revalidateRequestPages()`.
  - The portal page reads `item_messages` (`id, item_id, author_id, author_name, by_staff, body, created_at`) for the request, oldest first, and `getUser()` for the viewer's id. It maps each author to "You", the firm's name for staff, or `author_name`. It formats `at` in the firm's time zone; the portal page gets the firm's `time_zone` with its name.
  - `ItemThread` renders the messages with `whitespace-pre-wrap`, and the box (a `Textarea` with `maxLength={LIMITS.itemMessage}` and "Send"). It uses `useActionState` with `submitKeepingValues`, and clears after a success.
  - `ItemCard` renders `ItemThread` under the item's content, with `canWrite` true when the request is `open` or `completed`. The portal page passes the request status for this, not only `requestOpen`.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run lib/validation.test.ts`, `npx playwright test e2e/item-messages.spec.ts`, `npm run typecheck`, `npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib app e2e/item-messages.spec.ts
git commit -m "feat: let clients write messages on an item in the portal"
```

---

### Task 4: Staff replies, the Messages tab, and docs

**Files:**
- Modify: `app/app/requests/actions.ts`, `app/app/requests/[id]/page.tsx`, `app/app/requests/[id]/review-items.tsx`
- Modify: `app/app/page.tsx`, `app/app/dashboard-tabs.tsx`
- Modify: `e2e/item-messages.spec.ts`
- Modify: `README.md`, `docs/superpowers/specs/2026-09-24-client-portal-design.md` (§7.2, §8.2, §8.3, §11.1, §11.2), `docs/superpowers/specs/2026-09-26-email-outbox-design.md` (kinds, the rebuild table, and the Activity names)

**Interfaces:**
- Consumes: Task 1's functions; plan 9's `deliver`; Task 2's template; Task 3's `ItemThread`.
- Produces:
  - `postStaffMessage(itemId: string, body: string): Promise<ActionResult>`;
  - `markItemMessagesRead(itemId: string): Promise<ActionResult>`;
  - `ReviewItem.messages: ThreadMessage[]`;
  - `MessageRow = { requestId: string; itemId: string; client: string; request: string; item: string; latest: string; at: string }`.

- [ ] **Step 1: Extend the browser test**
  1. Staff open the dashboard's "Messages (1)" tab. The row shows "Pat Client", the request, "Bank statement", and "Which bank?".
  2. Its item link opens the request page with the "Bank statement" sheet open. The client's message has a "New" badge.
  3. Staff type "The BDO one, please." under "Write to the client" and click "Send". The tab shows "Messages (0)".
  4. The contact reloads and sees "Ledger & Co" with "The BDO one, please.".
  5. The contact sends "Thanks!". Staff click "Mark as read" in the sheet, and the tab shows "Messages (0)".
  6. The contact sends another message, and staff archive the request. The tab shows "Messages (0)".

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test e2e/item-messages.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**
  - `postStaffMessage`:
    1. `requireStaff()`; `isId`; parse with the schema.
    2. Read the item's title and the firm's name, and build `itemMessageEmail` before changing anything.
    3. Call `rpc("post_item_message")` to get the queued rows.
    4. `after(() => deliver(supabase, rows.map(...)))`, with `replyTo: staff.email`.
    5. Revalidate the request page and `/app`.
  - `markItemMessagesRead`: `requireStaff()`; `isId`; the RPC; revalidate the same.
  - The request page reads the request's `item_messages` and maps them per item: `author_name`, `at`, and `isNew` for a client message with a null `read_at`. In `ItemDetails`:
    - a "Messages" block with `ItemThread`: the label "Write to the client", the hint, and `canWrite` when `editable`;
    - "Mark as read" (`ActionButton`) when any message is new.
  - In `ReviewItems`, give each row `id="item-{id}"`, and on mount open the sheet for the item named in `location.hash`.
  - The dashboard page queries unread client messages (`by_staff = false`, `read_at is null`, the firm) with `requests!inner(title, status, clients(name))` and `request_items(title)`, where the request is `open` or `completed`. It keeps the latest per item, newest first, with its first 100 characters.
  - `DashboardTabs` gets a third tab, "Messages ({n})", after "Ready for review". Its columns are Client, Request (a link), Item (a link to `/app/requests/{id}#item-{itemId}`), the latest message, and when it was written. It is filtered by the same search.
  - Docs:
    - v1 spec: `item_messages` in §7.2, its policy in §8.2, and the functions in §8.3; the email in §11.1's table; new messages in §11.2's digest.
    - The outbox spec: `item_message` in its kinds, its rebuild table, and its Activity names.
    - README: messages in the feature description.

- [ ] **Step 4: Run the tests**

Run: `npx playwright test e2e/item-messages.spec.ts`, `npm test`, `npm run typecheck`, `npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app e2e/item-messages.spec.ts README.md docs/superpowers/specs
git commit -m "feat: staff replies, the Messages tab, and mark as read"
```

---

## Finish

Run every suite once: `npm run test:db`, `npm test`, `npm run test:integration`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e`. Then check `git status` for a clean tree.
