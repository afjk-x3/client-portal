# Export Clients to CSV: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins download the client list, as currently filtered, as a CSV in the import's format that imports back unchanged.

**Architecture:** Two pure helpers in `lib/csv.ts`, `toCsv` and `spreadsheetSafe`, and one route handler, `GET /api/clients/export`. The route pages through `list_clients` with the list's own filters, reads contacts in chunks, and responds with a UTF-8 file that starts with a byte-order mark. No database change.

**Tech Stack:** Next.js 16 route handlers, Supabase (RLS), Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-26-client-export-design.md`](../specs/2026-09-26-client-export-design.md)

**Build order:** 5 of 12, after [a personal message](2026-09-26-request-message.md). Next: [bulk archive](2026-09-26-bulk-archive.md).

**Commands:** as in the backlog plan's [How to run things](2026-09-25-paperline-backlog.md#how-to-run-things-windows).

**Execution:** Native, chosen by the user on 2026-09-26. One session implements this plan's tasks in order (superpowers:executing-plans), then one fresh reviewer checks this plan's diff before the next plan starts. Start only when the user says so.

## Global Constraints

- The header is exactly `client_name,client_type,contact_name,contact_email`.
- Rows: one per contact, sorted by `full_name` within each client, and clients in `list_clients` order (name, then id). A client without contacts gets one row with the two contact columns empty.
- The file is a UTF-8 byte-order mark (`﻿`) followed by `toCsv(...)`: CRLF between records, and quotes only around fields that contain a comma, a quote, a CR, or an LF.
- `spreadsheetSafe` adds a leading `'` to values starting with `=`, `+`, `-`, `@`, a tab, or a carriage return.
- Response headers: `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="clients-{YYYY-MM-DD}.csv"` (the firm's today), and `Cache-Control: no-store`.
- Admins only. Anyone else, including a signed-out visitor, gets 404.
- One Conventional Commit per task, with no AI attribution lines. Do not push.

## Review Focus

1. **More than 50 matching clients**, and more than 200 with contacts: every one is exported, not just the first page or chunk. Pinned in Task 2 (browser test with a 55-row import).
2. **A name with a comma, a quote, or an accent** (`Peña, "Ann"`) comes back identical through `parseCsv`. Pinned in Task 1 (round-trip unit test).
3. **An email or name starting with `-` or `=`** is prefixed and cannot run as a formula. Pinned in Task 1 (unit test).
4. **A hand-edited export URL** with an invalid `kind` or `owner` falls back to the default filters instead of failing. Pinned in Task 2 (browser request with `kind=bogus`).
5. **Exporting the same list twice, then importing it,** adds nothing. Pinned in Task 2 (browser test).

---

### Task 1: CSV writing helpers

**Files:**
- Modify: `lib/csv.ts`, `lib/csv.test.ts`

**Interfaces:**
- Produces: `toCsv(records: string[][]): string` and `spreadsheetSafe(value: string): string`.

- [ ] **Step 1: Write the failing unit tests** in `lib/csv.test.ts`:
  - `toCsv([["a", "b"], ["c", "d"]])` is `"a,b\r\nc,d"`.
  - `toCsv([['Peña, "Ann"', "x\ny"]])` is `'"Peña, ""Ann""","x\ny"'`, with both fields quoted.
  - For `records = [["client_name", "contact_email"], ['Peña, "Ann"', "a@b.co"], ["", "line\r\nbreak"]]`, `parseCsv(toCsv(records))` equals `records`.
  - `spreadsheetSafe` turns `=SUM(A1)`, `+1`, `-2`, `@x`, `"\tx"`, and `"\rx"` into the same values with a leading `'`, and leaves `"Maria"`, `""`, and `"a=b"` unchanged.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run lib/csv.test.ts`
Expected: FAIL, because the helpers are not exported.

- [ ] **Step 3: Implement both in `lib/csv.ts`**, as spec §5 describes.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run lib/csv.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/csv.ts lib/csv.test.ts
git commit -m "feat: add CSV writing helpers"
```

---

### Task 2: The export route and button

**Files:**
- Create: `app/api/clients/export/route.ts`
- Modify: `app/app/clients/page.tsx`
- Create: `e2e/client-export.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `toCsv` and `spreadsheetSafe` (Task 1); `parseClientFilters`, `listHref`, and `LIST_PAGE_SIZE` from `lib/list-params.ts`; `getStaff()`; `todayIn`.

- [ ] **Step 1: Write the failing browser test** `e2e/client-export.spec.ts`:
  - Test "an admin exports the filtered list, and importing it adds nothing":
    1. The admin imports a CSV of 55 individuals, each with one contact, plus one business "Peña, Ann Ltd" with contact "Ann Peña" and `-ann@example.com`.
    2. They filter the Clients page by type Individual and click "Export CSV".
    3. The download starts with `﻿` and the header line. It has 56 lines, the header plus 55 individuals, and no "Peña" row.
    4. Exporting with no filter includes `"Peña, Ann Ltd",business,Ann Peña,'-ann@example.com`.
    5. Uploading the unfiltered export on the import page previews every row as "Skipped", and its button reads "Import 0 rows" and is disabled.
  - Test "staff who are not admins cannot export": a staff member added by the admin sees no "Export CSV", and `GET /api/clients/export` answers 404 for them. A signed-out request answers 404 too.
  - `GET /api/clients/export?kind=bogus` as the admin answers 200 with every client.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test e2e/client-export.spec.ts`
Expected: FAIL, because there is no Export button.

- [ ] **Step 3: Implement the route** `GET /api/clients/export`, following spec §4:
  1. `getStaff()`; answer `new NextResponse("Not found", { status: 404 })` unless the caller is an admin.
  2. `parseClientFilters` from `request.nextUrl.searchParams`, as a plain object.
  3. Call `list_clients` with those filters for pages 1, 2, … until a page returns fewer than `LIST_PAGE_SIZE` rows.
  4. Read `client_contacts` (`client_id, full_name, email`) with `.in("client_id", chunk)`, 200 ids at a time, ordered by `full_name`.
  5. Build the rows, with every value passed through `spreadsheetSafe`.
  6. Respond with the headers from Global Constraints. A query error is logged with `console.error` and answered with 500.

- [ ] **Step 4: Add the button.** For admins only (`staff.role === "admin"`), the Clients page shows an outline link "Export CSV" (icon `Download`) before "Import CSV". Its href is `listHref("/api/clients/export", { q, owner, kind, archived })`, without `page`. Use a plain `<a download>`, not `Link`, so the browser downloads the file.

- [ ] **Step 5: Run the tests**

Run: `npx playwright test e2e/client-export.spec.ts`, `npm run typecheck`, `npm run lint`
Expected: PASS.

- [ ] **Step 6: Docs.** README: mention the export next to the import in the feature description.

- [ ] **Step 7: Commit**

```bash
git add app/api/clients/export app/app/clients/page.tsx e2e/client-export.spec.ts README.md
git commit -m "feat: let admins export the client list as CSV"
```

---

## Finish

Run every suite once: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e`. Then check `git status` for a clean tree.
