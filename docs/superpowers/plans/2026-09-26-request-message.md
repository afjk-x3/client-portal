# A Personal Message with a Request: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff can add an optional message to a request. It appears in the "request sent" email and at the top of the client's portal page.

**Architecture:** A nullable `requests.message` column. `save_draft` and `send_requests` gain a trailing `message` argument, and the migration drops and recreates them so no ambiguous overload remains. The draft editor, bulk send, and Edit details each get a textarea. `requestSentEmail` and the portal render the message.

**Tech Stack:** Next.js 16 (App Router), Supabase (Postgres, RLS, pgTAP), zod 4, Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-26-request-message-design.md`](../specs/2026-09-26-request-message-design.md)

**Build order:** 4 of 12, after [retention and deletion](2026-09-26-retention-and-deletion.md). Next: [export clients to CSV](2026-09-26-client-export.md).

**Commands:** as in the backlog plan's [How to run things](2026-09-25-paperline-backlog.md#how-to-run-things-windows).

**Execution:** Native, chosen by the user on 2026-09-26. One session implements this plan's tasks in order (superpowers:executing-plans), then one fresh reviewer checks this plan's diff before the next plan starts. Start only when the user says so.

## Global Constraints

- The message is plain text, 1 to 2,000 characters when present, stored trimmed. A blank message is stored as null. `LIMITS.message = 2000` matches the column check.
- Reminders, templates, and copies (plan 2's Copy) never carry the message.
- Emails already sent keep the old text; the portal always shows the current text.
- Copy, verbatim: the field "Message to the client (optional)"; the portal card "Message from {firm}"; the error "Message must be 2,000 characters or fewer.".
- With no message, every screen and email is exactly as today.
- Add a new migration only; run `npm run db:types` after it. One Conventional Commit per task, with no AI attribution lines. Do not push.

## Review Focus

1. **A message of only spaces or line breaks** is stored as null, and no empty card appears. Pinned in Task 2 (schema unit test).
2. **A message with `<script>`, `&`, or quotes** is escaped in the email's HTML and shown as text in the portal. Pinned in Task 2 (template unit test).
3. **Line breaks** survive in the email (`<br>` in HTML, newlines in text) and in the portal (`whitespace-pre-wrap`). Pinned in Task 2 (template unit test) and Task 3 (browser test, two lines).
4. **Clearing the message in Edit details** removes the portal card. Pinned in Task 3 (browser test).
5. **Old callers of `save_draft` and `send_requests` without a message** keep working and store null. Pinned in Task 1 (the existing pgTAP files run unchanged, and a new assertion checks null).

---

### Task 1: The column and the two functions

**Files:**
- Create: `supabase/migrations/20260926000600_request_message.sql`
- Create: `supabase/tests/request_message_test.sql`
- Modify: `lib/database.types.ts` (generated)

**Interfaces:**
- Produces: `requests.message text`; `save_draft(client_id, title, due_date, items, request_id default null, message text default null) returns uuid`; `send_requests(template_id, title, due_date, client_ids, request_ids, message text default null) returns void`.

- [ ] **Step 1: Write the failing pgTAP test** `request_message_test.sql`, with the shared seed, as staff a1:
  - `save_draft(client_id => A1, title => 'With message', due_date => current_date + 7, items => '[]', message => 'Hi Maria')` returns an id whose `message` is `'Hi Maria'`.
  - Saving that draft again with `request_id => id` and no message sets `message` to null.
  - `send_requests(template_id => Template A, title => 'Bulk', due_date => current_date + 7, client_ids => array[A1, A2], request_ids => array[gen_random_uuid(), gen_random_uuid()], message => 'Line one' || chr(10) || 'Line two')` stores that message on both new requests.
  - A `send_requests` call without `message` stores null.
  - As postgres, `update public.requests set message = repeat('x', 2001)` throws `23514`, and so does `message = ''`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:db`
Expected: FAIL, because the column and the argument do not exist.

- [ ] **Step 3: Write the migration**
  - `alter table public.requests add column message text check (message is null or char_length(message) between 1 and 2000)`.
  - `drop function public.save_draft(uuid, text, date, jsonb, uuid)`, then `create function public.save_draft(...)` with the same body plus a trailing `message text default null`. The insert and the draft update both set `message = save_draft.message`. Then `revoke execute on function public.save_draft(uuid, text, date, jsonb, uuid, text) from public, anon`.
  - `drop function public.send_requests(uuid, text, date, uuid[], uuid[])`, then recreate it with a trailing `message text default null`. The requests insert sets `message`. Revoke as before, with the new signature.

- [ ] **Step 4: Apply, regenerate, and test**

Run: `npx supabase migration up --local`, `npm run db:types`, `npm run test:db`
Expected: all pgTAP files pass, including the unchanged `request_editing_test.sql` and `send_requests_test.sql`.

- [ ] **Step 5: Commit**

```bash
git add supabase lib/database.types.ts
git commit -m "feat: store an optional message on requests"
```

---

### Task 2: The message in the email, and its schema

**Files:**
- Modify: `lib/constants.ts`, `lib/validation.ts`, `lib/validation.test.ts`
- Modify: `lib/email/templates.ts`, `lib/email/templates.test.ts`

