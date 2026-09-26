# Recurring Requests: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff schedule a template to go to a list of clients monthly, quarterly, or yearly, and the daily job creates and sends each request on its day.

**Architecture:** Two tables under RLS, `schedules` and `schedule_clients`. Three staff functions: `next_schedule_date`, `save_schedule`, and `set_schedule_paused`. One service-role function, `send_scheduled_requests`, which in one transaction creates a due schedule's requests, queues their emails in the outbox, and moves the schedule forward. The daily job calls it per due schedule, and the outbox pass of the same run sends the emails. Staff manage schedules from a new Schedules page.

**Tech Stack:** Next.js 16 (App Router, Cache Components), Supabase (Postgres, RLS, pgTAP), zod 4, Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-26-recurring-requests-design.md`](../specs/2026-09-26-recurring-requests-design.md)

**Build order:** 10 of 12, after [the email outbox](2026-09-26-email-outbox.md), which it requires: it queues `request_sent` rows and relies on the daily run's outbox pass. Next: [photos into one PDF](2026-09-26-scan-pages.md).

**Commands:** as in the backlog plan's [How to run things](2026-09-25-paperline-backlog.md#how-to-run-things-windows).

**Execution:** Native, chosen by the user on 2026-09-26. One session implements this plan's tasks in order (superpowers:executing-plans), then one fresh reviewer checks this plan's diff before the next plan starts. Start only when the user says so.

## Global Constraints

- A schedule holds one template and 1 to 100 clients. It repeats every 1, 3, or 12 months on `day_of_month`; the 29th to the 31st fall back to a shorter month's last day. It is due `due_after_days` (1 to 365) after the day it is sent.
- A request's title is `{title} – {period}`, with an en dash between spaces. The period is taken from `next_send_on`: the month before (`FMMonth YYYY`), the calendar quarter before (`Q3 2026`), or the year before (`2025`). A schedule's title is at most 180 characters.
- A schedule sends at most once per scheduled date. Missed dates are sent once, late, and then it jumps past today. Paused schedules send nothing. Resuming skips the dates missed while paused.
- A template with no required item sends nothing and leaves the schedule due.
- Scheduled requests are created by the schedule's creator (`created_by`), whose address gets replies. They are sent with no actor, so Activity shows "PaperLine", and they carry no personal message.
- Copy, verbatim:
  - The form: "Send on a schedule"; "Title"; "Repeat" (Monthly, Quarterly, Yearly); "First send date" (on edit, "Next send date"); the hint "Sent with the daily emails on this date. To send today as well, use Send to clients."; "Due after" (days); "About {n} emails each time"; "Create schedule" and "Save".
  - The list: "Schedules"; "No schedules yet. Start one from a template's page."; "Paused"; "Late since {date}"; "Never".
  - The schedule page: "Pause", "Resume", "Delete"; the dialog "Delete this schedule? Requests it already sent stay."; the warning "{template} has no required item, so nothing is sent until it has one."; the badges "Archived" and "No contacts".
  - The template delete dialog: "Its {n} schedules will be deleted too."
- Add new migrations only; run `npm run db:types` after each. One Conventional Commit per task, with no AI attribution lines. Do not push.

## Review Focus

1. **A monthly schedule on the 31st** goes out Feb 28 (or 29), then Mar 31, not the 28th forever. Pinned in Task 1 (pgTAP `next_schedule_date`).
2. **The daily job run twice on one day** (a manual rerun) sends each due schedule once. Pinned in Task 2 (pgTAP) and Task 3 (integration).
3. **A schedule missed for three months while the job was down** sends once, then its next date is in the future. Pinned in Task 2 (pgTAP).
4. **A client archived after the schedule was set up** is skipped for that period, and the others still get theirs. Pinned in Task 2 (pgTAP).
5. **Editing a schedule without touching its date**, when the date has already passed (a late schedule), keeps the date instead of failing "after today". Pinned in Task 4 (unit test on the schema: a missing `nextSendOn` is valid).

---

### Task 1: Schedules, their rules, and the staff functions

**Files:**
- Create: `supabase/migrations/20260926001000_schedules.sql`
- Create: `supabase/tests/schedules_test.sql`
- Modify: `lib/database.types.ts` (generated)

**Interfaces:**
- Produces:
  - tables `schedules` and `schedule_clients`, as in spec §3.1;
  - `next_schedule_date(from_date date, every_months int, day_of_month int, after date) returns date`;
  - `save_schedule(schedule_id uuid, template_id uuid, title text, every_months int, next_send_on date, due_after_days int, client_ids uuid[]) returns uuid`;
  - `set_schedule_paused(schedule_id uuid, paused boolean) returns uuid`.

- [ ] **Step 1: Write the failing pgTAP test** `schedules_test.sql`, with the shared seed:
  - `next_schedule_date`:
    - `('2027-01-31', 1, 31, '2027-01-31')` is `2027-02-28`, and `('2027-02-28', 1, 31, '2027-02-28')` is `2027-03-31`;
    - `('2027-01-15', 3, 15, '2027-01-15')` is `2027-04-15`, and `('2027-01-15', 12, 15, '2027-01-15')` is `2028-01-15`;
    - `('2027-01-01', 1, 1, '2027-03-20')` is `2027-04-01`, and `('2027-05-01', 1, 1, '2027-03-20')` is `2027-05-01`.
  - `save_schedule`, as a1:
    - creating with Template A, clients A1 and A2, and `next_send_on = current_date + 10` returns an id, with `day_of_month` equal to that date's day and two `schedule_clients` rows;
    - updating with `next_send_on => null` keeps the date and replaces the clients with `[A1]`;
    - a Firm B template raises `not_allowed`, and a Firm B client fails with `23503`.
  - Rules:
    - b1, c1, and `anon` see no schedules;
    - as a2, `update schedules set firm_id = …` and `set template_id = …` throw `42501`, while `title` can be updated;
    - `title = repeat('x', 181)` throws `23514`.
  - `set_schedule_paused` as a1: pausing returns the id, and pausing again returns null. With `next_send_on` set to `current_date - 40` as postgres, resuming moves it past today.
  - Deleting Template A, as postgres, deletes its schedules. Deleting client A2 removes its `schedule_clients` rows.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:db`
