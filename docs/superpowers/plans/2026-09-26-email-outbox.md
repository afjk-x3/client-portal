# Email Outbox and Delivery Status: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every app email is recorded in an outbox before it is sent. A failed or interrupted email goes out in a later daily run, and staff see failures in the request's Activity section.

**Architecture:** An `email_outbox` table holds references only. Staff cannot touch it directly: actions queue through `security definer` functions before changing anything, and `send_requests` and `claim_reminder` queue inside their own transactions. Actions still send at once in `after()`, then record each outcome. The daily job queues reminders and digests, then claims due rows with `for update skip locked`, rebuilds each email from current data, and sends it. `record_email_result` applies the retry rules and writes the two new Activity events.

**Tech Stack:** Next.js 16 (App Router, `after()`), Supabase (Postgres, RLS, pgTAP), nodemailer and Resend, Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-26-email-outbox-design.md`](../specs/2026-09-26-email-outbox-design.md)

**Build order:** 9 of 12, after [private staff notes](2026-09-26-staff-notes.md). This plan builds on plan 1 (the digest's `{ title, unavailable }` items) and plan 4 (`requests.message`, and `send_requests`' `message` argument). Next: [recurring requests](2026-09-26-recurring-requests.md), then [messages on an item](2026-09-26-item-messages.md), which both queue through this outbox.

**Commands:** as in the backlog plan's [How to run things](2026-09-25-paperline-backlog.md#how-to-run-things-windows).

**Execution:** Native, chosen by the user on 2026-09-26. One session implements this plan's tasks in order (superpowers:executing-plans), then one fresh reviewer checks this plan's diff before the next plan starts. Start only when the user says so.

## Global Constraints

- The kinds are `request_sent`, `needs_changes`, `reminder`, `staff_added`, and `staff_digest`. Rows hold references, never email text.
- Rows queued by an action are held for one hour (`send_after = now() + interval '1 hour'`). Rows queued by the daily job are due at once. A claim leases a row for one hour.
- There is one waiting row per `(kind, recipient, request_id, item_id, window_end)`, with nulls not distinct. Queuing again replaces the waiting row: `failures = 0`, and the firm, reply-to, and `send_after` are set anew.
- An email is tried at most 4 times: the first attempt, then 3 daily runs. A permanent failure gives up at once.
- Short reasons, verbatim: "daily sending limit reached", "connection problem", and "email is not set up"; otherwise the server's reply, cut to 200 characters.
- Activity events (`email_failed`, `email_sent_late`) are written for the three request kinds only, with a null actor. Their Activity lines are verbatim from spec §6.
- The daily log line replaces `sent` and `failed` with `"outbox":{"sent":n,"retrying":n,"gaveUp":n,"dropped":n}`.
- No browser test is added; the existing browser suites must pass unchanged.
- Add new migrations only; run `npm run db:types` after each. One Conventional Commit per task, with no AI attribution lines. Do not push.

## Review Focus

1. **Gmail's "550 5.4.5 Daily user sending limit exceeded"** is a 5xx, yet must retry. Pinned in Task 1 (unit test).
2. **A bad app password (EAUTH)** retries rather than giving up every email of the day. Pinned in Task 1 (unit test).
3. **A retried reminder on a day with a new reminder** goes out once. Pinned in Task 5 (integration test).
4. **Sending a request twice, from a double click or a colleague,** queues one email per contact, and the loser's rows are dropped. Pinned in Task 2 (pgTAP: a second `request_sent` queue for a sent request raises `invalid_state`) and Task 5 (integration: a row for a draft is dropped).
5. **An outcome recorded by staff of another firm, or by a contact,** changes nothing. Pinned in Task 3 (pgTAP).

---

### Task 1: Per-message outcomes from `sendEmails`

**Files:**
- Modify: `lib/email/send.ts`, `lib/email/send.test.ts`

**Interfaces:**
- Produces:
  - `EmailOutcome = { ok: true } | { ok: false; reason: string; retry: boolean }`;
  - `sendEmails(messages): Promise<{ sent: number; failed: number; results: EmailOutcome[] }>`, with `results[i]` for `messages[i]`;
  - `smtpOutcome(error: unknown): EmailOutcome` and `resendOutcome(error: unknown): EmailOutcome`, both exported for tests.

- [ ] **Step 1: Write the failing unit tests** in `send.test.ts`:
  - `smtpOutcome({ responseCode: 550, response: "550-5.4.5 Daily user sending limit exceeded." })` is `{ ok: false, reason: "daily sending limit reached", retry: true }`.
  - `smtpOutcome({ code: "ECONNECTION" })` and `smtpOutcome({ code: "ETIMEDOUT" })` give "connection problem" with `retry: true`.
  - `smtpOutcome({ code: "EAUTH", responseCode: 535, response: "535 5.7.8 Username and Password not accepted" })` gives that reply with `retry: true`.
  - `smtpOutcome({ responseCode: 451, response: "451 4.3.0 Try later" })` has `retry: true`. `smtpOutcome({ responseCode: 550, response: "550 5.1.1 The email account that you tried to reach does not exist" })` has `retry: false`. `smtpOutcome({ code: "EENVELOPE", message: "No recipients defined" })` has `retry: false`.
  - A 300-character reply is cut to 200 characters.
  - `resendOutcome({ name: "daily_quota_exceeded", message: "…" })` gives "daily sending limit reached", retrying. `rate_limit_exceeded`, `statusCode: 500`, and `invalid_api_key` retry. `validation_error` does not. `new TypeError("fetch failed")` gives "connection problem", retrying.
  - Over SMTP, with three messages where the second's `sendMail` rejects with 5.1.1: `results` is `[ok, {retry: false}, ok]`.
  - Through Resend, a batch whose `data.errors` rejects index 1 gives `results[1]` with that message and `retry: false`. A batch refused with `rate_limit_exceeded` after its retries gives every message `retry: true`.
  - With `emailConfigError()` set, every result is `{ ok: false, reason: "email is not set up", retry: true }`.
  - The existing tests keep their `sent` and `failed` assertions.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run lib/email/send.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** The classification follows the table in spec §5.4. Keep `smtpTransient` and `resendTransient` for the in-call retries, unchanged. Log mode (no transport) returns `{ ok: true }` for every message.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run lib/email/send.test.ts`, `npm run typecheck`
