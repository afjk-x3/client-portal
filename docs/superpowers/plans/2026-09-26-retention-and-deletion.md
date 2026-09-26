# Retention and Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins can permanently delete an archived client, and set how long files from archived requests are kept before the daily cleanup deletes them.

**Architecture:** Database rules decide. A delete policy lets admins remove archived clients, and the existing foreign keys cascade. A firm-level retention period, a `requests.archived_at` clock, and a service-role function, `expire_files`, remove expired file records, which the existing orphan step then deletes from Storage in the same cleanup run.

**Tech Stack:** Next.js 16 (App Router), Supabase (Postgres, RLS, Storage, pgTAP), zod 4, Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-26-retention-and-deletion-design.md`](../specs/2026-09-26-retention-and-deletion-design.md)

**Build order:** 3 of 12, after [copy a request](2026-09-26-copy-request.md). Next: [a personal message with a request](2026-09-26-request-message.md).

**Commands:** as in the backlog plan's [How to run things](2026-09-25-paperline-backlog.md#how-to-run-things-windows).

**Execution:** Native, chosen by the user on 2026-09-26. One session implements this plan's tasks in order (superpowers:executing-plans), then one fresh reviewer checks this plan's diff before the next plan starts. Start only when the user says so.

## Global Constraints

- Admins only, for both features. Nothing is deleted without an admin's deliberate choice.
- A client can be deleted only when archived, after the admin types its name; the trimmed text must equal the name.
- Retention periods: null (the default, shown as "Forever"), 1, 2, 3, 5, 7, or 10 years, counted from `requests.archived_at`. Retention removes files only.
- `expire_files` is `security definer`, for the service role only, and deletes at most `max_rows` (default 1000) file records per run.
- The cleanup log line: `{"job":"cleanup","expired":n,"found":n,"deleted":n,"failed":n}`.
- Copy, verbatim:
  - The delete dialog: title "Delete {name}?"; text "This permanently deletes {name}, their contacts, every request with its answers and files, and its Activity history. It can't be undone."; field "Type {name} to confirm"; button "Delete client".
  - Errors: "Only admins can delete clients."; "Type the client's name exactly to confirm."
  - The shortening dialog: "Files from {n} archived requests will be deleted at the next daily cleanup ({time}). Save anyway?"
  - The request page: "Files were deleted on {date} under the firm's file retention setting."
- Wording fix, approved with this plan: the null option reads "Forever", not "Never", because the field is "Keep files from archived requests".
- Add a new migration only; run `npm run db:types` after it. One Conventional Commit per task, with no AI attribution lines. Do not push.

## Review Focus

1. **A retention period set on a firm whose requests were archived before this migration:** their clock starts at deployment, so nothing is deleted on the first night. The seed runs after migrations, so pgTAP cannot see the backfill; check it once on staging after the migration (see Finish).
2. **Unarchiving and archiving a request again** restarts its clock. Pinned in Task 2 (pgTAP `archived_at` reset through `unarchive_request`).
3. **A confirmation with surrounding spaces, or a name that differs in case,** follows the trim-then-exact rule: spaces pass, case does not. Pinned in Task 1 (browser test types `"  Pat Client  "`; unit test on `confirmsName`).
4. **An admin who saves the same period again, or a longer one,** sees no dialog. Pinned in Task 3 (unit test on `isShorterRetention`).
5. **More eligible files than `max_rows`:** the run deletes `max_rows` and leaves the rest for the next night, without failing. Pinned in Task 2 (pgTAP with `max_rows => 1`).

---

### Task 1: Delete an archived client

**Files:**
- Create: `supabase/migrations/20260926000400_delete_archived_clients.sql`
- Create: `supabase/tests/client_deletion_test.sql`
- Create: `lib/retention.ts`, `lib/retention.test.ts`
- Modify: `app/app/clients/[id]/actions.ts`, `app/app/clients/[id]/page.tsx`
- Create: `app/app/clients/[id]/delete-client.tsx`
- Create: `e2e/retention-and-deletion.spec.ts`

**Interfaces:**
- Produces: `confirmsName(typed: string, name: string): boolean`; `deleteClient(clientId: string, confirmation: string): Promise<ActionResult>`, which redirects to `/app/clients` on success.

- [ ] **Step 1: Write the failing tests**
  - pgTAP `client_deletion_test.sql`, with the shared seed:
    - As admin a1, deleting active client A1 affects 0 rows.
    - As postgres, set A1's `archived_at`. As staff a2 (not an admin), deleting A1 affects 0 rows. As admin b1 (firm B), 0 rows.
    - As a1, deleting A1 affects 1 row, and then `is_empty` holds for A1's `client_contacts`, `requests`, `request_items`, `item_files`, and `request_events`.
  - Unit `lib/retention.test.ts`: `confirmsName("  Pat Client  ", "Pat Client")` is true; `confirmsName("pat client", "Pat Client")` is false; `confirmsName("", "Pat Client")` is false.
  - Browser `e2e/retention-and-deletion.spec.ts`, test "an admin deletes an archived client":
    1. The admin adds "Pat Client" with a contact and sends it a request.
    2. They click Archive, then "Delete client". The dialog's "Delete client" button is disabled until "Type Pat Client to confirm" holds `  Pat Client  `.
    3. After deleting, the URL is `/app/clients`, and the list has no "Pat Client" even with "Show archived" on.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test:db`, `npx vitest run lib/retention.test.ts`, `npx playwright test e2e/retention-and-deletion.spec.ts`
