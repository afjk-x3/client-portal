# A Client's Files in One Place: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The client page lists every file from all of the client's requests, archived ones included, with a search box.

**Architecture:** The client page reads `item_files` joined to their items and requests, under RLS, with the shared keyset reader, so a long history is never cut off at 1,000 rows. A small client component filters the loaded rows as staff type. Files open and download through the existing file route. No database change.

**Tech Stack:** Next.js 16 (App Router, Cache Components), Supabase (RLS), Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-26-client-files-design.md`](../specs/2026-09-26-client-files-design.md)

**Build order:** 7 of 12, after [bulk archive](2026-09-26-bulk-archive.md). Next: [private staff notes](2026-09-26-staff-notes.md).

**Commands:** as in the backlog plan's [How to run things](2026-09-25-paperline-backlog.md#how-to-run-things-windows).

**Execution:** Native, chosen by the user on 2026-09-26. One session implements this plan's tasks in order (superpowers:executing-plans), then one fresh reviewer checks this plan's diff before the next plan starts. Start only when the user says so.

## Global Constraints

- The section sits under the client's requests, headed "Files ({count})".
- The search box is labeled "Search this client's files". It is a case-insensitive substring match on the file name, the request title, or the item title, kept in local state and not in the URL.
- The columns are File, Request, Item, Added, By, and Size, plus a Download link:
  - File opens `/api/files/{id}` in a new tab;
  - Request links to `/app/requests/{id}`;
  - Added is the date in the firm's time zone;
  - By is "Client", or "Firm" for files staff added;
  - Download goes to `/api/files/{id}?download=1`.
- Rows are sorted newest first by `created_at`.
- Empty states: "No files yet." and "No files match."
- Read-only: no upload or remove controls here.
- One Conventional Commit per task, with no AI attribution lines. Do not push.

## Review Focus

1. **Files from an archived request** are listed like any other. Pinned in the browser test.
2. **Files whose request retention deleted** (plan 3) do not appear, since their rows are gone. This needs no code; the query reads only existing rows.
3. **A search with surrounding spaces or different case** still matches. Pinned in the browser test (`"  BANK "`).
4. **A client with more than 1,000 files** gets them all. `readAll` pages by `id`, and its own tests cover paging; the page must call it rather than a single query. Checked in review.
5. **Two files with the same name in different requests** both show, told apart by their Request column. Pinned in the browser test, where both uploads are named `statement.pdf`.

---

### Task 1: The Files section

**Files:**
- Modify: `lib/files.ts`, `lib/files.test.ts`
- Modify: `app/portal/requests/[id]/item-card.tsx` (imports `formatSize` from `lib/files.ts`)
- Create: `app/app/clients/[id]/client-files.tsx`
- Modify: `app/app/clients/[id]/page.tsx`
- Create: `e2e/client-files.spec.ts`

**Interfaces:**
- Produces:
  - `formatSize(bytes: number): string`, moved unchanged from the portal item card into `lib/files.ts`;
  - `ClientFileRow = { id: string; filename: string; sizeBytes: number; added: string; byStaff: boolean; requestId: string; requestTitle: string; itemTitle: string }`;
  - `ClientFiles({ files }: { files: ClientFileRow[] })`.

- [ ] **Step 1: Write the failing tests**
  - `lib/files.test.ts`: `formatSize(500)` is `"1 KB"`, `formatSize(1536)` is `"2 KB"`, and `formatSize(5 * 1024 * 1024)` is `"5.0 MB"`.
  - `e2e/client-files.spec.ts`:
    1. Staff send two requests to a client with a contact: "2025 taxes", with item "Bank statement", and "2026 taxes", with item "Bank statement".
    2. The contact uploads `statement.pdf` to each and submits.
    3. Staff archive "2025 taxes", then open the client's page.
    4. Expect "Files (2)", two rows named `statement.pdf`, one with the Request "2025 taxes" and one with "2026 taxes", "Client" in the By column, and both Download links matching `/api/files/[0-9a-f-]{36}\?download=1`.
    5. Type `  BANK ` in "Search this client's files": two rows remain. Type `2025`: one row, from "2025 taxes". Type `zzz`: "No files match."
    6. A new client with no files shows "Files (0)" and "No files yet."

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run lib/files.test.ts`, `npx playwright test e2e/client-files.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**
  - Move `formatSize` to `lib/files.ts`, exported, and import it in `item-card.tsx`.
  - Client page: add a `readAll` query to its `Promise.all`:

```ts
readAll((last?: { id: string }) =>
  supabase
    .from("item_files")
    .select("id, filename, size_bytes, created_at, by_staff, request_items!inner(title, requests!inner(id, title, client_id))")
    .eq("firm_id", staff.firmId)
    .eq("request_items.requests.client_id", id)
    .gt("id", last?.id ?? NIL_UUID)
    .order("id")
    .limit(PAGE_SIZE),
)
```

    Sort the result by `created_at`, newest first, and map it to `ClientFileRow`, with `added = formatDate(todayIn(staff.timeZone, new Date(created_at)))`. A read error throws to the error page, as the page's other queries do.
  - `client-files.tsx` (`"use client"`): the heading, the search `Input` (`type="search"`), and a `Table` with the columns and links from Global Constraints. The File link uses `target="_blank" rel="noopener noreferrer"`. Filtering trims and lowercases the query, as `DashboardTabs` does.
  - The page renders `<ClientFiles files={...} />` after the Requests section.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/files.test.ts`, `npx playwright test e2e/client-files.spec.ts`, `npm run typecheck`, `npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/files.ts lib/files.test.ts app/portal/requests/[id]/item-card.tsx app/app/clients/[id] e2e/client-files.spec.ts
git commit -m "feat: list a client's files from every request on the client page"
```

---

## Finish

Run every suite once: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e`. Then check `git status` for a clean tree.
