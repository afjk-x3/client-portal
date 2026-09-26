# Private Staff Notes: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff write short private notes on a client or a request. Every staff member of the firm sees them, and clients never do.

**Architecture:** A `notes` table under RLS. Only the author may update or delete a note, and column privileges limit updates to `body`. A composite foreign key keeps a request note on its own client. One shared client component renders the Notes section on the request page and on the client page, and three Server Actions write through the user-scoped client.

**Tech Stack:** Next.js 16 (App Router, Cache Components), Supabase (Postgres, RLS, pgTAP), zod 4, Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-26-staff-notes-design.md`](../specs/2026-09-26-staff-notes-design.md)

**Build order:** 8 of 12, after [a client's files](2026-09-26-client-files.md). Next: [the email outbox](2026-09-26-email-outbox.md).

**Commands:** as in the backlog plan's [How to run things](2026-09-25-paperline-backlog.md#how-to-run-things-windows).

**Execution:** Native, chosen by the user on 2026-09-26. One session implements this plan's tasks in order (superpowers:executing-plans), then one fresh reviewer checks this plan's diff before the next plan starts. Start only when the user says so.

## Global Constraints

- Notes are plain text, 1 to 2,000 characters, with line breaks kept. `LIMITS.note = 2000` matches the column check.
- Only the author edits or deletes a note, and only `body` can change. An edited note shows " · edited".
- A departed author shows as "Former staff member", and nobody can edit their notes.
- Each list shows the newest 200 notes. When there are more, it adds "Older notes are not shown."
- Notes appear on every request page, drafts included, above Activity, and on the client page. Notes are not Activity events.
- Copy, verbatim: "Notes"; "Add a note"; "Add note"; "Edit", "Save", "Cancel"; "Delete", with the AlertDialog "Delete this note?"; "On {request title}".
- Add a new migration only; run `npm run db:types` after it. One Conventional Commit per task, with no AI attribution lines. Do not push.

## Review Focus

1. **A note whose author has left the firm** shows as "Former staff member", with no Edit or Delete for anyone. Pinned in Task 1 (pgTAP: another member's update affects 0 rows) and Task 2 (unit test on `noteAuthor`).
2. **A two-line note** keeps its line break on both pages. Pinned in Task 2 (browser test).
3. **Deleting a draft request** removes its notes and keeps the client's own notes. Pinned in Task 1 (pgTAP).
4. **A crafted insert naming another client's request** is refused by the foreign key. Pinned in Task 1 (pgTAP).
5. **An empty or 2,001-character note** is refused with a toast, and the box keeps the text. Pinned in Task 2 (schema unit test).

---

### Task 1: The notes table and its rules

**Files:**
- Create: `supabase/migrations/20260926000700_notes.sql`
- Create: `supabase/tests/notes_test.sql`
- Modify: `lib/database.types.ts` (generated)

**Interfaces:**
- Produces: table `notes (id, firm_id, client_id, request_id, author_id, body, created_at, updated_at)`, as in spec §3.1; the constraint `requests_id_client_id_key unique (id, client_id)`.

- [ ] **Step 1: Write the failing pgTAP test** `notes_test.sql`, with the shared seed. As postgres, first insert:
  - a client note N1 by a1 on client A1;
  - a request note N2 by a1 on request A1 open;
  - a request note N3 by a1 on the draft A9.

  Then:
  - As a2 (same firm), `results_eq` shows all three. As b1 (firm B), c1 (A1's contact), and `anon`, `is_empty`.
  - As a2, inserting a note with `author_id` = a1 throws `42501`. Inserting as themselves succeeds.
  - As a2, updating or deleting N1 affects 0 rows. As a1, updating N1's `body` succeeds and sets `updated_at`. Updating N1's `client_id` or `author_id` throws `42501` (column privilege).
  - As a1, inserting a note whose `client_id` is A1 but whose `request_id` is request A2 (client A2) throws `23503`.
  - `body = ''` and `repeat('x', 2001)` throw `23514`.
  - As postgres, deleting the draft A9 removes N3 and keeps N1. Deleting client A1 removes N1 and N2.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:db`
Expected: FAIL, because the table does not exist.

- [ ] **Step 3: Write the migration**
  - `alter table public.requests add constraint requests_id_client_id_key unique (id, client_id)`.
  - The `notes` table from spec §3.1: both composite foreign keys with `on delete cascade`, the body check, and indexes on `(client_id, created_at)` and `(request_id, created_at)`.
  - `alter table public.notes enable row level security`, `revoke all on public.notes from anon`, then `revoke update on public.notes from authenticated` and `grant update (body) on public.notes to authenticated`.
  - Four policies from spec §3.2, each `to authenticated`: select `using (public.is_firm_member(firm_id))`; insert `with check (public.is_firm_member(firm_id) and author_id = (select auth.uid()))`; update and delete `using` the same expression.
  - A `before update` trigger function, `notes_set_updated_at()` (`set search_path = ''`), sets `new.updated_at = now()`.

- [ ] **Step 4: Apply, regenerate, and test**

Run: `npx supabase migration up --local`, `npm run db:types`, `npm run test:db`
Expected: all pgTAP files pass.

- [ ] **Step 5: Commit**

```bash
git add supabase lib/database.types.ts
git commit -m "feat: add private staff notes to the database"
```