**Interfaces:**
- Produces:
  - `LIMITS.message = 2000`;
  - `messageSchema`, an optional string that is trimmed, capped at 2,000 characters, and returns `string | null`;
  - `draftSchema`, `requestDetailsSchema`, and `bulkSendSchema`, each gaining `message: messageSchema`;
  - `requestSentEmail({ ...existing, message?: string | null })`.

- [ ] **Step 1: Write the failing unit tests**
  - `lib/validation.test.ts`:
    - `messageSchema.parse("  Hi Maria  ")` is `"Hi Maria"`;
    - `messageSchema.parse("  \n  ")` is null, and so is `messageSchema.parse(undefined)`;
    - `messageSchema.safeParse("x".repeat(2001)).error?.issues[0].message` is `"Message must be 2,000 characters or fewer."`.
  - `lib/email/templates.test.ts`, with `message: "Hi <b>Maria</b>\nPlease upload by the 15th."`:
    - the HTML contains `Hi &lt;b&gt;Maria&lt;/b&gt;<br>Please upload by the 15th.`, after the sentence "It has 2 items and is due" and before `Open the request`;
    - the text contains `\n\nHi <b>Maria</b>\nPlease upload by the 15th.\n\nOpen the request:`;
    - `message: null` gives exactly today's output: the existing snapshot assertions stay.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run lib/validation.test.ts lib/email/templates.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**
  - Next to `text()` in `lib/validation.ts`, add a private `optionalText(label, max)`: trim, cap at `max` with the same error format, and return null for empty or undefined. Then `export const messageSchema = optionalText("Message", LIMITS.message)`, and add `message: messageSchema` to the three object schemas.
  - `requestSentEmail` inserts the message block (escaped, with `\r?\n` turned into `<br>`) as its own paragraph in the HTML, and as its own paragraph in the text, only when it is set.

- [ ] **Step 4: Run them to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib
git commit -m "feat: include the request's message in the request-sent email"
```

---

### Task 3: Where staff type it and clients see it

**Files:**
- Modify: `app/app/requests/actions.ts` (`saveDraft`, `sendRequest`, `sendToClients`, `updateRequestDetails`)
- Modify: `app/app/requests/request-editor.tsx`, `app/app/requests/new/page.tsx`, `app/app/requests/[id]/page.tsx`, `app/app/requests/[id]/request-actions.tsx`
- Modify: `app/app/templates/[id]/send/send-to-clients-form.tsx`
- Modify: `app/portal/requests/[id]/page.tsx`
- Create: `e2e/request-message.spec.ts`
- Modify: `README.md`, `docs/superpowers/specs/2026-09-24-client-portal-design.md` (§7.2)

**Interfaces:**
- Consumes: Task 1's function arguments, and Task 2's schemas and template.
- Produces: `RequestEditor`'s `initial` gains `message: string`; `RequestActions` gains `message: string | null`.

- [ ] **Step 1: Write the failing browser test** `e2e/request-message.spec.ts`:
  1. Staff create a request for a client with a contact, type "Hi Pat,\nThese are for your 2026 return." in "Message to the client (optional)", and send it.
  2. The contact opens it and sees a card "Message from {firm}" containing both lines, above the progress bar.
  3. Staff open Edit details, change the message to "Please upload by the 15th.", and save. The contact reloads and sees the new text.
  4. Staff clear the message in Edit details. The contact reloads and sees no "Message from" card.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test e2e/request-message.spec.ts`
Expected: FAIL, because there is no message field.

- [ ] **Step 3: Implement**
  - `saveDraft` passes `message` to `save_draft`. `sendToClients` passes it to `send_requests` and to each `requestSentEmail`.
  - `sendRequest` selects `message` and passes it to `requestSentEmail`.
  - `updateRequestDetails` updates `message` with the title and due date.
  - `RequestEditor`: a `Textarea` labeled "Message to the client (optional)", `maxLength={LIMITS.message}`, under the due date. `save()` sends it, and the post-save reset clears it. The draft page passes the draft's `message ?? ""`, and the New request page passes `""`, including for a copy.
  - The bulk send form gets the same textarea under the due date and passes `message`.
  - `EditDetailsDialog` gets a `Textarea name="message"` with `defaultValue={message ?? ""}`. The request page passes `message`.
  - The portal page selects `message`. When it is set, a `Card` titled "Message from {firm}" shows it with `whitespace-pre-wrap`, before the progress bar.

- [ ] **Step 4: Run the tests**

Run: `npx playwright test e2e/request-message.spec.ts`, `npm test`, `npm run typecheck`, `npm run lint`
Expected: PASS.

- [ ] **Step 5: Docs**
  - v1 spec §7.2: add `message text` (optional, 1 to 2,000 characters) to `requests`.
  - README: add the message to the feature description.

- [ ] **Step 6: Commit**

```bash
git add app e2e/request-message.spec.ts README.md docs/superpowers/specs/2026-09-24-client-portal-design.md
git commit -m "feat: let staff add a personal message to a request"
```

---

## Finish

Run every suite once: `npm run test:db`, `npm test`, `npm run test:integration`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e`. Then check `git status` for a clean tree.
