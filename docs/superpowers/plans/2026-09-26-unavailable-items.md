# "I Don't Have This" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a client answer "I don't have this", with a reason, on an empty file item, and let staff review that answer like a submission.

**Architecture:** A new column and a `security definer` RPC, `mark_unavailable`, submit the item with its reason. `submit_item` and a trigger on `item_files` clear the reason, and the timeline's `submitted` event carries it. The portal gets the answer form. Staff screens, the digest, and Activity show "Not available".

**Tech Stack:** Next.js 16 (App Router), Supabase (Postgres, RLS, pgTAP), zod 4, Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-26-unavailable-items-design.md`](../specs/2026-09-26-unavailable-items-design.md)

**Build order:** 1 of 12. It starts from `main` as of the backlog build. Next: [copy a request](2026-09-26-copy-request.md).

**Commands:** as in the backlog plan's [How to run things](2026-09-25-paperline-backlog.md#how-to-run-things-windows).

**Execution:** Native, chosen by the user on 2026-09-26. One session implements this plan's tasks in order (superpowers:executing-plans), then one fresh reviewer checks this plan's diff before the next plan starts. Start only when the user says so.

## Global Constraints

- File items only. The reason is required, 1 to 1,000 characters, stored trimmed; `LIMITS.unavailableReason = 1000` matches the column check.
- Only on an item with no files, including files staff added. The item becomes `submitted`: no new item status, no new event kind, no new emails.
- Staff screens say "Not available".
- Client copy, verbatim: button "I don't have this"; box label "Why not?"; placeholder "For example: no investment account this year"; buttons "Send to {firm}" and "Cancel"; toast "Sent. {firm} will review it."; line "You told {firm} you don't have this: “{reason}”".
- Staff copy, verbatim: "The client says they don't have this"; digest item "{title} (not available)"; Activity "{actor} said they don't have {item}: “{reason}”".
- A draft request raises `not_allowed`, as §3.2 step 2 and `submit_item` do. (§6 lists the draft under `invalid_state`; the rule in §3.2 wins.)
- Add a new migration only; run `npm run db:types` after it. One Conventional Commit per task, with no AI attribution lines. Do not push.

## Review Focus

1. **A reason of only spaces, or of 1,001 characters,** is refused, and the box keeps what was typed. Pinned in Task 1 (pgTAP) and Task 2 (schema unit test).
2. **A file added after the answer,** such as staff attaching the document the client emailed, clears the reason, so no screen still claims the client has nothing. Pinned in Task 1 (pgTAP).
3. **The item gained a file in another tab before the client sent the answer:** refused with "This has changed since the page loaded." Pinned in Task 1 (pgTAP, item with files).
4. **A reason with quotes, `<`, or line breaks** shows as typed in the portal and review sheet, and is escaped in the digest. Pinned in Task 3 (digest unit test with `<b>`).
5. **Accepting an answered required item** completes the request, and the reason stays visible. Pinned in Task 1 (pgTAP).

---

### Task 1: Database: column, RPC, clearing, and timeline

**Files:**
- Create: `supabase/migrations/20260926000200_unavailable_items.sql`
- Create: `supabase/tests/unavailable_items_test.sql`
- Modify: `lib/database.types.ts` (generated)

**Interfaces:**
- Produces: `request_items.unavailable_reason text`; RPC `mark_unavailable(item_id uuid, reason text) returns void`; the `submitted` event's detail `{"reason": "..."}` when the item has a reason.

- [ ] **Step 1: Write the failing pgTAP test** `supabase/tests/unavailable_items_test.sql`, using the shared seed (contact c1 of client A1; items a1 file with a file, a3 text, a4 optional empty file, a9 in a draft):

```sql
begin;
select plan(20);
\ir fixtures/seed.psql

select tests.login_as('00000000-0000-0000-0000-0000000000c2');
select throws_ok($$ select public.mark_unavailable('10000000-0000-0000-0000-0000000000a4', 'No account') $$,
  'P0001', 'not_allowed', 'another client''s contact cannot answer');
select tests.login_as('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.mark_unavailable('10000000-0000-0000-0000-0000000000a4', 'No account') $$,
  'P0001', 'not_allowed', 'staff who are not contacts cannot answer');

select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select public.mark_unavailable('10000000-0000-0000-0000-0000000000a9', 'No account') $$,
  'P0001', 'not_allowed', 'an item in a draft is not found');