Expected: PASS. Callers still compile, since `sent` and `failed` remain.

- [ ] **Step 5: Commit**

```bash
git add lib/email/send.ts lib/email/send.test.ts
git commit -m "feat: report each email's outcome and whether a retry can succeed"
```

---

### Task 2: The outbox table and queuing

**Files:**
- Create: `supabase/migrations/20260926000800_email_outbox.sql`
- Create: `supabase/tests/email_outbox_test.sql`
- Modify: `supabase/tests/send_reminder_test.sql`, `supabase/tests/send_requests_test.sql` (new return types)
- Modify: `lib/database.types.ts` (generated)

**Interfaces:**
- Produces:
  - table `email_outbox`, as in spec §3.1, with the unique constraint named `email_outbox_waiting_key`;
  - `queue_request_emails(kind text, request_id uuid, item_id uuid default null) returns table (email_id bigint, recipient text)`;
  - `queue_staff_added(user_id uuid) returns bigint`;
  - `send_requests(template_id, title, due_date, client_ids, request_ids, message default null) returns table (email_id bigint, request_id uuid, recipient text)`;
  - `claim_reminder(request_id uuid) returns table (email_id bigint, recipient text)`.

- [ ] **Step 1: Write the failing pgTAP test** `email_outbox_test.sql`, with the shared seed:
  - As a1 and as c1, `select * from public.email_outbox` throws `42501`, and so does an insert.
  - As a1, `queue_request_emails('request_sent', A9)` for the draft returns one row, `contact-a1@test.local`. The row has `reply_to_id = a1`, `failures = 0`, and `send_after` about an hour away, checked as postgres with `between now() + interval '59 minutes' and now() + interval '61 minutes'`.
  - Calling it again returns the same `email_id`. As postgres, first set that row's `failures` to 2, then check it is 0 again.
  - It raises `invalid_state` for `request_sent` on the open request A1, for `needs_changes` on a1 while a1 is `requested`, and for `reminder`. After a1 is set `submitted` as postgres, `needs_changes` on (A1, a1) returns a row with `item_id = a1`.
  - As b1, it raises `not_allowed` for A9. As c1, `not_allowed`.
  - `queue_staff_added`: as a2 (not an admin), `not_allowed`. As a1, for d1 (no firm), it returns an id whose recipient is `nobody@test.local`. For a2 (already a member), it throws `23505`.
  - `send_requests` as a1, for clients A1 and A2, returns two rows with each new request's id and its contact.
  - `claim_reminder(A1)` as a1 returns one row. A second call returns none.
  - Deleting request A1 as postgres removes its rows.
  - Update `send_reminder_test.sql` for the new return type (row counts in place of booleans), and `send_requests_test.sql` if it asserts the void return.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:db`
Expected: FAIL.

- [ ] **Step 3: Write the migration**
  - The table:
    - the columns from spec §3.1;
    - the per-kind check, named `email_outbox_references_check`: a request for the three request kinds, an item for `needs_changes` only, and both window bounds for `staff_digest` only (plan 12 replaces it to add `item_message`);
    - `constraint email_outbox_waiting_key unique nulls not distinct (kind, recipient, request_id, item_id, window_end)`;
    - indexes on `firm_id`, `request_id`, and `item_id`.
  - Access: `enable row level security` with no policies, and `revoke all on public.email_outbox from anon, authenticated`.
  - `queue_request_emails`: `security definer`, following spec §4.2. It inserts one row per `client_contacts` email of the request's client, with `reply_to_id = auth.uid()` and the hour's hold, `on conflict on constraint email_outbox_waiting_key do update` of the firm, reply-to, `failures = 0`, and `send_after`, `returning id, recipient`.
  - `queue_staff_added`, following spec §4.2. The caller's firm comes from their admin membership, or `not_allowed`. `raise exception 'already_member' using errcode = '23505'` for a user who is already in a firm. The recipient comes from `auth.users.email`.
  - `send_requests`: drop plan 4's version and recreate it with the table return type. Before its final `update ... set status = 'open'`, add `return query select q.email_id, x.id, q.recipient from unnest(send_requests.request_ids) as x(id) cross join lateral public.queue_request_emails('request_sent', x.id) q;`.
  - `claim_reminder`: drop and recreate it with the table return type. When the insert into `notifications_sent` wins, insert one `reminder` row per contact, as above, and `return query` them.
  - Revoke `execute` on all four from `public, anon`.

- [ ] **Step 4: Apply, regenerate, and test**

Run: `npx supabase migration up --local`, `npm run db:types`, `npm run test:db`
Expected: all pgTAP files pass.

- [ ] **Step 5: Commit**

```bash
git add supabase lib/database.types.ts
git commit -m "feat: add the email outbox and queue emails in the database"
```

---

### Task 3: Claiming, recording, and the Activity events

**Files:**
- Create: `supabase/migrations/20260926000900_email_results.sql`
- Create: `supabase/tests/email_results_test.sql`
- Modify: `lib/database.types.ts` (generated), `lib/activity.ts`, `lib/activity.test.ts`

**Interfaces:**
- Produces: `claim_due_emails(max_rows int default 100) returns setof public.email_outbox`; `record_email_result(email_id bigint, reason text default null, retry boolean default false) returns void`; the event kinds `email_failed` (detail `email`, `to`, `reason`, `outcome`) and `email_sent_late` (detail `email`, `to`).

- [ ] **Step 1: Write the failing tests**
  - pgTAP `email_results_test.sql`. Queue rows as postgres by inserting directly, with `send_after` in the past unless stated.
    - As `service_role`, `claim_due_emails(2)` returns the two oldest due rows, not a held row (`send_after` in the future), and sets their `send_after` about an hour ahead. A second call does not return them.
    - As a1 (`authenticated`), `claim_due_emails()` throws `42501`.
    - On a `reminder` row for A1:
      - `record_email_result(id)` with no reason deletes it and writes no event.
      - With `failures = 1`, a success deletes it and writes `email_sent_late` with `{"email": "reminder", "to": "contact-a1@test.local"}` and a null `actor_id`.
    - `record_email_result(id, 'daily sending limit reached', true)` sets `failures = 1`, keeps the row, and logs `email_failed` with `outcome = retrying`. At `failures = 3`, the same call deletes the row and logs `gave_up`.
    - `record_email_result(id, '550 5.1.1 unknown', false)` deletes it and logs `failed`. A 300-character reason is stored cut to 200.
    - As b1 and as c1, a call changes nothing. As a1, a call on a firm A row works and logs with a null actor.
    - A `staff_digest` row's failure writes no event.
  - `lib/activity.test.ts`, with the lines from spec §6:
    - `describeEvent("email_failed", { email: "reminder", to: "maria@example.com", reason: "daily sending limit reached", outcome: "retrying" }, "")` is `"couldn't send the reminder to maria@example.com (daily sending limit reached). Trying again tomorrow."`;
    - `gave_up` on `request_sent` gives `"gave up on the request email to maria@example.com after 3 days (daily sending limit reached)."`;
    - `failed` on `needs_changes` with item "Photo ID" gives `"couldn't send the changes-needed email for “Photo ID” to maria@example.com (550 5.1.1 unknown). It won't be tried again."`;
    - `email_sent_late` on `reminder` gives `"sent the reminder to maria@example.com after an earlier failure."`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test:db`, `npx vitest run lib/activity.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the migration**
  - Replace `request_events_kind_check` with the same list plus `email_failed` and `email_sent_late`.
  - `claim_due_emails`: `security definer`; `update ... set send_after = now() + interval '1 hour' where id in (select id ... where send_after <= now() order by id limit max_rows for update skip locked) returning *`. Revoke from `public, anon, authenticated`; grant to `service_role`.
  - `record_email_result`: `security definer`, following spec §5.4. Lock the row. Return quietly when it is missing, or when `auth.uid()` is not null and `not public.is_firm_member(firm_id)`. Apply the sent, retrying, gave-up, and failed branches. For rows with a `request_id`, insert the event straight into `request_events` with `actor_id` null, when the request is not a draft. Revoke from `public, anon`.

- [ ] **Step 4: Implement the Activity lines** in `describeEvent`, with a label helper: `request_sent` is "the request email", `needs_changes` is `the changes-needed email for ${quoted(item)}`, and `reminder` is "the reminder".

- [ ] **Step 5: Apply, regenerate, and test**

Run: `npx supabase migration up --local`, `npm run db:types`, `npm run test:db`, `npx vitest run lib/activity.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase lib/database.types.ts lib/activity.ts lib/activity.test.ts
git commit -m "feat: claim outbox rows, record outcomes, and log failures in Activity"
```

---

### Task 4: Actions queue first and record what they send

**Files:**
- Create: `lib/email/deliver.ts`
- Modify: `app/app/requests/actions.ts` (`sendRequest`, `returnItem`, `sendReminder`, `sendToClients`), `app/app/settings/actions.ts` (`addStaff`)

**Interfaces:**
- Consumes: Task 2's queue functions; Task 3's `record_email_result`; Task 1's `results`.
- Produces: `deliver(supabase: SupabaseClient<Database>, messages: (EmailMessage & { emailId: number })[]): Promise<void>`. It sends them, then calls `record_email_result` for each outcome, logging (never throwing) a recording error.

- [ ] **Step 1: Run the existing browser suites as the baseline**

Run: `npx playwright test e2e/happy-path.spec.ts e2e/staff-workflows.spec.ts e2e/portal-and-review.spec.ts e2e/firm-tools.spec.ts`
Expected: PASS before the change. They send every kind of action email.

- [ ] **Step 2: Implement**
  - `deliver` in `lib/email/deliver.ts` (`server-only`).
  - Each action builds its content before changing anything, as today. It queues through its function in place of reading `client_contacts` for recipients, then makes its guarded change, then calls `after(() => deliver(supabase, queued.map(...)))`. Messages go to the queued recipients, with the existing `fromName` and `replyTo`.
    - `sendRequest` calls `queue_request_emails('request_sent', requestId)` before its update. The toast's contact count is the number of queued rows.
    - `returnItem` calls `queue_request_emails('needs_changes', requestId, itemId)` before its update. It selects `request_id` first, as it does today.
    - `sendReminder` calls `claim_reminder`. No rows means "A reminder already went out today.". The contacts check before it stays.
    - `sendToClients` uses `send_requests`' rows, mapping each `request_id` to its prebuilt content.
    - `addStaff` calls `queue_staff_added(userId)` after `ensureUser` and before the insert. `fail(error, { "23505": "This person already belongs to a firm." })` covers both.
  - Remove the `after(() => sendEmails(...))` calls these replace.

- [ ] **Step 3: Run the suites again**

Run: the same Playwright command, then `npm run typecheck`, `npm run lint`
Expected: PASS. Log mode records every send as a success, so as postgres `select count(*) from public.email_outbox where failures > 0` is 0.

- [ ] **Step 4: Commit**

```bash
git add lib/email/deliver.ts app/app/requests/actions.ts app/app/settings/actions.ts
git commit -m "feat: queue action emails before changes and record each send"
```

---

### Task 5: The daily job sends through the outbox

**Files:**
- Create: `lib/email/outbox.ts`
- Modify: `lib/daily-jobs.ts`, `app/api/cron/daily/route.ts`
- Create: `integration/outbox.test.ts`
- Modify: `integration/daily-jobs.test.ts`
- Modify: `README.md`, `docs/superpowers/specs/2026-09-24-client-portal-design.md` (§7.2, §8.2, §8.3, §11.1, §11.2, §18), `docs/superpowers/specs/2026-09-25-paperline-backlog-design.md` (§4.2)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `renderQueued(admin: SupabaseClient<Database>, rows: OutboxRow[], now: Date): Promise<(EmailMessage | null)[]>`, where null means the row no longer applies;
  - `sendDueEmails(admin, now): Promise<OutboxSummary>`, with `OutboxSummary = { sent: number; retrying: number; gaveUp: number; dropped: number }`;
  - `DailySummary = { firms: number; failedFirms: number; reminders: number; digests: number; outbox: OutboxSummary; outboxFailed: boolean }`.

- [ ] **Step 1: Write the failing integration tests** `integration/outbox.test.ts`. Mock `sendEmails` with a queue of scripted `results`. Stand in for "the next day" by setting a row's `send_after` into the past, since claims use the database's clock.
  1. A reminder row for an open request is sent by `runDailyJobs` and deleted. `summary.outbox.sent` is 1.
  2. A scripted `{ ok: false, reason: "daily sending limit reached", retry: true }` keeps the row with `failures = 1`, and logs `email_failed` with `retrying`.
  3. After three more scripted failures, one per run, the row is deleted and `gave_up` is logged. `summary.outbox.gaveUp` is 1.
  4. A `request_sent` row held an hour ago and never attempted (`send_after` in the past) is sent, with the request's current title and message.
  5. A row for an archived request, and one for a draft, are deleted unsent. `dropped` is 2.
  6. With a reminder row already retrying for contact X, a run on a reminder day for that request sends X exactly one reminder.
  7. Two concurrent `claim_due_emails(1000)` calls return disjoint id sets.
  Update `integration/daily-jobs.test.ts`: its `sendEmails` mock returns `results`, and its summary assertions use `outbox`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test:integration`