Expected: FAIL. No policy allows the delete, and neither the helper nor the button exists.

- [ ] **Step 3: Implement**
  - Migration: `create policy "Admins can delete archived clients" on public.clients for delete to authenticated using (public.is_firm_admin(firm_id) and archived_at is not null);`
  - `lib/retention.ts`: `confirmsName` compares `typed.trim() === name`.
  - `deleteClient` in `app/app/clients/[id]/actions.ts`, following spec §3.3:
    1. `requireStaff()`; a non-admin gets `{ ok: false, error: "Only admins can delete clients." }`. `isId` or `fail(notFound)`.
    2. Read the client's `name` for the firm; if there is none, `fail(staleState)`. If `!confirmsName(confirmation, name)`, return "Type the client's name exactly to confirm."
    3. `delete()` with `.eq("id").eq("firm_id").not("archived_at", "is", null).select("id").maybeSingle()`; `fail(error)`; no row gives `fail(staleState)`.
    4. `revalidatePath("/app/clients")`, then `redirect("/app/clients")`.
  - `delete-client.tsx` (client component): the destructive "Delete client" button and the AlertDialog with the verbatim copy. An `Input` labeled "Type {name} to confirm" enables the dialog's destructive "Delete client" action only when `confirmsName` holds. The action calls `deleteClient` and toasts an error. The client page renders it next to Unarchive when `archived && staff.role === "admin"`.

- [ ] **Step 4: Apply and run the tests**

Run: `npx supabase migration up --local`, `npm run test:db`, `npx vitest run lib/retention.test.ts`, `npx playwright test e2e/retention-and-deletion.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase lib/retention.ts lib/retention.test.ts app/app/clients e2e/retention-and-deletion.spec.ts
git commit -m "feat: let admins delete an archived client"
```

---

### Task 2: Retention in the database and the cleanup job

**Files:**
- Create: `supabase/migrations/20260926000500_file_retention.sql`
- Create: `supabase/tests/file_retention_test.sql`
- Modify: `lib/database.types.ts` (generated), `lib/cleanup.ts`, `app/api/cron/cleanup/route.ts`, `integration/cleanup.test.ts`

**Interfaces:**
- Produces: `firms.file_retention_years int`, `requests.archived_at timestamptz`, `requests.files_deleted_at timestamptz`; `retention_preview(years int) returns int`; `expire_files(max_rows int default 1000) returns int`; `CleanupSummary = { expired: number; found: number; deleted: number; failed: number }`.