select throws_ok($$ select public.mark_unavailable('10000000-0000-0000-0000-0000000000a3', 'No account') $$,
  'P0001', 'invalid_state', 'a written-answer item is refused');
select throws_ok($$ select public.mark_unavailable('10000000-0000-0000-0000-0000000000a1', 'No account') $$,
  'P0001', 'invalid_state', 'an item with files is refused');
select throws_ok($$ select public.mark_unavailable('10000000-0000-0000-0000-0000000000a4', '   ') $$,
  'P0001', 'invalid_state', 'a blank reason is refused');
select throws_ok($$ select public.mark_unavailable('10000000-0000-0000-0000-0000000000a4', repeat('x', 1001)) $$,
  'P0001', 'invalid_state', 'a reason over 1,000 characters is refused');

select lives_ok($$ select public.mark_unavailable('10000000-0000-0000-0000-0000000000a4', '  No account  ') $$,
  'a contact answers an empty file item');
select results_eq(
  $$ select status, unavailable_reason, submitted_at is not null from public.request_items
     where id = '10000000-0000-0000-0000-0000000000a4' $$,
  $$ values ('submitted'::text, 'No account'::text, true) $$,
  'the item is submitted with the trimmed reason');
select throws_ok($$ select public.mark_unavailable('10000000-0000-0000-0000-0000000000a4', 'Again') $$,
  'P0001', 'invalid_state', 'a submitted item cannot be answered again');
select results_eq(
  $$ select detail from public.request_events
     where item_id = '10000000-0000-0000-0000-0000000000a4' and kind = 'submitted' $$,
  $$ values ('{"reason": "No account"}'::jsonb) $$,
  'the submitted event carries the reason');
```

Then, each as `postgres` (`reset role`) unless it says otherwise:
- Set a4 to `needs_changes` with `review_note = 'Check the bank app'`. Assert the reason is still `'No account'`: "sending back keeps the reason".
- As c1, `lives_ok(mark_unavailable(a4, 'Closed the account'))`: "an item sent back can be answered again". Assert the reason is `'Closed the account'`.
- Insert an `item_files` row for a4 with `by_staff = true`, as the seed inserts files. Assert `ok(unavailable_reason is null)`: "a file added to the item clears the reason".
- Set a4 to `needs_changes` again, and as c1 `lives_ok(submit_item(a4))`. Assert `status = 'submitted'` and a null reason: "a normal submission leaves no old reason".
- Insert a required file item a5 (`10000000-0000-0000-0000-0000000000a5`, position 4) into request A1, and set a1 and a3 to `accepted`. As c1, `mark_unavailable(a5, 'Never had one')`. As staff a1, `update public.request_items set status = 'accepted' where id = a5`. Assert `results_eq` a5 `('accepted', 'Never had one')` ("accepting keeps the reason"), and request A1's status is `'completed'` ("accepting the answer completes the request").
- `throws_ok($$ update public.request_items set unavailable_reason = 'x' where id = a3 $$, '23514', null, 'the column refuses a reason on a written-answer item')`.
- As `anon`: `throws_ok(mark_unavailable(a4, 'x'), '42501', null, 'anon cannot call mark_unavailable')`.

Adjust `plan()` to the final count.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:db`
Expected: `unavailable_items_test.sql` fails, because `mark_unavailable` does not exist.

- [ ] **Step 3: Write the migration** `supabase/migrations/20260926000200_unavailable_items.sql`
  - `alter table public.request_items add column unavailable_reason text`, with a named check `request_items_unavailable_reason_check`: `unavailable_reason is null or (kind = 'file' and char_length(unavailable_reason) between 1 and 1000)`.
  - `create function public.mark_unavailable(item_id uuid, reason text) returns void`, `security definer`, `set search_path = ''`, following spec §3.2: select the item joined to its request with `for update of i`, where the request is not a draft and `public.is_client_contact(r.client_id)`; `not_allowed` if not found; `invalid_state` unless the request is `open`, the item is `file` in `requested` or `needs_changes`, it has no `item_files` row, and `btrim(reason)` has 1 to 1,000 characters; then one update setting `status = 'submitted'`, `submitted_at = now()`, `unavailable_reason = btrim(reason)`. Revoke `execute` from `public, anon`.
  - `create or replace function public.submit_item(...)`: the 20260925000500 body, with `unavailable_reason = null` added to its final update.
  - `create function public.item_files_clear_unavailable_reason()` returning trigger, `security definer`, `set search_path = ''`: `update public.request_items set unavailable_reason = null where id = new.item_id and unavailable_reason is not null`. Trigger `item_files_clear_unavailable_reason` `after insert on public.item_files for each row`. Revoke `execute` from `public, anon, authenticated`.
  - `create or replace function public.request_items_log_events()`: the 20260925001700 body, with the `submitted` branch passing `case when new.unavailable_reason is null then '{}'::jsonb else jsonb_build_object('reason', new.unavailable_reason) end`.

