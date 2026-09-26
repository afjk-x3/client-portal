# Copy a Request, or Save It as a Template: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From a sent request, staff can start a pre-filled copy for the same client, or save the request's items as a new template.

**Architecture:** Copy is a URL: the New request page reads `from` and pre-fills the existing editor, so nothing is saved until Save draft or Send. Save as template is one `security invoker` function, `template_from_request`, that writes the template and its items together, behind a Server Action that opens the template editor.

**Tech Stack:** Next.js 16 (App Router, Cache Components), Supabase (Postgres, RLS, pgTAP), Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-26-copy-request-design.md`](../specs/2026-09-26-copy-request-design.md)

**Build order:** 2 of 12, after ["I don't have this"](2026-09-26-unavailable-items.md). Next: [retention and deletion](2026-09-26-retention-and-deletion.md).

**Commands:** as in the backlog plan's [How to run things](2026-09-25-paperline-backlog.md#how-to-run-things-windows).

**Execution:** Native, chosen by the user on 2026-09-26. One session implements this plan's tasks in order (superpowers:executing-plans), then one fresh reviewer checks this plan's diff before the next plan starts. Start only when the user says so.

## Global Constraints

- Sent requests only (open, completed, or archived); drafts get neither action.
- Copy goes to the same client only, with the original title, no due date, and each item's title, description, type, and required flag, in `position`, then `id`, order. Nothing else carries over.
- Copy URL: `/app/requests/new?client={client_id}&from={request_id}`. A `from` that does not match falls back to the blank editor, without an error.
- The template is named after the request's title and numbered 1, 2, 3… Template names need not be unique.
- Copy text, verbatim: the "Copy" link, the "Save as template" button, and the line "Copy of “{title}”".
- Add a new migration only; run `npm run db:types` after it. One Conventional Commit per task, with no AI attribution lines. Do not push.

## Review Focus

1. **A `from` for another client's request, a draft, or a malformed id** opens the blank editor, never someone else's items. Pinned in Task 1 (browser test with a draft's id).
2. **Moving from a copy to a blank New request for the same client** starts empty, not with the copy's items. Pinned in Task 1 (browser test).
3. **Items whose positions have gaps**, left by deleted items, come out numbered 1, 2, 3 in the template. Pinned in Task 2 (pgTAP).
4. **Clicking "Save as template" twice** makes two templates, without an error. Pinned in Task 2 (pgTAP, second call).
5. **An archived request from last year** can be copied and saved. Pinned in Task 2 (pgTAP on an archived request).

---

### Task 1: Copy a sent request

**Files:**
- Modify: `app/app/requests/new/page.tsx`
- Modify: `app/app/requests/[id]/request-actions.tsx`, `app/app/requests/[id]/page.tsx`
- Create: `e2e/copy-request.spec.ts`

**Interfaces:**
- Consumes: `newEditorItem(from)` from `lib/editor-items.ts`; `RequestEditor` with `initial: { title, dueDate, items }`.
- Produces: `RequestActions` gains a `clientId: string` prop.

- [ ] **Step 1: Write the failing browser test** `e2e/copy-request.spec.ts`, test "copy a sent request":
  1. Staff sign up, add "Pat Client" with `addClientWithContact`, and create a request with `fillRequest(staff, "2026 tax documents", "Photo ID")`. They add a second item, a written answer titled "Any changes this year?", and send it.
  2. Click "Copy". Expect the URL to match `/app/requests/new?client=…&from={id}`, the text "Copy of “2026 tax documents”", the "Title" field set to "2026 tax documents", "Item 1 title" set to "Photo ID", "Item 2 title" set to "Any changes this year?", and the "Due date" button with no date chosen.
  3. Pick a due date and click "Save draft". The draft's page shows both items.
  4. Open `/app/requests/new?client={clientId}&from={draftId}` using the new draft's id. Expect no "Copy of" line and an empty "Title": a draft is not a source.
  5. Open the client's plain New request page. Expect an empty "Title".

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test e2e/copy-request.spec.ts`
Expected: FAIL, because there is no "Copy" link.

- [ ] **Step 3: Implement**
  - New request page: read `from` with `client`. When `isId(from)`, load `requests` with `title, request_items(title, description, kind, required, position)`, filtered by `id = from`, the staff member's `firm_id`, `client_id = client.id`, and `status <> 'draft'`, with items ordered by `position`, then `id`. Throw on a query error. On a match, pass `initial = { title, dueDate: null, items: items.map(newEditorItem) }`, and show `Copy of “{title}”` under the "For {client}" line. Key the editor `${client.id}:${source?.id ?? ""}`.
  - `RequestActions`: add an outline "Copy" link (icon `Copy`) to `/app/requests/new?client={clientId}&from={requestId}`, placed before Archive, for every status it renders (the component renders only sent requests). The request page passes `clientId={request.client_id}`.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx playwright test e2e/copy-request.spec.ts`, `npm run typecheck`, `npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/app/requests e2e/copy-request.spec.ts