- [ ] **Step 1: Write the failing pgTAP test** `file_retention_test.sql`, with the shared seed (request A1 open with file a1; A2 open with file a2; B1 open with file b1):
  - The trigger: archiving A1 sets `archived_at`; `unarchive_request` (as a1) clears it; updating the status to `open` directly (as postgres, from `archived`) clears it.
  - `update public.firms set file_retention_years = 4` throws `23514`.
  - `retention_preview`: as a1, with A1 archived and `archived_at = now() - interval '2 years'`, and A2 archived a day ago, `retention_preview(1)` = 1. Archive B1 two years ago too; the answer is still 1. As c1, it returns 0.
  - `expire_files`, as `service_role` (`set local role service_role`), with firm A's period at 1 year and firm B's null:
    - With a second file added to A1, `expire_files(1)` returns 1 and leaves one of A1's files; the next call returns 1, and a third returns 0.
    - A1's file records are gone, and A1's `files_deleted_at` is set.
    - A2 (archived a day ago) and B1 (firm set to null) keep their files.
    - A1's events include `file_removed` with `actor_id is null`.
    - An open request with an old `archived_at` value, set by hand, keeps its files.
  - As `authenticated` (a1): `throws_ok(expire_files(), '42501')`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:db`
Expected: FAIL, because the columns and functions are missing.

- [ ] **Step 3: Write the migration** `supabase/migrations/20260926000500_file_retention.sql`
  - `alter table public.firms add column file_retention_years int check (file_retention_years in (1, 2, 3, 5, 7, 10))`, and `grant update (file_retention_years) on public.firms to authenticated`. Updates to `firms` are column-granted; the admin-only policy still applies.
  - `alter table public.requests add column archived_at timestamptz, add column files_deleted_at timestamptz`, then `update public.requests set archived_at = now() where status = 'archived'`.
  - Trigger function `requests_set_archived_at()` (`security invoker`, `set search_path = ''`): when `new.status = 'archived' and old.status is distinct from 'archived'`, set `new.archived_at = now()`; when `new.status <> 'archived'`, set it to null. Trigger `before update of status on public.requests for each row`.
  - `retention_preview(years int) returns int`: `language sql`, `stable`, security invoker, `set search_path = ''`. It counts `requests r` where `public.is_firm_member(r.firm_id)`, `r.status = 'archived'`, `r.archived_at < now() - make_interval(years => years)`, and an `item_files` row exists through `request_items`. Revoke from `public, anon`.
  - `expire_files(max_rows int default 1000) returns int`: `security definer`. Pick up to `max_rows` file ids, ordered by `f.id`, whose request is archived before its firm's period. Delete them, returning the request ids. Set `files_deleted_at = now()` on those requests, and return the count. Revoke from `public, anon, authenticated`; grant to `service_role`.

- [ ] **Step 4: Run the pgTAP tests**

Run: `npx supabase migration up --local`, `npm run test:db`, then `npm run db:types`
Expected: all pass.

- [ ] **Step 5: Write the failing integration test** in `integration/cleanup.test.ts`, test "expires files past the firm's retention period":
  1. Create a firm with `file_retention_years: 1`, a client, and two archived requests, each with one item, one uploaded object, and one `item_files` row.
  2. Set one request's `archived_at` to three years ago; the other keeps its fresh value.
  3. `runCleanup(admin, { olderThan: "0 seconds", maxRows: 100_000 })`.
  4. Expect `summary.expired >= 1`. The old request's object download fails and its row is gone; the recent request's object downloads.

- [ ] **Step 6: Implement**
  - `runCleanup` calls `admin.rpc("expire_files", { max_rows: maxRows })` first, throwing on an error, then runs its orphan step. It returns `{ expired, found, deleted, failed }`.
  - The route logs the new summary unchanged (`{ job: "cleanup", ...summary }`) and keeps `status: summary.failed === 0 ? 200 : 500`. An `expire_files` error throws, and the route answers 500.

- [ ] **Step 7: Run it to verify it passes**

Run: `npm run test:integration`, `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add supabase lib/database.types.ts lib/cleanup.ts app/api/cron/cleanup/route.ts integration/cleanup.test.ts
git commit -m "feat: expire files from archived requests after the firm's retention period"
```

---

### Task 3: Retention setting, request notice, and docs

**Files:**
- Modify: `lib/retention.ts`, `lib/retention.test.ts`, `lib/validation.ts`
- Modify: `app/app/settings/actions.ts`, `app/app/settings/page.tsx`
- Create: `app/app/settings/retention-form.tsx`
- Modify: `app/app/requests/[id]/page.tsx`
- Modify: `e2e/retention-and-deletion.spec.ts`
- Modify: `README.md`, `docs/superpowers/specs/2026-09-24-client-portal-design.md` (§5, §8.2, §8.3)

**Interfaces:**
- Consumes: `firms.file_retention_years`, `retention_preview`, `requests.files_deleted_at` (Task 2).
- Produces:
  - `RETENTION_YEARS = [1, 2, 3, 5, 7, 10] as const`;
  - `isShorterRetention(current: number | null, next: number | null): boolean`, true when `next` is a period and `current` is null or larger;
  - `nextCleanupAt(now: Date): Date`, the next 02:00 UTC strictly after `now`, which must match `vercel.json`;
  - `retentionSchema`, which parses `"forever"` to null and `"1"`…`"10"` to numbers;
  - `previewRetention(years: number): Promise<ActionResult<{ count: number }>>`;
  - `setFileRetention(prev, formData): Promise<ActionResult>`.

- [ ] **Step 1: Write the failing unit tests** in `lib/retention.test.ts`:
  - `isShorterRetention(null, 5)` is true, `(7, 5)` is true, `(5, 5)` is false, `(5, 7)` is false, and `(5, null)` is false.
  - `nextCleanupAt(new Date("2026-09-26T01:59:00Z"))` is `2026-09-26T02:00:00Z`, and `nextCleanupAt(new Date("2026-09-26T02:00:00Z"))` is `2026-09-27T02:00:00Z`.

- [ ] **Step 2: Extend the browser test**
  - Test "retention saves without a dialog when nothing would be deleted": the admin chooses "1 year" under "Keep files from archived requests" and clicks Save. Expect the toast "File retention saved." and no dialog. After a reload, the select shows "1 year".
  - Test "staff who are not admins cannot delete clients": the admin adds a staff member in Settings, and archives "Pat Client". The staff member signs in, opens the client, and sees no "Delete client" button. The retention select is disabled.

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run lib/retention.test.ts`, `npx playwright test e2e/retention-and-deletion.spec.ts`
Expected: FAIL.