- [ ] **Step 4: Apply, regenerate types, and run the tests**

Run: `npx supabase migration up --local`, then `npm run db:types`, then `npm run test:db`
Expected: every pgTAP file passes, including `submit_item_test.sql` and `request_events_test.sql` unchanged.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260926000200_unavailable_items.sql supabase/tests/unavailable_items_test.sql lib/database.types.ts
git commit -m "feat: let contacts answer that they don't have a document"
```

---

### Task 2: Portal: answer "I don't have this"

**Files:**
- Modify: `lib/constants.ts` (`LIMITS`), `lib/validation.ts`
- Create: `lib/validation.test.ts`
- Modify: `app/portal/requests/[id]/actions.ts`, `app/portal/requests/[id]/page.tsx`, `app/portal/requests/[id]/item-card.tsx`
- Create: `e2e/unavailable-items.spec.ts`

**Interfaces:**
- Consumes: RPC `mark_unavailable` (Task 1).
- Produces: `LIMITS.unavailableReason = 1000`; `unavailableReasonSchema` (the private `text()` helper with the label "Reason"); `markUnavailable(itemId: string, reason: string): Promise<ActionResult>`; `PortalItem.unavailableReason: string | null`.

- [ ] **Step 1: Write the failing unit test** `lib/validation.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { unavailableReasonSchema } from "@/lib/validation";

describe("unavailableReasonSchema", () => {
  it("trims the reason", () => {
    expect(unavailableReasonSchema.parse("  No account  ")).toBe("No account");
  });
  it("refuses a blank reason", () => {
    expect(unavailableReasonSchema.safeParse("   ").error?.issues[0].message).toBe("Reason is required.");
  });
  it("refuses 1,001 characters", () => {
    expect(unavailableReasonSchema.safeParse("x".repeat(1001)).error?.issues[0].message).toBe(
      "Reason must be 1,000 characters or fewer.",
    );
  });
});
```

- [ ] **Step 2: Write the failing browser test** `e2e/unavailable-items.spec.ts`, the contact's part:
  1. Staff sign up with `signUpWithFirm` (firm "Ledger & Co"), add "Pat Client" with `addClientWithContact`, create a request "2026 tax documents" with `fillRequest(staff, "2026 tax documents", "Investment statements")`, and send it.
  2. The contact signs in, opens the request, and clicks "I don't have this". They fill "Why not?" with "No investment account this year" and click "Send to Ledger & Co".
  3. Expect the toast "Sent. Ledger & Co will review it.", the text `You told Ledger & Co you don't have this: “No investment account this year”`, the badge "Submitted", and no "Choose files or drag them here".

- [ ] **Step 3: Run both to verify they fail**

Run: `npx vitest run lib/validation.test.ts`, then `npx playwright test e2e/unavailable-items.spec.ts`
Expected: the schema is not exported; there is no "I don't have this" button.

- [ ] **Step 4: Implement**
  - `LIMITS.unavailableReason: 1000`, and `export const unavailableReasonSchema = text("Reason", LIMITS.unavailableReason)`.
  - `markUnavailable` in the portal actions file: `isId(itemId)` or `fail(notFound)`; parse with the schema or return `invalid(...)`; call `rpc("mark_unavailable", { item_id, reason })`; map an error with `fail`; then `revalidateRequestPages()`.
  - The portal page selects `unavailable_reason` and passes it as `unavailableReason`.
  - In `FileItem`, when `editable`, the item has no files, and no upload is queued: an outline "I don't have this" button under the upload area. It opens a form, submitted with `useActionState` and `submitKeepingValues` as `TextItem` does: a `Textarea` with the label "Why not?", `name="reason"`, the placeholder, `maxLength={LIMITS.unavailableReason}`, and `required`; a "Send to {firmName}" submit button, disabled while pending; and "Cancel", which closes the form. On success it shows the toast "Sent. {firmName} will review it.".
  - When the item is `submitted` or `accepted` and has a reason, the card shows the line `You told {firmName} you don't have this: “{reason}”` with `whitespace-pre-wrap`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run lib/validation.test.ts`, `npx playwright test e2e/unavailable-items.spec.ts`, `npm run typecheck`, `npm run lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/constants.ts lib/validation.ts lib/validation.test.ts app/portal/requests/[id] e2e/unavailable-items.spec.ts