Expected: FAIL.

- [ ] **Step 3: Write the migration**
  - The tables, checks, foreign keys, and indexes from spec §3.1.
  - RLS: the policies from spec §3.2, each `to authenticated`. Then `revoke all on both from anon`, `revoke update on public.schedules from authenticated`, and `grant update (title, every_months, day_of_month, next_send_on, due_after_days, paused) on public.schedules to authenticated`.
  - `next_schedule_date`: `immutable`. Step month by month from `date_trunc('month', from_date)` by `every_months`. Clamp each date to `least(day_of_month, the month's last day)`, and return the first date after `after`, or `from_date` when it already is.
  - `save_schedule`: security invoker, like `save_draft`, following spec §3.3. The firm comes from the RLS-visible template. On update, `next_send_on = coalesce(p, next_send_on)`, and `day_of_month` changes only with a new date. Replace the client list with a delete and an insert.
  - `set_schedule_paused`: security invoker. Take today from the firm's time zone, `(now() at time zone f.time_zone)::date`, following spec §3.3.
  - Revoke `execute` on the three staff functions from `public, anon`.

- [ ] **Step 4: Apply, regenerate, and test**

Run: `npx supabase migration up --local`, `npm run db:types`, `npm run test:db`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase lib/database.types.ts
git commit -m "feat: add schedules for recurring requests"
```

---

### Task 2: Sending a due schedule

**Files:**
- Create: `supabase/migrations/20260926001100_send_scheduled_requests.sql`
- Create: `supabase/tests/send_scheduled_requests_test.sql`
- Modify: `lib/database.types.ts` (generated)

**Interfaces:**
- Produces: `send_scheduled_requests(schedule_id uuid, today date) returns integer`, the number of requests created.

- [ ] **Step 1: Write the failing pgTAP test** `send_scheduled_requests_test.sql`, with the shared seed. As postgres, create a monthly schedule S on Template A, created by a1, for clients A1 and A2, with `next_send_on = '2027-10-01'` and `due_after_days = 14`. All calls run as `service_role`:
  - `send_scheduled_requests(S, '2027-10-01')` returns 2. Two open requests exist, titled `Template A – September 2027` and due `2027-10-15`, each with Template A's items in order and `created_by = a1`.
  - One `request_sent` outbox row exists per contact, due now, with `reply_to_id = a1`.
  - Each request has one `sent` event with a null actor.
  - S has `next_send_on = '2027-11-01'` and `last_sent_on = '2027-10-01'`.
  - A second call with the same date returns 0 and creates nothing.
  - Quarterly and yearly schedules on `2027-10-01` title their requests `– Q3 2027` and `– 2026`.
  - With A2 archived, only A1 gets a request.
  - A paused schedule returns 0. A schedule with `next_send_on = '2027-12-01'` called with `today = '2027-10-01'` returns 0.
  - Late: `next_send_on = '2027-07-01'`, called on `'2027-10-01'`, sends once and moves the date to `2027-11-01`.
  - With every Template A item set to optional, the call returns 0 and `next_send_on` is unchanged.
  - As a1, the call throws `42501`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:db`
