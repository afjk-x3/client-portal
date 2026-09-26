# Archive Requests in Bulk: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff tick open or completed requests on the Requests page and archive them together, with the same effect as archiving each one.

**Architecture:** Selection state and a checkbox column live in `RequestsTable`; `DataTable` does not change. One Server Action runs one guarded update under the existing RLS, and the existing timeline trigger records `archived` for each row. No database change.

**Tech Stack:** Next.js 16 (App Router), Supabase (RLS), zod 4, Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-26-bulk-archive-design.md`](../specs/2026-09-26-bulk-archive-design.md)

**Build order:** 6 of 12, after [export clients](2026-09-26-client-export.md). Next: [a client's files](2026-09-26-client-files.md).

**Commands:** as in the backlog plan's [How to run things](2026-09-25-paperline-backlog.md#how-to-run-things-windows).

**Execution:** Native, chosen by the user on 2026-09-26. One session implements this plan's tasks in order (superpowers:executing-plans), then one fresh reviewer checks this plan's diff before the next plan starts. Start only when the user says so.

## Global Constraints

- Only open and completed rows get a checkbox; draft and archived rows have none.
- Selection is limited to the current page (at most 50 rows) and clears when the filters or the page change.
- The action accepts 1 to 50 distinct, well-formed ids. Anything else returns the existing `not_allowed` message.
- Copy, verbatim ("{n} requests" uses "request" when n is 1):
  - The table: checkbox labels "Select {title}" and "Select all on this page"; the bar "{n} selected", "Archive {n} requests", and "Clear".
  - The dialog: title "Archive {n} requests?"; text "Reminders stop and clients can no longer upload or submit. You can unarchive any of them later."; when some are open, "{k} of them are still open."; buttons "Cancel" and "Archive".
  - Toasts: "Archived {n} requests.", or "Archived {n} of {m} requests. The rest had already changed."
- One Conventional Commit per task, with no AI attribution lines. Do not push.

## Review Focus

1. **A colleague archives one of the ticked requests first:** the toast says "Archived 1 of 2 requests. The rest had already changed." Pinned in Task 1 (unit test of the message).
2. **"Select all on this page" with a draft among the rows** ticks only the selectable rows. Pinned in Task 2 (browser test).
3. **Changing the status filter after ticking rows** clears the selection. Pinned in Task 2 (browser test).
4. **A crafted call with 51 ids, an empty list, or a malformed id** is refused. Pinned in Task 1 (schema unit test).
5. **All ticked requests already archived elsewhere** gives "This has changed since the page loaded. Refresh and try again." rather than a success toast. Pinned in Task 2 (browser test, step 7).

---

### Task 1: The action and its messages

**Files:**
- Modify: `lib/validation.ts`, `lib/validation.test.ts`
- Create: `app/app/requests/archive-message.ts`, `app/app/requests/archive-message.test.ts`
- Modify: `app/app/requests/actions.ts`

**Interfaces:**
- Produces:
  - `archiveRequestsSchema`: `z.array(z.uuid()).min(1).max(50)`, deduplicated;
  - `archiveResultMessage(archived: number, selected: number): string`;
  - `archiveRequests(requestIds: string[]): Promise<ActionResult<{ archived: number }>>`.

- [ ] **Step 1: Write the failing unit tests**
  - `lib/validation.test.ts`: `archiveRequestsSchema` accepts 1 and 50 ids; refuses `[]`, 51 ids, and `["not-an-id"]`; and turns `[id, id]` into `[id]`.
  - `archive-message.test.ts`: `archiveResultMessage(2, 2)` is `"Archived 2 requests."`, `(1, 1)` is `"Archived 1 request."`, and `(1, 2)` is `"Archived 1 of 2 requests. The rest had already changed."`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run lib/validation.test.ts app/app/requests/archive-message.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**
  - The schema and the message helper.
  - `archiveRequests`:
    1. `requireStaff()`; parse with the schema, or `fail(notFound)`.
    2. `update({ status: "archived" })` with `.in("id", ids).eq("firm_id", staff.firmId).in("status", ["open", "completed"]).select("id")`; `fail(error)`.
    3. Zero rows gives `fail(staleState)`.
    4. `revalidatePath("/app/requests")`, and return `{ archived: data.length }`.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run lib/validation.test.ts app/app/requests/archive-message.test.ts`, `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/validation.ts lib/validation.test.ts app/app/requests
git commit -m "feat: add the bulk archive action"
```

---

### Task 2: Checkboxes, the bar, and the dialog

**Files:**
- Modify: `app/app/requests/requests-table.tsx`, `app/app/requests/page.tsx`
- Create: `e2e/bulk-archive.spec.ts`

**Interfaces:**
- Consumes: `archiveRequests` and `archiveResultMessage` (Task 1).

- [ ] **Step 1: Write the failing browser test** `e2e/bulk-archive.spec.ts`:
  1. Staff create three requests for one client: two sent ("Q1 papers", "Q2 papers") and one draft ("Q3 draft").
  2. On `/app/requests`, the draft's row has no "Select Q3 draft" checkbox. "Select all on this page" gives "2 selected".
  3. "Clear" hides the bar. Tick "Select Q1 papers", then change Status to "Archived" and apply: no bar. Go back to Active.
  4. Tick both sent requests and click "Archive 2 requests". The dialog says "2 of them are still open.". Click "Archive".
  5. The toast reads "Archived 2 requests.", and neither title is in the Active view. With Status "Archived", both are listed.
  6. On one request's page, the Activity section shows "archived the request" under the staff member's name.
  7. Stale case: tick an open request, archive it on its own page in a second tab, then confirm the bulk archive. The toast reads "This has changed since the page loaded. Refresh and try again.".

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test e2e/bulk-archive.spec.ts`
Expected: FAIL, because there are no checkboxes.

- [ ] **Step 3: Implement**
  - `RequestsTable`:
    - `useState<ReadonlySet<string>>` for the selection. Build the columns inside the component (`useMemo`): a first `select` column whose header is a `Checkbox` labeled "Select all on this page" (checked when every selectable row is ticked), and whose cells hold a `Checkbox` labeled "Select {title}" for open and completed rows only.
    - The bar renders when the selection is not empty: "{n} selected", an `AlertDialog` whose trigger is "Archive {n} requests", and a "Clear" button.
    - The dialog counts the ticked rows with status `open` for "{k} of them are still open.". Its "Archive" action calls `archiveRequests`, then toasts `archiveResultMessage(result.data.archived, selected.size)` or `result.error`, and clears the selection on success.
  - `page.tsx`: key `RequestsTable` with `JSON.stringify(filters)`, so the filters and page reset it.

- [ ] **Step 4: Run the tests**

Run: `npx playwright test e2e/bulk-archive.spec.ts`, `npm run typecheck`, `npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/app/requests e2e/bulk-archive.spec.ts
git commit -m "feat: archive requests in bulk from the Requests page"
```

---

## Finish

Run every suite once: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e`. Then check `git status` for a clean tree.
