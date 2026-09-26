# Email Outbox and Delivery Status: Design Spec

- **Date:** 2026-09-26
- **Status:** Design approved in conversation, section by section, on 2026-09-26. Section 1 was then revised so rows hold references instead of email content.
- **Builds on:** [`2026-09-24-client-portal-design.md`](2026-09-24-client-portal-design.md) (the v1 spec: email and daily jobs in §11, known ceilings in §18) and [`2026-09-25-paperline-backlog-design.md`](2026-09-25-paperline-backlog-design.md) (the backlog spec: the Activity timeline in §4)

## 1. Summary

Today an email that fails is lost. `sendEmails` tries it up to 3 times within seconds, then logs the failure. A day over Gmail's sending limit, a network outage, or a daily run cut off at its 300-second limit means a client never gets their request, reminder, or changes-needed email, and nobody on staff knows.

With this change, every app email is recorded in an outbox before it is sent, and deleted once it is sent. An email that fails is tried again in the next daily runs. Staff see failures in the request's Activity section, for example "PaperLine couldn't send the reminder to maria@example.com (daily sending limit reached). Trying again tomorrow."

### Success criteria

- An email that fails for a passing reason, such as the daily limit or a network problem, goes out in a later daily run, rebuilt from current data.
- An email lost because a run or a background send stopped part-way goes out in the next daily run.
- Staff see each failure, late send, and give-up of a request's emails in its Activity section.
- No email content is stored, and staff can cause only the emails the app already sends.

## 2. Decisions

| Topic | Decision |
|---|---|
| What is recorded | Every app email, before it is sent. Sign-in codes are sent by Supabase and are not included. |
| What a row holds | References only: the kind, the firm, the request or item, the recipient, the staff member replies go to, and a digest's time window. Never the text. |
| Retries | In up to 3 daily runs after the first attempt. Then PaperLine gives up. |
| Where staff see failures | The request's Activity section. Failures of digest and staff-added emails appear only in the logs. |
| When a row goes | It is deleted once the email is sent, given up, or no longer applies. |
| Delivery | At least once. An email whose outcome was not recorded is sent again, so a rare duplicate is possible, but no email is silently lost. |

## 3. Data

### 3.1 Table

```
email_outbox
  id            bigint generated always as identity primary key
  firm_id       uuid not null references firms (id) on delete cascade
  kind          text not null check (kind in ('request_sent', 'needs_changes', 'reminder', 'staff_added', 'staff_digest'))
  recipient     text not null
  request_id    uuid                   -- request_sent, needs_changes, reminder
  item_id       uuid                   -- needs_changes
  reply_to_id   uuid                   -- the staff member replies go to; no foreign key, since they may leave
  window_start  timestamptz            -- staff_digest
  window_end    timestamptz            -- staff_digest
  failures      smallint not null default 0
  send_after    timestamptz not null   -- held or leased until then
  created_at    timestamptz not null default now()
  foreign key (request_id, firm_id) references requests (id, firm_id) on delete cascade
  foreign key (item_id, firm_id) references request_items (id, firm_id) on delete cascade
  unique nulls not distinct (kind, recipient, request_id, item_id, window_end)
```

- A check ties the references to the kind: a request for the three request emails, an item for `needs_changes` only, and both window bounds for `staff_digest` only.
- The unique key allows at most one waiting email of each kind to each recipient about the same request or item. Queuing another replaces the waiting one: its failures go back to 0, and its firm, reply-to, and `send_after` are set anew. A staff-added email therefore follows someone re-added to another firm. Digests never collide, since each has its own window.
- Indexes cover the foreign keys.
- Deleting a firm, a request, or an item removes its waiting emails.

### 3.2 Access

- RLS is enabled with no policies, and every privilege is revoked from `anon` and `authenticated`, as for `notifications_sent`. Staff and contacts can neither read nor write the table. The service role can.
- Staff reach it only through the functions in §4 and §5, which are `security definer` with `set search_path = ''`.

## 4. Queuing

### 4.1 Who queues what

| Email | Queued by | Recipients | Reply-to |
|---|---|---|---|
| `request_sent` | Send (`queue_request_emails`) and bulk send (`send_requests`) | Every contact of the client | The sender |
| `needs_changes` | Return (`queue_request_emails`) | Every contact of the client | The reviewer |
| `reminder` | Send reminder (`claim_reminder`) and the daily job | Every contact of the client | The staff member; for the daily job, the request's creator |
| `staff_added` | Add staff (`queue_staff_added`) | The new member | The admin |
| `staff_digest` | The daily job | The member | None |

The database picks the recipients; callers never pass an address.

### 4.2 Before anything changes

Actions queue their emails before they change anything, so a failure to queue fails the action with nothing changed. Rows queued by an action are held for an hour.