git commit -m "feat: copy a sent request for the same client"
```

---

### Task 2: Save a request as a template

**Files:**
- Create: `supabase/migrations/20260926000300_template_from_request.sql`
- Create: `supabase/tests/template_from_request_test.sql`
- Modify: `lib/database.types.ts` (generated)
- Modify: `app/app/templates/actions.ts`, `app/app/requests/[id]/request-actions.tsx`
- Modify: `e2e/copy-request.spec.ts`, `README.md`, `docs/superpowers/specs/2026-09-24-client-portal-design.md` (§8.3)

**Interfaces:**
- Produces: RPC `template_from_request(request_id uuid) returns uuid`, null when nothing was created; `saveRequestAsTemplate(requestId: string): Promise<ActionResult>`, which redirects on success.

- [ ] **Step 1: Write the failing pgTAP test** `supabase/tests/template_from_request_test.sql`, with the shared seed (request A1 open: items a1 "A1 file" required file, a3 "A1 text" required text, a4 "A1 optional file"):
  - As postgres, first give a4 a description `'Last page too'` and set its position to 10.
  - As staff a2, `template_from_request('d0000000-0000-0000-0000-0000000000a1')` returns a non-null id. Then `results_eq` over `templates` gives `('A1 open', firm A)`, and `results_eq` over its `template_items` ordered by `position` gives:

```sql
values (1, 'A1 file'::text, null::text, 'file'::text, true),
       (2, 'A1 text', null, 'text', true),
       (3, 'A1 optional file', 'Last page too', 'file', false)
```

  - A second call returns a different id: two templates named 'A1 open'.
  - The draft `d0000000-0000-0000-0000-0000000000a9` returns null, and the template count is unchanged.
  - Firm B's request `d0000000-0000-0000-0000-0000000000b1` returns null, and the count is unchanged.
  - As postgres, archive A1. As a2, the call still returns an id.
  - As contact c1: `throws_ok(..., '42501', null, 'a client contact is refused')`.
  - As `anon`: `throws_ok(..., '42501', null, 'anon cannot call template_from_request')`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:db`
Expected: FAIL, because the function does not exist.

- [ ] **Step 3: Write the migration** `supabase/migrations/20260926000300_template_from_request.sql`: `create function public.template_from_request(request_id uuid) returns uuid`, `language plpgsql`, security invoker, `set search_path = ''`.
  1. Insert into `templates (firm_id, name)`, selecting `r.firm_id, r.title` from `requests r` where `r.id = request_id and r.status <> 'draft'`, returning `id` into a variable. RLS hides other firms' requests.
  2. If no row was inserted, return null.
  3. Insert `template_items (template_id, firm_id, position, title, description, kind, required)`, taking `row_number() over (order by i.position, i.id)` as the position.
  4. Return the id.

  Revoke `execute` from `public, anon`.

- [ ] **Step 4: Apply, regenerate, and test**

Run: `npx supabase migration up --local`, `npm run db:types`, `npm run test:db`
Expected: all pgTAP files pass.

- [ ] **Step 5: Extend the browser test** with test "save a sent request as a template":
  1. On the original request from Task 1's setup, click "Save as template".
  2. Expect a URL matching `/app/templates/[0-9a-f-]{36}$`, the name field set to "2026 tax documents", and both item titles.
  3. Add a second client, and open its New request page. "Start from" lists "2026 tax documents".

- [ ] **Step 6: Implement the action and button**
  - `saveRequestAsTemplate(requestId)` in `app/app/templates/actions.ts`: `requireStaff()`; `isId` or `fail(notFound)`; call `rpc("template_from_request", { request_id })`; `fail(error)` on an error, `fail(notFound)` on a null result. Then `revalidatePath("/app/templates")` and `redirect(`/app/templates/${id}`)`.
  - In `RequestActions`, an outline `ActionButton` "Save as template" (icon `FilePlus`) calls it, next to Copy.

- [ ] **Step 7: Run the tests**

Run: `npx playwright test e2e/copy-request.spec.ts`, `npm run typecheck`, `npm run lint`
Expected: PASS.

- [ ] **Step 8: Docs**
  - v1 spec §8.3: add a `template_from_request(request_id)` row to the RPC table. Caller: staff. Checks: security invoker, so RLS applies; not a draft. Effect: creates a template named after the request, with its items renumbered, and returns its id or null. Add it to the list of security invoker functions above the table.
  - README summary: add "copy a request or save it as a template" to the staff features.

- [ ] **Step 9: Commit**

```bash
git add supabase lib/database.types.ts app/app e2e/copy-request.spec.ts README.md docs/superpowers/specs/2026-09-24-client-portal-design.md
git commit -m "feat: save a sent request's items as a new template"
```

---

## Finish

Run every suite once: `npm run test:db`, `npm test`, `npm run test:integration`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e`. Then check `git status` for a clean tree.
