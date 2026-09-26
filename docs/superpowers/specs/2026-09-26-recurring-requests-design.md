# Recurring Requests: Design Spec

- **Date:** 2026-09-26
- **Status:** Design approved in conversation, section by section, on 2026-09-26
- **Builds on:** [`2026-09-24-client-portal-design.md`](2026-09-24-client-portal-design.md) (the v1 spec: templates, bulk send, and the daily cron in §11.2) and [`2026-09-26-email-outbox-design.md`](2026-09-26-email-outbox-design.md) (the email outbox, which must be built first)

## 1. Summary

Bookkeeping clients need the same checklist every month or quarter: bank statements, receipts, sales invoices. Today staff must remember to send it each time. With this feature, staff set up a schedule once, for example "send the Monthly bookkeeping template to these 12 clients on the 1st of every month, due 14 days later", and the daily job creates and sends each client's request on its day.

Each scheduled request is an ordinary request: reminders, review, Activity, and archiving work as they do now.

### Success criteria

- Staff create a schedule from a template, with its clients, repeat, first send date, and days until due, and can later edit, pause, resume, or delete it.
- On each send day, every client on the schedule who can receive requests gets their own request, titled with the period just ended, and its contacts get the usual email.
- A schedule sends at most once per period, even if the daily job runs twice, and a send missed while the job was down goes out on the next run.

## 2. Decisions

| Topic | Decision |
|---|---|
| Scope of a schedule | One template and up to 100 clients, like bulk send |
| Repeat | Monthly, quarterly, or yearly (every 1, 3, or 12 months), on the first send date's day of the month. The 29th to 31st fall back to a shorter month's last day. |
| Due date | A number of days after the day the request is sent (1 to 365) |
| Title | The schedule's title plus the period just ended. For a send on Oct 1, 2026: "– September 2026", "– Q3 2026", or "– 2025". |
| Mechanism | The daily job sends due schedules through one database function per schedule. Nobody confirms each send. |
| Items | The template's current items at send time, so template edits apply to the next send |
| Who | Any staff member, as with bulk send |
| Emails | Queued in the email outbox, and sent by the same daily run |

## 3. Data

### 3.1 Tables

```
schedules
  id              uuid primary key default gen_random_uuid()
  firm_id         uuid not null
  template_id     uuid not null
  title           text not null check (char_length(title) between 1 and 180)
  every_months    smallint not null check (every_months in (1, 3, 12))
  day_of_month    smallint not null check (day_of_month between 1 and 31)
  next_send_on    date not null
  due_after_days  smallint not null check (due_after_days between 1 and 365)
  paused          boolean not null default false
  created_by      uuid default auth.uid() references auth.users (id) on delete set null
  last_sent_on    date
  created_at      timestamptz not null default now()
  unique (id, firm_id)
  foreign key (template_id, firm_id) references templates (id, firm_id) on delete cascade

schedule_clients
  schedule_id  uuid not null
  client_id    uuid not null
  firm_id      uuid not null
  primary key (schedule_id, client_id)
  foreign key (schedule_id, firm_id) references schedules (id, firm_id) on delete cascade
  foreign key (client_id, firm_id) references clients (id, firm_id) on delete cascade
```

- The title allows 180 characters so that the period label always fits within a request title's 200.
- `day_of_month` is the day of the date staff pick for the next send, kept so that a schedule on the 31st returns to the 31st after February.
- Deleting a template deletes its schedules. Deleting a client removes it from schedules. Requests a schedule already sent are never touched.
- Indexes cover the foreign keys.

### 3.2 Rules

RLS is enabled on both tables. Contacts and `anon` get no access.

| Table | Select, insert, update, delete allowed when |
|---|---|
| `schedules` | `is_firm_member(firm_id)`; an insert also needs `created_by = (select auth.uid())` |
| `schedule_clients` | `is_firm_member(firm_id)`; no updates |

- `update` on `schedules` is revoked from `authenticated` and granted on `(title, every_months, day_of_month, next_send_on, due_after_days, paused)` only. A schedule cannot move to another firm or template, and staff cannot set `created_by` or `last_sent_on`.
- The 100-client limit is checked by the Server Action, as for bulk send.