Expected: FAIL.

- [ ] **Step 3: Implement**
  - `lib/daily-jobs.ts`:
    - `reminders()` and `digests()` stop building content. A reminder needs the request id, its contacts' emails, and `created_by`. A digest needs the member's email and the window `(start, now]`, and is skipped when no item was submitted in it.
    - After `claim()`, `claimFirm` upserts the outbox rows (`onConflict: "kind,recipient,request_id,item_id,window_end"`, with `failures: 0` and `send_after: now`). A failure there fails the firm.
    - `runDailyJobs` then calls `sendDueEmails`. Remove the `claim()` comment about lost emails.
  - `lib/email/outbox.ts`:
    - `renderQueued` applies spec §5.3's table per kind, reading each batch's requests, firms, and members in a few `.in(...)` queries. It uses the existing templates, with the request's `message` for `request_sent`, plan 1's `unavailable` flag for digests, "An admin" for a departed admin, and no reply-to for a departed member.
    - `sendDueEmails` loops: `claim_due_emails(100)`, render, delete the nulls (counted in `dropped`), send, record each outcome, and count, until a claim returns nothing. A database error stops the loop and sets `outboxFailed`.
  - `route.ts`: `ok = failedFirms === 0 && !outboxFailed && outbox.retrying === 0 && outbox.gaveUp === 0`. The log line is `{ job: "daily", ...summary }`.

- [ ] **Step 4: Run the tests**

Run: `npm run test:integration`, `npm test`, `npm run typecheck`, `npm run lint`
Expected: PASS.

- [ ] **Step 5: Docs**, as spec §10 lists:
  - v1 spec: add `email_outbox` to §7.2, its access to §8.2, and the functions to §8.3. Describe the outbox in §11.1 and §11.2. Remove the §18 ceiling.
  - Backlog spec §4.2: add the two event kinds.
  - README: failed emails are tried again and shown in Activity.

- [ ] **Step 6: Commit**

```bash
git add lib app/api/cron/daily/route.ts integration README.md docs/superpowers/specs
git commit -m "feat: send reminders, digests, and retries through the outbox"
```

---

## Finish

Run every suite once: `npm run test:db`, `npm test`, `npm run test:integration`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e`. Then check `git status` for a clean tree.

Staging: both migrations must reach staging before the code, or every action that sends email fails.