- **`queue_request_emails(kind, request_id, item_id default null)`** returns `table (email_id bigint, recipient text)`, one row per contact of the request's client.
  - The caller must be staff of the request's firm; otherwise it raises `not_allowed`.
  - The kind must be `request_sent`, for a draft request, or `needs_changes`, for an item of the request that is `submitted` or `accepted` while the request is `open` or `completed`. Otherwise it raises `invalid_state`.
- **`queue_staff_added(user_id)`** returns the row's id.
  - The caller must be an admin. The recipient is the user's sign-in email.
  - A user who already belongs to a firm is refused with the unique-violation code `23505`, so Add staff keeps its message "This person already belongs to a firm."
- **`send_requests` and `claim_reminder`** already change state inside the database, so they queue in the same transaction:
  - `send_requests` queues each new request's emails while the requests are still drafts, then opens them. It now returns `table (email_id bigint, request_id uuid, recipient text)`.
  - `claim_reminder` queues one reminder per contact after it wins the day's claim. It now returns `table (email_id bigint, recipient text)`. No rows means today's reminder already went out.
  - Each is dropped and created again, followed by its `revoke` statements, because `create or replace` cannot change a return type.

If the change then fails, for example because another staff member sent the request first, the queued emails no longer apply, and the daily run deletes them unsent (§5.3).

`queue_request_emails` does not take the `reminder` kind, so a direct call cannot get past the one reminder a day that `claim_reminder` allows.

### 4.3 Daily job

For each firm, after it wins its claims in `notifications_sent` as today, the daily job inserts one row per contact for each reminder and one row per member for each digest, with the digest's window in `window_start` and `window_end`. These rows are due at once. The job upserts on the unique key, so a reminder still waiting from an earlier run is replaced instead of sent twice.

## 5. Sending

### 5.1 First attempt

- An action sends its emails in `after()`, as today, with the content it built before changing anything: one message per queued row, to that row's recipient. It then records each outcome with `record_email_result` through the user-scoped client. A Server Action's `after()` callback can still read the request's cookies.
- The one-hour hold keeps the daily job away from these rows meanwhile. If the background send stops before recording, the row waits out its hold and the next daily run sends it.

### 5.2 Daily run

After queuing, the daily job sends everything due:

1. `claim_due_emails(max_rows default 100)` returns the due rows (`send_after <= now()`), oldest first, with `for update skip locked`, and moves their `send_after` an hour ahead. Two runs never claim the same row, and one run never claims a row twice. Only the service role can call it.
2. The job rebuilds each email from current data (§5.3), deletes the ones that no longer apply, sends the rest with `sendEmails`, and records each outcome.
3. It repeats until a claim returns nothing.

Emails a run leaves unsent when it is cut off keep their lease and go out in the next run.

### 5.3 Rebuilding

Each email is rebuilt with the template and inputs the action uses, so a retried reminder lists today's open items. An email is sent only while it still applies, and is otherwise deleted unsent:

| Email | Sent only while |
|---|---|
| `request_sent` | The request is `open`, and the recipient is a contact of its client. |
| `needs_changes` | The item is `needs_changes`, the request is `open`, and the recipient is a contact. The note is the item's current `review_note`. |
| `reminder` | The request is `open`, its client is not archived, it has an item in `requested` or `needs_changes`, and the recipient is a contact. |
| `staff_added` | The recipient is a member of the row's firm. The email names the admin who added them, or says "An admin" if that admin has left. |
| `staff_digest` | The recipient is a member of the row's firm, and items were submitted in the window. |

The reply-to is the email of the `reply_to_id` member, or none if they have left the firm.

### 5.4 Outcomes

`sendEmails` keeps its quick retries within a call and now also returns an outcome per message: sent, or failed with a short reason and whether a later run can succeed.

`record_email_result(email_id bigint, reason text default null, retry boolean default false)` applies an outcome. The service role may record any row; staff may record only rows of their own firm. A row that no longer exists is ignored.

- **Sent** (`reason` is null): deletes the row.
- **Failed, with `retry` true and fewer than 4 failures counting this one:** adds 1 to `failures` and keeps the row until at least an hour from now, so the next daily run tries it again.
- **Failed otherwise:** deletes the row. PaperLine gives up after the fourth failure, which is the first attempt plus 3 daily runs, and at once after a permanent failure.

The function cuts the reason to 200 characters.

| Failure | Short reason | Tried again |
|---|---|---|
| Gmail's daily limit (an SMTP reply with status 5.4.5), or Resend's `daily_quota_exceeded` | "daily sending limit reached" | Yes |
| No reply: the connection was refused, timed out, or dropped | "connection problem" | Yes |
| Email is not set up (`emailConfigError`) | "email is not set up" | Yes |
| A 4xx SMTP reply, a failed login, or a Resend rate limit, server error, or key error | The server's reply | Yes |
| Any other SMTP reply of 500 or more, such as an unknown address; an envelope error; or Resend rejecting the message | The server's reply | No |

Gmail's limit reply is a 5xx, but it passes once the limit resets, so it is tried again. A failed login is tried again because fixing the app password makes it pass.