---

### Task 2: The Notes section and its actions

**Files:**
- Modify: `lib/constants.ts`, `lib/validation.ts`, `lib/validation.test.ts`
- Create: `lib/notes.ts`, `lib/notes.test.ts`
- Create: `app/app/notes/actions.ts`, `app/app/notes/notes.tsx`
- Modify: `app/app/requests/[id]/page.tsx`, `app/app/clients/[id]/page.tsx`
- Create: `e2e/staff-notes.spec.ts`
- Modify: `README.md`, `docs/superpowers/specs/2026-09-24-client-portal-design.md` (§7.2, §8.2)

**Interfaces:**
- Consumes: the `notes` table (Task 1).
- Produces:
  - `LIMITS.note = 2000`; `noteSchema = text("Note", LIMITS.note)`;
  - `NOTES_LIMIT = 200`; `noteAuthor(authorId: string, names: ReadonlyMap<string, string>): string`;
  - `NoteRow = { id: string; author: string; at: string; edited: boolean; body: string; own: boolean; request: { id: string; title: string } | null }`;
  - `Notes({ notes, clientId, requestId, olderHidden }: { notes: NoteRow[]; clientId: string; requestId: string | null; olderHidden: boolean })`;
  - `addNote(clientId: string, requestId: string | null, body: string)`, `updateNote(noteId: string, body: string)`, and `deleteNote(noteId: string)`, each returning `Promise<ActionResult>`.

- [ ] **Step 1: Write the failing unit tests**
  - `lib/notes.test.ts`: `noteAuthor("u1", new Map([["u1", "Tia Staff"]]))` is `"Tia Staff"`, and `noteAuthor("u2", new Map())` is `"Former staff member"`.
  - `lib/validation.test.ts`: `noteSchema` trims; refuses `"  "` with `"Note is required."`; and refuses 2,001 characters with `"Note must be 2,000 characters or fewer."`.

- [ ] **Step 2: Write the failing browser test** `e2e/staff-notes.spec.ts`:
  1. Admin Tia signs up and adds staff member Sam. Tia sends "Pat Client" a request "2026 taxes".
  2. On the request page, Tia types "Called Pat.\nShe'll drop off the rest Friday." in "Add a note" and clicks "Add note". The note shows "Tia" and both lines.
  3. Sam signs in, opens the request, and sees the note with no "Edit" or "Delete" in it.
  4. Tia clicks "Edit", changes the text to "Called Pat. Friday.", and clicks "Save". The note shows "· edited".
  5. The client page's Notes section shows it, with "On 2026 taxes" linking to the request.
  6. The contact's portal page for the request does not contain "Called Pat".
  7. Tia clicks "Delete" and confirms. The note is gone from both pages.

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run lib/notes.test.ts lib/validation.test.ts`, `npx playwright test e2e/staff-notes.spec.ts`
Expected: FAIL.

- [ ] **Step 4: Implement**
  - `app/app/notes/actions.ts` (`"use server"`), following spec §5:
    1. `requireStaff()`; check the ids with `isId` (a null `requestId` is allowed); parse the body with `noteSchema`.
    2. `addNote` inserts `{ firm_id: staff.firmId, client_id, request_id, body }`. `updateNote` updates `body`, and `deleteNote` deletes, each with `.eq("id").select("id").maybeSingle()`; no row gives `fail(staleState)`.
    3. Each revalidates `/app/requests/[id]` and `/app/clients/[id]` (as pages).
  - `notes.tsx` (`"use client"`):
    - The "Notes" heading; a form with a `Textarea` labeled "Add a note" (`maxLength={LIMITS.note}`, `required`) and an "Add note" button, using `useActionState` with `submitKeepingValues`, and cleared after a successful add.
    - The list shows `{author} · {at}`, plus ` · edited`, then the body with `whitespace-pre-wrap`, and the link "On {title}" when `request` is set. Own notes get "Edit" (an inline textarea with "Save" and "Cancel") and "Delete" (an AlertDialog "Delete this note?" with "Cancel" and "Delete").
    - "Older notes are not shown." appears when `olderHidden`.
  - Request page: read `notes` (`id, author_id, body, created_at, updated_at`) for the request, newest first, with `.limit(NOTES_LIMIT + 1)`. It needs the firm's `firm_members` names in both branches, so move that query above the draft branch. Map with `noteAuthor`, `formatDateTime(created_at, staff.timeZone)`, and `own: author_id === staff.userId`. Render `<Notes>` under the editor for a draft, and above `Activity` otherwise.
  - Client page: read the client's notes with `requests(id, title)`, newest first, limited the same way, and render `<Notes requestId={null}>` after the Files section.
  - Docs: v1 spec §7.2 gets the `notes` table, and §8.2 its policies. The README feature description mentions notes.

- [ ] **Step 5: Run the tests**

Run: `npm test`, `npx playwright test e2e/staff-notes.spec.ts`, `npm run typecheck`, `npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib app/app e2e/staff-notes.spec.ts README.md docs/superpowers/specs/2026-09-24-client-portal-design.md
git commit -m "feat: add private staff notes to requests and clients"
```

---

## Finish

Run every suite once: `npm run test:db`, `npm test`, `npm run test:integration`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e`. Then check `git status` for a clean tree.