git commit -m "feat: add the I don't have this answer to the portal"
```

---

### Task 3: Staff screens, digest, Activity, and README

**Files:**
- Modify: `app/app/requests/[id]/page.tsx`, `app/app/requests/[id]/review-items.tsx`, `app/app/page.tsx`, `app/app/dashboard-tabs.tsx`
- Modify: `lib/email/templates.ts`, `lib/email/templates.test.ts`, `lib/daily-jobs.ts`
- Modify: `lib/activity.ts`, `lib/activity.test.ts`
- Modify: `e2e/unavailable-items.spec.ts`, `README.md`

**Interfaces:**
- Consumes: `request_items.unavailable_reason` (Task 1); the portal answer (Task 2).
- Produces: `ReviewItem.unavailableReason: string | null`; `ReadyRow.unavailable: boolean`; `DigestGroup.items: { title: string; unavailable: boolean }[]`, changed from `string[]`.

- [ ] **Step 1: Write the failing unit tests**
  - `lib/activity.test.ts`: `expect(describeEvent("submitted", { reason: "No account" }, "Photo ID")).toBe("said they don't have Photo ID: “No account”")`. The existing `["submitted", {}, "submitted Photo ID"]` row stays.
  - `lib/email/templates.test.ts`: a digest group with items `[{ title: "Bank statement", unavailable: false }, { title: "<b>Payslip</b>", unavailable: true }]` renders `<li>Bank statement</li>` and `<li>&lt;b&gt;Payslip&lt;/b&gt; (not available)</li>` in the HTML, and `Payslip` with ` (not available)` in the text. Update the existing digest tests to the object items.

- [ ] **Step 2: Extend the browser test** with the staff part:
  1. The staff dashboard's "Ready for review" tab shows "Investment statements" with a "Not available" badge.
  2. On the request page, the item's row shows "Not available". Its sheet shows "The client says they don't have this" and "No investment account this year", and no "No files yet.".
  3. Staff enter "Please check your bank app" under "What needs to change?" and click "Needs changes".
  4. The contact sees "Changes requested" with the note and "I don't have this" again. They answer "Closed the account in 2025".
  5. Staff accept the item, and the heading shows "Completed".
  6. Activity shows `Pat Client said they don't have Investment statements: “Closed the account in 2025”`.

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run lib/activity.test.ts lib/email/templates.test.ts`, then `npx playwright test e2e/unavailable-items.spec.ts`
Expected: FAIL on the new expectations.

- [ ] **Step 4: Implement**
  - `describeEvent("submitted")` returns `said they don't have ${item}: ${quoted(detail.reason)}` when `typeof detail.reason === "string"`, and otherwise `submitted ${item}` as today.
  - `staffDigestEmail` renders each item's title, escaped, followed by ` (not available)` when `unavailable`, in both versions. `digests()` in `lib/daily-jobs.ts` selects `unavailable_reason` and pushes `{ title, unavailable: unavailable_reason !== null }`.
  - The request page selects `unavailable_reason` into `ReviewItem.unavailableReason`. The row's Status cell adds `<Badge variant="secondary">Not available</Badge>` after `ItemStatusBadge` when it is set. In `ItemDetails`, a file item with a reason shows "The client says they don't have this" and the reason (`whitespace-pre-wrap`) in place of "No files yet.".
  - The dashboard's ready query selects `unavailable_reason`. The Item column renders the title and the same badge when `unavailable`.
  - README: in the summary paragraph, after "upload files or answer each item, and submit it", add "or say they don't have a document, with a reason".

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`, `npm run test:integration`, `npx playwright test e2e/unavailable-items.spec.ts`, `npm run typecheck`, `npm run lint`
Expected: all pass. The integration run confirms the digest still builds with the new item shape.

- [ ] **Step 6: Commit**

```bash
git add app/app lib e2e/unavailable-items.spec.ts README.md
git commit -m "feat: show not-available answers to staff, in the digest, and in Activity"
```

---

## Finish

Run every suite once: `npm run test:db`, `npm test`, `npm run test:integration`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e`. Then check `git status` for a clean tree, including no drift in `lib/database.types.ts`.