- [ ] **Step 4: Implement**
  - The helpers in `lib/retention.ts`. Put `retentionSchema` in `lib/validation.ts`: `z.enum(["forever", "1", "2", "3", "5", "7", "10"])`, transformed to `null` or a number.
  - `previewRetention`: `requireAdmin()`; check that `years` is in `RETENTION_YEARS` or `fail(notFound)`; call `rpc("retention_preview", { years })`; return the count.
  - `setFileRetention`: `requireAdmin()`; parse `formData.get("years")` with `retentionSchema`; update `firms.file_retention_years` for the firm, with `.select("id").maybeSingle()`; `revalidatePath("/app/settings")`.
  - `retention-form.tsx`, modeled on `time-zone-form.tsx`:
    - A `Select name="years"` labeled "Keep files from archived requests". Its options are "Forever" and "1 year" through "10 years", each period followed by " after archiving". It is disabled for non-admins, and only admins get "Save".
    - When `isShorterRetention(current, next)` holds, the form first calls `previewRetention`. A count above zero opens an AlertDialog with the verbatim text, with `{time}` given as `formatDateTime(nextCleanupAt(new Date()).toISOString(), timeZone)` and the buttons "Cancel" and "Save anyway". Otherwise it saves at once.
    - A success toast reads "File retention saved."
    - The settings page selects `file_retention_years` and renders the form after `TimeZoneForm`.
  - The request page selects `files_deleted_at`. When it is set, it shows under the items: "Files were deleted on {formatDate(todayIn(staff.timeZone, new Date(files_deleted_at)))} under the firm's file retention setting."
  - Docs:
    - v1 spec: in §5, data retention moves into scope, and account and firm deletion stay manual. §8.2 gets the delete rule. §8.3 gets `retention_preview` and `expire_files`.
    - README: the feature description, and under Deploying, that the cleanup job also applies each firm's file retention.

- [ ] **Step 5: Run the tests**

Run: `npm test`, `npx playwright test e2e/retention-and-deletion.spec.ts`, `npm run typecheck`, `npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib app/app e2e/retention-and-deletion.spec.ts README.md docs/superpowers/specs/2026-09-24-client-portal-design.md
git commit -m "feat: add the file retention setting and the deleted-files notice"
```

---

## Finish

Run every suite once: `npm run test:db`, `npm test`, `npm run test:integration` (not during a browser run; it deletes orphans), `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e`. Then check `git status` for a clean tree.

Staging: both migrations must reach staging before the code. Afterwards, `select count(*) from public.requests where status = 'archived' and archived_at is null` must return 0: the backfill starts the clock of already-archived requests at deployment.