### 3.3 Functions

Each sets `set search_path = ''`.

- **`next_schedule_date(from_date date, every_months int, day_of_month int, after date) returns date`**, immutable: the first date after `after` in the series that starts at `from_date` and steps `every_months` months, each on `day_of_month` or the month's last day if shorter. It returns `from_date` itself when that is already after `after`.
- **`save_schedule(schedule_id, template_id, title, every_months, next_send_on, due_after_days, client_ids)`**, security invoker so RLS applies, like `save_draft`. It creates a schedule, or updates one, and replaces its client list in one transaction, and returns the id. On an update, `template_id` is ignored and a null `next_send_on` keeps the current date. A new `next_send_on` also sets `day_of_month`.
- **`set_schedule_paused(schedule_id, paused)`**, security invoker. Pausing sets `paused`. Resuming also moves a `next_send_on` of today or earlier to `next_schedule_date(next_send_on, every_months, day_of_month, today)`, so periods missed while paused are not sent. "Today" is the date in the firm's time zone. Returns the id, or null when nothing changed.
- **`send_scheduled_requests(schedule_id, today date) returns integer`**, security definer, for the service role only: see §4.

## 4. Daily send

For each firm, after its reminders and digests, the daily job reads the firm's schedules that are not paused and have `next_send_on` on or before today in the firm's time zone, and calls `send_scheduled_requests` for each. In one transaction the function:

1. Locks the schedule with `for update` and returns 0 if it is now paused or not yet due. A second run on the same day therefore waits, then finds it no longer due.
2. Returns 0, leaving the schedule due, if the template has no required item. The schedule goes out on the first run after someone fixes the template.
3. Takes the schedule's clients that are not archived and have at least one contact. The others are skipped for this period only.
4. For each of those clients, as `send_requests` does:
   - inserts a draft request titled `{title} – {period}`, due `today + due_after_days`, with `created_by` from the schedule;
   - copies the template's items, in order;
   - queues one `request_sent` email per contact in the outbox, due at once, with the schedule's creator as reply-to;
   - opens the request (`status = 'open'`, `sent_at = now()`), so the timeline records one `sent` event with no actor, shown as "PaperLine".
5. Sets `next_send_on` to `next_schedule_date(next_send_on, every_months, day_of_month, today)`, so a send missed while the job was down goes out once and the schedule then jumps to its next future date, and sets `last_sent_on` to today when it created at least one request.
6. Returns the number of requests created.

The period comes from the scheduled date (`next_send_on`), not the day it is sent, so a late send keeps its label:

| Repeat | Period just ended | Example for a send on Oct 1, 2026 |
|---|---|---|
| Monthly | The month before the scheduled date's month | "September 2026" |
| Quarterly | The calendar quarter before the scheduled date's quarter | "Q3 2026" |
| Yearly | The year before the scheduled date's year | "2025" |

The run's outbox pass then sends the queued emails. A request sent today gets no reminder today, as `reminderDue` already rules. The daily log line gains `"scheduled":n`, the number of requests created.

## 5. Screens

### 5.1 Template page

A "Send on a schedule" button, next to "Send to clients", opens `/app/templates/[id]/schedule`.

Deleting a template that has schedules adds to its confirmation: "Its {n} schedules will be deleted too."

### 5.2 Schedule form

The same form creates and edits a schedule, laid out like bulk send:

- **Title:** starts as the template's name; 180 characters at most.
- **Repeat:** Monthly, Quarterly, or Yearly.
- **First send date** (on edit, **Next send date**): a date after today, with the hint "Sent with the daily emails on this date. To send today as well, use Send to clients."
- **Due after:** a number of days, 14 by default.
- **Clients:** the bulk send picker, up to 100. On edit it also lists the schedule's clients that would be skipped, marked "Archived" or "No contacts", so staff can remove them.
- A hint "About {n} emails each time", counting the contacts of the chosen clients who would receive the request.
- "Create schedule" or "Save".