## 6. Activity

`record_email_result` writes two new event kinds for the three request emails. They have no actor, so they show as "PaperLine". Events for `needs_changes` carry the item.

| Kind | Written when | Detail |
|---|---|---|
| `email_failed` | A send fails | `email` (the kind), `to`, `reason`, and `outcome`: `retrying`, `gave_up` (out of tries), or `failed` (permanent) |
| `email_sent_late` | An email is sent after an earlier failure | `email`, `to` |

`request_events.kind` allows the two new kinds, and `lib/activity.ts` describes them. The emails are called "the request email", "the changes-needed email for {item}", and "the reminder":

- "PaperLine couldn't send the reminder to maria@example.com (daily sending limit reached). Trying again tomorrow."
- "PaperLine gave up on the request email to maria@example.com after 3 days (daily sending limit reached)."
- "PaperLine couldn't send the changes-needed email for “Photo ID” to maria@example.com (550 5.1.1 The email account that you tried to reach does not exist). It won't be tried again."
- "PaperLine sent the reminder to maria@example.com after an earlier failure."

## 7. Daily log

- The run's log line replaces `sent` and `failed` with this run's `"outbox":{"sent":n,"retrying":n,"gaveUp":n,"dropped":n}`. `gaveUp` includes permanent failures. `dropped` counts emails deleted because they no longer apply.
- The run answers 500, which marks it as failed in Vercel's cron logs, when a firm failed, when any email failed, or when the outbox itself failed (§8).
- The comment on `claim()` in `lib/daily-jobs.ts` about lost emails goes, since the outbox resolves it.

## 8. Errors

- **Queuing fails in an action:** the action returns the mapped error through `lib/errors.ts`, and nothing has changed.
- **Queuing fails in the daily job:** that firm fails and is logged, as a read error does today.
- **The outbox fails in the daily run** (claiming, rebuilding, or recording): the run stops sending, logs the error, and answers 500. Claimed rows keep their lease and go out in the next run.
- **Recording fails after an action's send:** it is logged. The row keeps its hold, so the next daily run sends the email again: a possible duplicate, never a loss.
- **Email is not set up:** the daily job still refuses to run, so waiting emails use none of their tries until it is fixed.

## 9. Tests

- **pgTAP**, in a new file:
  - `anon` and `authenticated` can neither read nor write `email_outbox`.
  - `queue_request_emails` queues one held row per contact for the firm's staff. It refuses another firm's staff, contacts, a request that is not a draft, an item that is not submitted or accepted, and the `reminder` kind.
  - Queuing again replaces the waiting row: the same id, with failures back to 0.
  - `send_requests` and `claim_reminder` queue their emails, and `claim_reminder` queues nothing the second time in a day. Their existing tests follow the new return types.
  - `queue_staff_added` works for admins only and refuses someone already in a firm.
  - Only the service role can call `claim_due_emails`. It returns due rows oldest first, skips held and leased rows, and leases what it returns for an hour.
  - `record_email_result`: a send deletes the row, and logs `email_sent_late` after an earlier failure; a retryable failure keeps the row and logs `retrying`; the fourth failure deletes it and logs `gave_up`; a permanent failure deletes it and logs `failed`; staff of another firm and contacts change nothing; the events have no actor.
  - Deleting a request removes its waiting emails.
- **Unit:**
  - `sendEmails` reports each message's outcome. Over SMTP: sent, an unknown address, the daily limit, and a dropped connection. Through Resend: an address rejected within a batch, and a rate limit.
  - The short reason and retry decision for each kind of failure.
  - The Activity lines for the new events.
- **Integration, against local Supabase**, with the sender stubbed:
  - A waiting email is sent by the daily job and deleted.
  - A retryable failure is logged and waits for the next run.
  - The failure in the third daily run gives up, logs it, and deletes the row.
  - An email never attempted is sent once its hold has passed.
  - An email for an archived request is deleted unsent.
  - A reminder queued while one waits for the same contact goes out once.
  - Two claims at once never return the same row.
  - The existing daily-job tests follow the new summary.
- **Browser:** none. Browser tests cannot make a mail server fail. Their emails are logged instead of sent, and still pass through the outbox.

## 10. Other changes

- Regenerate `lib/database.types.ts` after the migration.
- v1 spec: add `email_outbox` to §7.2, its access to §8.2, and the functions to §8.3. Describe the outbox in §11.1 and §11.2, in place of "A failed send is logged and never shown to the user" and "A failed send is logged and its claim stays in place". Remove the §18 ceiling about lost emails.
- Backlog spec §4.2: add the two event kinds.
- README: mention that failed emails are tried again and shown in Activity.

## 11. Out of scope

- Sign-in codes, which Supabase sends.
- A "send again now" button, and a dashboard notice of waiting emails.
- Showing digest or staff-added failures anywhere but the logs.
- Bounces that arrive later by email. The outbox knows only what the mail server answered at the time of sending.