Expected: FAIL.

- [ ] **Step 3: Write the migration.** `send_scheduled_requests`: `security definer`, following spec §4 steps 1–6:
  - Lock the schedule `for update`.
  - Build the label with a `case` on `every_months` over `next_send_on`: `to_char(next_send_on - interval '1 month', 'FMMonth YYYY')`; `'Q' || extract(quarter from next_send_on - interval '3 months') || ' ' || extract(year from next_send_on - interval '3 months')`; `(extract(year from next_send_on) - 1)::text`.
  - Insert drafts, then copy the template's items as `send_requests` does.
  - Insert the outbox rows (`request_sent`, each contact's email, `send_after = now()`, `reply_to_id = created_by`) with plan 9's `on conflict on constraint email_outbox_waiting_key do update`.
  - Open the requests with `sent_at = now()`.
  - Move `next_send_on` with `next_schedule_date(..., today)`, and set `last_sent_on` when anything was sent.
  - Revoke from `public, anon, authenticated`; grant to `service_role`.

- [ ] **Step 4: Apply, regenerate, and test**

Run: `npx supabase migration up --local`, `npm run db:types`, `npm run test:db`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase lib/database.types.ts
git commit -m "feat: send a due schedule's requests in one transaction"
```

---

### Task 3: The daily job sends due schedules

**Files:**
- Modify: `lib/daily-jobs.ts`, `integration/outbox.test.ts` (or a new `integration/schedules.test.ts`)

**Interfaces:**
- Consumes: `send_scheduled_requests` (Task 2); plan 9's `sendDueEmails`.
- Produces: `DailySummary.scheduled: number`.

- [ ] **Step 1: Write the failing integration test** "sends a due schedule once a day":
  1. In a new firm, create a monthly schedule for one client with a contact, with `next_send_on` equal to the firm's today for the test's `now`.
  2. `runDailyJobs(admin, now)` gives `summary.scheduled === 1`. The mocked `sendEmails` receives one "needs documents from you" email for the contact, and the outbox row is gone.
  3. A second `runDailyJobs(admin, now)` gives `scheduled === 0`, and no new email for that contact.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:integration`
Expected: FAIL.

- [ ] **Step 3: Implement.** For each firm, after its reminders and digests are queued, the daily job reads the due schedules (`paused = false`, `next_send_on <= today`) and calls `send_scheduled_requests` for each, adding to `summary.scheduled`. An error throws, failing that firm as today. Each schedule is its own transaction, so earlier ones stand. The outbox pass that follows sends the new emails.

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test:integration`, `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/daily-jobs.ts integration
git commit -m "feat: send due schedules from the daily job"
```

---

### Task 4: Creating schedules, and the Schedules page

**Files:**
- Create: `lib/schedules.ts`, `lib/schedules.test.ts`
- Modify: `lib/validation.ts`, `lib/validation.test.ts`
- Create: `app/app/schedules/actions.ts`, `app/app/schedules/page.tsx`, `app/app/schedules/schedule-form.tsx`
- Create: `app/app/templates/[id]/schedule/page.tsx`
- Create: `app/app/templates/[id]/client-picker.tsx`, extracted from `send-to-clients-form.tsx`, which then uses it
- Modify: `app/app/templates/[id]/page.tsx`, `app/app/app-sidebar.tsx`
- Create: `e2e/schedules.spec.ts`

**Interfaces:**
- Consumes: `save_schedule` (Task 1).
- Produces:
  - `describeRepeat(everyMonths: 1 | 3 | 12, dayOfMonth: number, nextSendOn: string): string`;
  - `scheduleSchema`;
  - `saveSchedule(input): Promise<ActionResult<{ id: string }>>`;
  - `ClientPicker({ clients, selected, onChange, marks })`, where `marks` maps client ids to "Archived" or "No contacts";
  - `ScheduleForm({ mode: "create" | "edit", ... })`.

- [ ] **Step 1: Write the failing unit tests**
  - `lib/schedules.test.ts`: `describeRepeat(1, 1, …)` is `"Monthly on the 1st"`; `(3, 5, …)` is `"Quarterly on the 5th"`; `(12, 15, "2027-01-15")` is `"Yearly on Jan 15"`. Ordinals: 2nd, 3rd, 11th, 12th, 13th, 21st, 22nd, 23rd, 31st.
  - `lib/validation.test.ts`, for `scheduleSchema`:
    - a title of 181 characters is refused with "Title must be 180 characters or fewer.";
    - an `everyMonths` of 2 is refused;
    - a `dueAfterDays` of 0 or 366 is refused with "Enter 1 to 365 days.";
    - 0 or 101 client ids are refused, with the bulk send messages;
    - a missing `nextSendOn` is valid.

- [ ] **Step 2: Write the failing browser test** `e2e/schedules.spec.ts`, test "create a schedule":
  1. Staff add two clients with contacts and open the starter template, "Annual tax return (starter)", then click "Send on a schedule".
  2. They pick both clients, keep Repeat "Monthly", pick a first send date next month on the 15th, and click "Create schedule".
  3. The Schedules page lists the title with "Monthly on the 15th", "2" clients, that date, and "Never" as the last send.

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run lib/schedules.test.ts lib/validation.test.ts`, `npx playwright test e2e/schedules.spec.ts`
Expected: FAIL.

- [ ] **Step 4: Implement**
  - `describeRepeat` and the schema. `nextSendOn` is optional and only its format is checked here; the action checks "after today".
  - `saveSchedule`:
    1. `requireStaff()`; parse with the schema.
    2. When `nextSendOn` is given, require it to be after `todayIn(staff.timeZone)`, or return "Pick a date after today.".
    3. Call `rpc("save_schedule", …)`; `fail(error)`.
    4. Revalidate `/app/schedules`, and return the id.
  - `ClientPicker`: move the filter box, "Select all shown", the checkbox list, and the "{n} selected" count out of `SendToClientsForm` unchanged, and add the optional `marks` badges.
  - `ScheduleForm`:
    - the fields and hint copy from Global Constraints, with `DatePicker` for the date and a number `Input` for "Due after";
    - "About {n} emails each time", summing the contacts of the chosen clients that are not marked;
    - on create, it calls `saveSchedule` and then `router.push("/app/schedules")`.
  - `/app/templates/[id]/schedule`: loads the template and the same client list the bulk send page loads, and renders the form in create mode, with the title starting as the template's name.
  - The template page gets "Send on a schedule" (icon `CalendarClock`) next to "Send to clients".
  - The sidebar gets `{ href: "/app/schedules", label: "Schedules", icon: CalendarClock }` between Templates and Settings.
  - `/app/schedules` lists the firm's schedules by title, with `templates(name)`, a `schedule_clients` count, and the columns from spec §5.3. The Next send column follows spec §5.3's precedence, against `todayIn(staff.timeZone)`.

- [ ] **Step 5: Run the tests**

Run: `npm test`, `npx playwright test e2e/schedules.spec.ts e2e/staff-workflows.spec.ts`, `npm run typecheck`, `npm run lint`
Expected: PASS. The bulk send still works with the extracted picker.

- [ ] **Step 6: Commit**

```bash
git add lib app/app e2e/schedules.spec.ts
git commit -m "feat: create schedules and list them on the Schedules page"
```

---

### Task 5: The schedule page, the template warning, and docs

**Files:**
- Create: `app/app/schedules/[id]/page.tsx`
- Modify: `app/app/schedules/actions.ts`, `app/app/schedules/schedule-form.tsx`
- Modify: `app/app/templates/[id]/page.tsx`, `app/app/templates/template-editor.tsx`
- Modify: `e2e/schedules.spec.ts`
- Modify: `README.md`, `docs/superpowers/specs/2026-09-24-client-portal-design.md` (§7.2, §8.2, §8.3, §11.2)

**Interfaces:**
- Consumes: `set_schedule_paused` (Task 1); `ScheduleForm` and `saveSchedule` (Task 4).
- Produces: `setSchedulePaused(scheduleId: string, paused: boolean): Promise<ActionResult>`, `deleteSchedule(scheduleId: string): Promise<ActionResult>`, and `TemplateEditor`'s `scheduleCount: number` prop.

- [ ] **Step 1: Extend the browser test** with "pause, resume, edit, and delete a schedule":
  1. On the schedule's page, click "Pause": the Schedules page shows "Paused". Click "Resume": it shows the date again.
  2. Change the title to "Monthly bookkeeping" and click "Save". The list shows the new title.
  3. Archive one of the two clients. The schedule page marks it "Archived".
  4. On the template's page, "Delete template" says "Its 1 schedules will be deleted too." Cancel it.
  5. On the schedule page, click "Delete" and confirm. The list says "No schedules yet. Start one from a template's page."

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test e2e/schedules.spec.ts`
Expected: FAIL, because there is no schedule page.

- [ ] **Step 3: Implement**
  - `setSchedulePaused` calls `rpc("set_schedule_paused")`; null gives `fail(staleState)`. `deleteSchedule` deletes with `.select("id").maybeSingle()`; no row gives `fail(staleState)`, and on success it redirects to `/app/schedules`. Both revalidate `/app/schedules`.
  - `/app/schedules/[id]`:
    - loads the schedule, its clients with `archived_at` and a contacts count, the active clients, and whether the template has a required item;
    - renders `ScheduleForm` in edit mode, with "Next send date". The form sends `nextSendOn` only when it changed, and marks skipped clients through `ClientPicker`'s `marks`;
    - adds "Pause" or "Resume" (`ActionButton`), "Delete" with the AlertDialog, and the no-required-item warning, linking to the template.
  - The template page counts the template's schedules and passes `scheduleCount`. The delete dialog's description adds "Its {n} schedules will be deleted too." when the count is above 0. ("{n} schedules" follows the spec's wording even for 1.)
  - Docs:
    - v1 spec: both tables in §7.2, their policies in §8.2, and the four functions in §8.3. In §11.2, the daily cron sends due schedules after reminders and digests.
    - README: schedules in the feature description.

- [ ] **Step 4: Run the tests**

Run: `npx playwright test e2e/schedules.spec.ts`, `npm run typecheck`, `npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/app e2e/schedules.spec.ts README.md docs/superpowers/specs/2026-09-24-client-portal-design.md
git commit -m "feat: edit, pause, resume, and delete schedules"
```

---

## Finish

Run every suite once: `npm run test:db`, `npm test`, `npm run test:integration`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e`. Then check `git status` for a clean tree.