### 5.3 Schedules page: `/app/schedules`

A "Schedules" item joins the sidebar between Templates and Settings. The page lists every schedule, by title:

| Column | Shows |
|---|---|
| Title | A link to the schedule's page |
| Template | The template's name |
| Clients | How many |
| Repeats | "Monthly on the 1st", "Quarterly on the 5th", or "Yearly on Jan 15" |
| Next send | "Paused" when paused; otherwise "Late since {date}" when the date has passed, or else the date |
| Last sent | The date, or "Never" |

With none, it says "No schedules yet. Start one from a template's page."

### 5.4 Schedule page: `/app/schedules/[id]`

- The form of §5.2, for editing.
- "Pause" or "Resume".
- "Delete", which asks "Delete this schedule? Requests it already sent stay." in an AlertDialog, then returns to the Schedules page.
- When the template has no required item: "{template} has no required item, so nothing is sent until it has one." with a link to the template.

## 6. Server Actions

`saveSchedule(input)`, `setSchedulePaused(scheduleId, paused)`, and `deleteSchedule(scheduleId)`:

1. Call `requireStaff()` and validate with zod: the ids with `isId`; the title with the `text()` helper and 180 characters; the repeat as 1, 3, or 12; the next send date, when given, as a date after today in the firm's time zone; the days until due from 1 to 365; and 1 to 100 distinct client ids. The form sends the next send date on edit only when staff changed it.
2. Write through the user-scoped client, so RLS decides: `save_schedule`, `set_schedule_paused`, or a delete returning the id.
3. Revalidate `/app/schedules` and the schedule's page.

## 7. Errors

- A validation error shows as a toast, and the form keeps what was typed.
- Saving, pausing, or deleting a schedule that is gone returns the existing `invalid_state` message: "This has changed since the page loaded. Refresh and try again."
- Database errors map through `lib/errors.ts`; a client of another firm fails its foreign key and shows the `not_allowed` message.
- In the daily job, a schedule that fails to send fails that firm: it is logged, and the run answers 500. Each schedule is its own transaction, so the firm's earlier schedules, reminders, and digests stand.

## 8. Tests

- **pgTAP**, in a new file:
  - Staff of the firm read and manage schedules and their clients; another firm's staff, contacts, and `anon` get nothing. Only the granted columns can change.
  - `save_schedule` creates and edits a schedule with its client list and sets `day_of_month` from a new date.
  - `next_schedule_date`: monthly on the 31st gives the last day of February, then March 31; quarterly and yearly steps; the first date after a given day.
  - `send_scheduled_requests`, for the service role only:
    - creates one open request per eligible client, with the template's items in order, the period in the title for each repeat, the due date, and the schedule's creator;
    - skips archived clients and clients without contacts;
    - queues the emails and records one `sent` event per request with no actor;
    - moves `next_send_on` past today, after missed days too, and sets `last_sent_on`;
    - creates nothing on a second call the same day, for a paused schedule, or for one not yet due;
    - creates nothing and leaves the schedule due when the template has no required item.
  - `set_schedule_paused`: resuming a schedule whose date has passed moves it after today.
  - Deleting a template deletes its schedules; deleting a client removes it from them.
- **Unit:** the Repeats text, including ordinals (1st, 2nd, 3rd, 11th, 21st, 22nd, 31st).
- **Integration, against local Supabase:** the daily job sends a due schedule and the outbox sends its emails; a second run the same day sends nothing more.
- **Browser:** staff create a schedule from a template for two clients; it appears on the Schedules page with its next send date; they pause it (it shows "Paused"), resume it, change its title, and delete it.

## 9. Other changes

- Regenerate `lib/database.types.ts` after the migration.
- v1 spec: add both tables to §7.2, their policies to §8.2, and the functions to §8.3; add scheduled sends to §11.2.
- README: mention schedules in the feature description.

## 10. Out of scope

- Weekly schedules.
- "Send now" for a schedule; Send to clients already does that.
- End dates.
- A personal message on scheduled requests.
- Listing a client's schedules on the client page.
- Changing a schedule's template; a new schedule does that.
