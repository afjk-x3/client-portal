# QA Findings 1–13 + Schedule QA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 13 UI/UX and functional findings in `qa-findings.md`, then execute the Pending QA Task (trigger `api/cron/daily`, verify schedule-generated requests, clean up).

**Architecture:** Small, surgical edits across existing components — no new abstractions. One new DB RPC (`undo_unavailable`) with a migration + pgTAP coverage; one new shadcn-style `dropdown-menu` component (the `radix-ui` unified package is already a dependency, so no package changes). All fixes land on branch `feat/unavailable-items`.

**Tech Stack:** Next.js 16 App Router (RSC, server actions), React 19, Tailwind v4, shadcn-style components on `radix-ui` v1.6, sonner toasts, Supabase (plpgsql RPCs), Vitest, pgTAP, Playwright.

**Spec:** `qa-findings.md` (repo root) — every finding's recommendation below is argued from it.

## Global Constraints

- **No commits** unless the user explicitly asks. Report `git status` at the end instead.
- Windows/PowerShell 5.1: no `grep`/`rg` (use Grep tool), `-LiteralPath` for odd paths, `curl.exe` for HTTP (not the `curl` alias).
- **Never `supabase db reset`** — it destroys the user's walkthrough data. Apply the new migration with `npx supabase migration up`.
- **No new npm dependencies.** `radix-ui` (unified) is already installed; `DropdownMenu` primitives come from it.
- Copy strings from the findings are exact: "Not available", "Accept as unavailable", "Undo", "Cancel", "Previous notes", "More actions", "Unarchive N requests", "Client deleted."
- E2E note: Playwright `getByRole` name matching is **substring by default** — "Accept" keeps matching "Accept as unavailable"; specs that click buttons moved into the menu must open the menu first and switch to `getByRole("menuitem", …)`.
- Known pre-existing flakes (report, don't chase): pgTAP `email_results_test.sql` claim tests; e2e `client-export`, `unavailable-items`, `portal-and-review`.
- Dev server runs on `localhost:3000` (user's `npm run dev`). Cron secret: `local-cron-secret` (`.env.local`).
- Line references below match the pre-edit files; match on surrounding code, not the number.

## Batches

| Batch | Tasks | Findings | Theme |
|---|---|---|---|
| 1 | 1–2 | F1–F4 | Portal item flow (placement, cancel, hiding, undo + badge) |
| 2 | 3–4 | F6–F9, F13 | Staff sheet copy/styling, notes, delete toast |
| 3 | 5 | F10 | Header overflow menu + e2e selector updates |
| 4 | 6–7 | F11, F5 | Routing history (redirects), sheet close state |
| 5 | 8 | F12 | Bulk unarchive |
| 6 | 9 | Pending QA Task | Cron trigger + schedule verification + cleanup |
| 7 | 10 | — | Full verification gates + report |

---

### Task 1: Portal item flow — button placement, thread Cancel, inline-form focus (F1, F2, F3)

**Files:**
- Modify: `app/portal/requests/[id]/item-card.tsx`
- Modify: `components/item-thread.tsx`

**Interfaces:**
- Produces: `ItemCard` owns `answering` state (passed to `FileItem` as `answering: boolean`, `setAnswering: (v: boolean) => void`); `ItemThread` renders a "Cancel" button beside "Send" when the box was opened via `emptyButton` and there are no messages.

- [ ] **Step 1: Lift `answering` state to `ItemCard` and hide the thread while answering (F3)**

In `item-card.tsx`, inside `ItemCard` after the `editable` line, add:

```tsx
  const [answering, setAnswering] = useState(false);
```

Change the `FileItem` render and the `ItemThread` render:

```tsx
        {item.kind === "file" ? (
          <FileItem item={item} editable={editable} firmName={firmName} answering={answering} setAnswering={setAnswering} />
        ) : (
          <TextItem item={item} editable={editable} />
        )}
        {(!answering || !editable) && (
          <ItemThread
            messages={messages}
            canWrite={canWrite}
            label="Write a message"
            send={(body) => postItemMessage(item.id, body)}
            emptyButton="Ask a question"
          />
        )}
```

- [ ] **Step 2: Rewrite `FileItem` signature and the bottom action area (F1 + F3)**

Signature (drop the internal state):

```tsx
function FileItem({
  item,
  editable,
  firmName,
  answering,
  setAnswering,
}: {
  item: PortalItem;
  editable: boolean;
  firmName: string;
  answering: boolean;
  setAnswering: (value: boolean) => void;
}) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
```

Replace the three blocks at the bottom of `FileItem` (the old `I don't have this` button, the `Why not?` form, and the standalone `Submit` button — old lines 254–292) with exactly two blocks in this order:

```tsx
      {editable && item.files.length === 0 && uploads.length === 0 && answering && (
        <form onSubmit={submitKeepingValues(formAction)} className="flex flex-col gap-2">
          <label htmlFor={`unavailable-${item.id}`} className="text-sm font-medium">
            Why not?
          </label>
          <Textarea
            id={`unavailable-${item.id}`}
            name="reason"
            placeholder="For example: no investment account this year"
            maxLength={LIMITS.unavailableReason}
            rows={4}
            required
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              Send to {firmName}
            </Button>
            <Button type="button" variant="outline" onClick={() => setAnswering(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {editable && !answering && (
        <div className="flex items-center justify-end gap-2">
          {item.files.length === 0 && uploads.length === 0 && (
            <Button variant="ghost" onClick={() => setAnswering(true)}>
              I don&apos;t have this
            </Button>
          )}
          <ActionButton
            disabled={item.files.length === 0 || busy}
            aria-label={`Submit ${item.title}`}
            action={() => submitItem(item.id)}
            success="Submitted. We'll let you know if anything else is needed."
          >
            Submit
          </ActionButton>
        </div>
      )}
```

This delivers: **F1** — "I don't have this" sits immediately left of the primary "Submit", both bottom-right, ghost vs solid; **F3** — while the inline form is open, the global Submit and "Ask a question" (thread) are hidden, so only "Send to {firm}" + "Cancel" show.

- [ ] **Step 3: Add "Cancel" beside "Send" in `ItemThread` (F2)**

In `components/item-thread.tsx`, replace the single Send button inside the form (old lines 89–91) with:

```tsx
          <div className="flex items-center gap-2 self-start">
            <Button type="submit" disabled={pending}>
              Send
            </Button>
            {emptyButton != null && messages.length === 0 && (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setBody("");
                  setOpen(false);
                }}
              >
                Cancel
              </Button>
            )}
          </div>
```

The Cancel button only appears when the box was opened by the `emptyButton` on an empty thread (portal "Ask a question"); staff sheets (`emptyButton` absent) or threads with messages are unchanged.

- [ ] **Step 4: Verify**

Run: `npm run lint; if ($?) { npm run typecheck }`
Expected: both pass. (Behavioral proof comes from e2e in Tasks 4/10 — `unavailable-items` and `item-messages` cover this flow.)

---

### Task 2: "Undo" after marking unavailable + accurate badge (F4)

**Files:**
- Create: `supabase/migrations/20261003000100_undo_unavailable.sql`
- Modify: `supabase/tests/unavailable_items_test.sql` (extend, `plan(21)` → `plan(28)`)
- Modify: `app/portal/requests/[id]/actions.ts` (new `undoUnavailable`)
- Modify: `app/portal/requests/[id]/item-card.tsx` (Undo button + badge)
- Regenerate: `lib/database.types.ts` (via `npm run db:types`)

**Interfaces:**
- Produces: RPC `undo_unavailable(item_id uuid) -> void` (client contact only; `P0001 not_allowed` / `P0001 invalid_state`); server action `undoUnavailable(itemId: string): Promise<ActionResult>`.

- [ ] **Step 1: Write the migration**

`supabase/migrations/20261003000100_undo_unavailable.sql`:

```sql
-- The contact changes their mind after "I don't have this": back to
-- requested, no reason left, so the upload path opens again. Only the
-- unanswered submission mark_unavailable wrote; an accepted item is the
-- firm's decision and stays.

create function public.undo_unavailable(item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_status text;
  v_request_status text;
  v_has_reason boolean;
begin
  select i.kind, i.status, r.status, i.unavailable_reason is not null
  into v_kind, v_status, v_request_status, v_has_reason
  from public.request_items i
  join public.requests r on r.id = i.request_id
  where i.id = undo_unavailable.item_id
    and public.is_client_contact(r.client_id)
  for update of i;

  if not found then
    raise exception 'not_allowed';
  end if;
  if v_request_status <> 'open'
     or v_kind <> 'file'
     or v_status <> 'submitted'
     or not v_has_reason then
    raise exception 'invalid_state';
  end if;

  update public.request_items
  set status = 'requested',
      submitted_at = null,
      unavailable_reason = null
  where id = undo_unavailable.item_id;
end;
$$;

revoke execute on function public.undo_unavailable(uuid) from public, anon;
```

Security shape mirrors `mark_unavailable` exactly (security definer, pinned `search_path`, revoke from `public, anon`), which is what the catalog-wide guard in `supabase/tests/access_rules_test.sql:76-85` enforces.

- [ ] **Step 2: Apply it locally and regenerate types**

Run: `npx supabase migration up`
Then confirm: `docker exec supabase_db_client-portal psql -U supabase_admin -d postgres -tc "select proname from pg_proc where proname = 'undo_unavailable';"`
Expected: one row.
Then: `npm run db:types`
Expected: `lib/database.types.ts` gains `undo_unavailable` under `Functions`.

- [ ] **Step 3: Extend the pgTAP file (TDD — run before the UI exists)**

In `supabase/tests/unavailable_items_test.sql`: change `select plan(21);` → `select plan(28);`, and insert this block **before** the `set local role anon;` line (old line 109), keeping the anon block last:

```sql
-- undo_unavailable: the contact takes back "I don't have this".
reset role;
insert into public.request_items (id, request_id, firm_id, position, title, kind, required)
values ('10000000-0000-0000-0000-0000000000a6', 'd0000000-0000-0000-0000-0000000000a2',
  'f0000000-0000-0000-0000-00000000000a', 2, 'A2 undo', 'file', true);
select tests.login_as('00000000-0000-0000-0000-0000000000c2');
select throws_ok($$ select public.undo_unavailable('10000000-0000-0000-0000-0000000000a6') $$,
  'P0001', 'invalid_state', 'undo before the answer is refused');
select lives_ok($$ select public.mark_unavailable('10000000-0000-0000-0000-0000000000a6', 'No statement') $$,
  'the contact answers the new item');
select lives_ok($$ select public.undo_unavailable('10000000-0000-0000-0000-0000000000a6') $$,
  'the contact undoes their own answer');
select results_eq(
  $$ select status, unavailable_reason, submitted_at from public.request_items
     where id = '10000000-0000-0000-0000-0000000000a6' $$,
  $$ values ('requested'::text, null::text, null::timestamptz) $$,
  'the item is requested again with no reason');
select lives_ok($$ select public.mark_unavailable('10000000-0000-0000-0000-0000000000a6', 'Still none') $$,
  'the item can be marked unavailable again after an undo');
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select public.undo_unavailable('10000000-0000-0000-0000-0000000000a6') $$,
  'P0001', 'not_allowed', 'another client''s contact cannot undo');
select throws_ok($$ select public.undo_unavailable('10000000-0000-0000-0000-0000000000a5') $$,
  'P0001', 'invalid_state', 'an accepted item cannot be undone');
reset role;
```

Fixture facts used: item `a6` goes in client A2's open request `d…a2` (contact `c2`); `a5` ends the file accepted-with-reason inside now-completed `d…a1`; the block ends `reset role` so the trailing `set local role anon` still runs as superuser.

- [ ] **Step 4: Run the test file**

Run: `npx supabase test db supabase/tests/unavailable_items_test.sql`
Expected: PASS (28 tests). Fix the migration if not — do not continue until green.

- [ ] **Step 5: Server action**

In `app/portal/requests/[id]/actions.ts`, after `markUnavailable`:

```ts
/** The contact takes back "I don't have this"; the upload path returns. */
export async function undoUnavailable(itemId: string): Promise<ActionResult> {
  if (!isId(itemId)) return fail(notFound);
  const supabase = await createClient();
  const { error } = await supabase.rpc("undo_unavailable", { item_id: itemId });
  if (error) return fail(error);

  revalidateRequestPages();
  return { ok: true };
}
```

- [ ] **Step 6: Undo button + accurate badge in `item-card.tsx`**

Add imports: `undoUnavailable` to the `./actions` import; `import { Badge } from "@/components/ui/badge";`.

Badge in `ItemCard`'s `CardAction` (old lines 56–58):

```tsx
        <CardAction>
          {item.status === "submitted" && item.unavailableReason ? (
            <Badge variant="secondary">Not available</Badge>
          ) : (
            <ItemStatusBadge status={item.status} />
          )}
        </CardAction>
```

Undo button — replace the confirmation paragraph in `FileItem` (old lines 158–162) with:

```tsx
      {(item.status === "submitted" || item.status === "accepted") && item.unavailableReason && (
        <div className="flex items-start justify-between gap-3">
          <p className="whitespace-pre-wrap text-sm">
            You told {firmName} you don&apos;t have this: “{item.unavailableReason}”
          </p>
          {item.status === "submitted" && (
            <ActionButton
              variant="ghost"
              size="sm"
              className="shrink-0"
              action={() => undoUnavailable(item.id)}
              success="You can upload the file now."
            >
              Undo
            </ActionButton>
          )}
        </div>
      )}
```

Undo is offered only while `submitted` — after staff accept the absence, the decision stands (the finding asks for an escape hatch in the dead-end state, not an audit loophole).

- [ ] **Step 7: Verify**

Run: `npm run lint; if ($?) { npm run typecheck }; if ($?) { npm test }`
Expected: all pass (`npm test` includes any `send.test.ts`/pure units; the pgTAP file already ran green).

---

### Task 3: Staff review sheet — client-reason callout + Accept copy (F6, F7)

**Files:**
- Modify: `app/app/requests/[id]/review-items.tsx`

- [ ] **Step 1: Callout styling for the client's reason (F6)**

Replace the plain reason paragraph (old lines 146–149):

```tsx
            (item.unavailableReason ? (
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">The client says they don&apos;t have this</p>
                <p className="rounded-md bg-muted px-3 py-2 text-sm italic whitespace-pre-wrap">
                  &ldquo;{item.unavailableReason}&rdquo;
                </p>
              </div>
```

- [ ] **Step 2: Explicit Accept copy for unavailable items (F7)**

Replace the Accept `ActionButton` (old lines 213–216):

```tsx
        {canAccept && (
          <ActionButton action={() => acceptItem(item.id)} success="Item accepted.">
            {item.unavailableReason ? "Accept as unavailable" : "Accept"}
          </ActionButton>
        )}
```

E2E safety: `getByRole("button", { name: "Accept" })` (activity:28, happy-path:75, portal-and-review:49, unavailable-items:67) matches by substring, so "Accept as unavailable" still satisfies all four.

- [ ] **Step 3: Verify**

Run: `npm run lint; if ($?) { npm run typecheck }`
Expected: pass.

---

### Task 4: Notes styling + delete-client toast (F8, F9, F13)

**Files:**
- Modify: `app/app/notes/notes.tsx`
- Modify: `app/app/clients/[id]/delete-client.tsx`

- [ ] **Step 1: De-emphasize inline Edit/Delete (F8)**

`notes.tsx` — Edit button (old lines 117–119): `variant="outline"` → `variant="ghost"`:

```tsx
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                Edit
              </Button>
```

Delete trigger (old line 175): `variant="outline"` → `variant="ghost"`:

```tsx
        <Button variant="ghost" size="sm" disabled={pending}>
          Delete
        </Button>
```

- [ ] **Step 2: Structural separation for submitted notes (F9)**

In the `Notes` component, replace the bare `<ol>` (old lines 53–57):

```tsx
      {notes.length > 0 && (
        <div className="flex flex-col gap-3 border-t pt-3">
          <h3 className="text-sm font-medium text-muted-foreground">Previous notes</h3>
          <ol className="flex flex-col gap-4">
            {notes.map((note) => (
              <NoteItem key={note.id} note={note} />
            ))}
          </ol>
        </div>
      )}
```

- [ ] **Step 3: Success toast on client deletion (F13)**

`delete-client.tsx` — in `remove()` (old lines 28–33):

```tsx
  function remove() {
    startTransition(async () => {
      const result = await deleteClient(clientId, typed);
      if (!result.ok) toast.error(result.error);
      else toast.success("Client deleted.");
    });
  }
```

- [ ] **Step 4: Verify with the notes e2e spec**

Run: `npx playwright test staff-notes.spec.ts`
Expected: PASS (spec clicks "Add note" — unaffected; confirms the section still renders).

---

### Task 5: Header overflow menu (F10)

**Files:**
- Create: `components/ui/dropdown-menu.tsx`
- Modify: `app/app/requests/[id]/request-actions.tsx`
- Modify: `e2e/copy-request.spec.ts` (line 65)
- Modify: `e2e/staff-workflows.spec.ts` (lines 117, 120)
- Modify: `e2e/item-messages.spec.ts` (line 78)

**Interfaces:**
- Produces: `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuSeparator` from `@/components/ui/dropdown-menu`; header keeps **Edit details**, **Add item**, **Send reminder** visible; **Download all (.zip)**, **Copy**, **Save as template**, **Archive/Unarchive** move into a "More actions" menu.

- [ ] **Step 1: Create the dropdown-menu component**

`components/ui/dropdown-menu.tsx` (same conventions as `popover.tsx`: `"use client"`, `cn` package, `radix-ui` import, `data-slot`, tailwind-v4 arbitrary-property syntax):

```tsx
"use client";

import * as React from "react";
import { cn } from "cn";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";

function DropdownMenu(props: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger(props: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-(--radix-dropdown-menu-trigger-width) rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-hidden data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-muted", className)}
      {...props}
    />
  );
}

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator };
```

- [ ] **Step 2: Restructure `RequestActions`**

In `request-actions.tsx`:
- Icon imports become: `import { Archive, ArchiveRestore, BellRing, Copy, Download, Ellipsis, FilePlus, Plus } from "lucide-react";` (`Ellipsis` falls back to `MoreHorizontal` if the installed lucide build lacks it — typecheck will say).
- Add: `import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";`
- Add a local menu-action component (mirrors `ActionButton`, but renders as a menu item — nesting a `Button` inside a menu item double-applies padding classes):

```tsx
/** A server action as a menu item: pending disables it, the result lands in a toast. */
function MenuAction({
  action,
  success,
  children,
}: {
  action: () => Promise<ActionResult<unknown>>;
  success?: string;
  children: React.ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <DropdownMenuItem
      disabled={pending}
      onSelect={() =>
        startTransition(async () => {
          const result = await action();
          if (!result.ok) toast.error(result.error);
          else if (success) toast.success(success);
        })
      }
    >
      {children}
    </DropdownMenuItem>
  );
}
```

(`useTransition` and `React` type imports: extend the existing `import { useActionState, useId, useLayoutEffect, useState } from "react"` to include `useTransition`, and `import type { ReactNode } from "react"` — use `ReactNode` rather than `React.ReactNode`.)

- Replace the whole return block (old lines 50–87) with:

```tsx
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!archived && (
        <EditDetailsDialog requestId={requestId} title={title} dueDate={dueDate} message={message} />
      )}
      {!archived && <AddItemDialog requestId={requestId} />}
      {canRemind && (
        <ActionButton variant="outline" action={() => sendReminder(requestId)} success="Reminder sent.">
          <BellRing />
          Send reminder
        </ActionButton>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" aria-label="More actions">
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem asChild>
            <a href={`/api/requests/${requestId}/zip`} download>
              <Download />
              Download all (.zip)
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/app/requests/new?client=${clientId}&from=${requestId}`}>
              <Copy />
              Copy
            </Link>
          </DropdownMenuItem>
          <MenuAction action={() => saveRequestAsTemplate(requestId)}>
            <FilePlus />
            Save as template
          </MenuAction>
          <DropdownMenuSeparator />
          <MenuAction
            action={() => setRequestArchived(requestId, !archived)}
            success={archived ? "Request unarchived." : "Request archived. Reminders have stopped."}
          >
            {archived ? (
              <>
                <ArchiveRestore />
                Unarchive
              </>
            ) : (
              <>
                <Archive />
                Archive
              </>
            )}
          </MenuAction>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
```

- [ ] **Step 3: Update the three e2e specs that click moved buttons**

`e2e/copy-request.spec.ts` line 65:

```ts
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Save as template" }).click();
```

`e2e/staff-workflows.spec.ts` line 117 and line 120:

```ts
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await expectToast(page, "Request archived.");
  await expect(page.getByRole("heading", { name: /Quarterly/ })).toContainText("Archived");
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Unarchive" }).click();
```

`e2e/item-messages.spec.ts` line 78:

```ts
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
```

- [ ] **Step 4: Verify with the affected specs**

Run: `npx playwright test copy-request.spec.ts staff-workflows.spec.ts`
Expected: PASS.

---

### Task 6: Routing history after login (F11)

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/login/page.tsx`

**Context:** `login-form.tsx:44` already uses `router.replace` — the remaining bug is that public pages render for authenticated users, so browser Back from `/app` lands on the landing or login screen. Onboarding already models the fix (`app/onboarding/page.tsx:22`).

- [ ] **Step 1: Redirect authed users off the landing page**

`app/page.tsx`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/constants";
import { getUser, homePath } from "@/lib/auth";

export default async function LandingPage() {
  if (await getUser()) redirect(await homePath());
  return (
    // …existing JSX unchanged…
  );
}
```

- [ ] **Step 2: Redirect authed users off the login page**

`app/login/page.tsx` — make the default export async and guard before rendering (imports: `redirect` from `next/navigation`, `signInDestination` from `./actions`, `getUser` from `@/lib/auth`):

```tsx
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  if (await getUser()) redirect(await signInDestination(typeof next === "string" ? next : null));
  return (
    // …existing JSX unchanged (the Suspense + LoginFormWithNext block)…
  );
}
```

`homePath()` routes staff → `/app`, contacts → `/portal`, role-less sessions → `/onboarding`, so every authed visitor leaves the public pages. Mid-OTP users have no session yet, so the code step is unaffected.

- [ ] **Step 3: Verify**

Run: `npm run lint; if ($?) { npm run typecheck }`
Expected: pass. (Full sign-in/back-navigation proof rides on the e2e suite in Task 10 — every spec signs in through `/login`.)

---

### Task 7: Side sheet uncloseable from the Dashboard Messages path (F5)

**Files:**
- Modify: `app/app/requests/[id]/review-items.tsx`
- Modify: `e2e/item-messages.spec.ts` (close assertion after the reply)

**Root cause:** the sheet open-state is derived from `openId ?? hashItem`, but `close()` only mutates `openId` (a no-op bailout when the sheet was opened via the `#item-…` hash) and `history.replaceState` (fires no React update — the `useSyncExternalStore` hash subscription is a no-op `subscribe`). From the Requests sidebar `openId` is set, so closing works; from the Dashboard it isn't, so the sheet never re-renders closed.

- [ ] **Step 1: Write the failing e2e assertion first**

In `e2e/item-messages.spec.ts`, after line 44 (`await expectToast(page, "Message sent.");` inside the reply step):

```ts
  // The sheet closes from this entry path even after a reply.
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
```

Run: `npx playwright test item-messages.spec.ts`
Expected: FAIL at the new assertion (sheet stays visible) — this documents the bug.

- [ ] **Step 2: Fix the state handling in `review-items.tsx`**

Replace lines 24–58 (the `subscribe`/`locationHash` helpers, `useSyncExternalStore` line, and the old `close`) with:

```tsx
export function ReviewItems({ items, editable, open }: { items: ReviewItem[]; editable: boolean; open: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  // The URL's #item-… anchor: read on mount (a dashboard link opens its Sheet)
  // and kept current, so close() always has state to change — replaceState
  // alone fires no render, which is what left the Sheet stuck open.
  const [hash, setHash] = useState("");
  useEffect(() => {
    setHash(window.location.hash);
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  // Next keeps visited pages mounted but hidden; close so Back and Forward never return to an open Sheet.
  useLayoutEffect(() => () => setOpenId(null), []);
  const hashItem = /^#item-(.+)$/.exec(hash)?.[1] ?? null;
  const selected = items.find((item) => item.id === (openId ?? hashItem));
  const close = () => {
    setOpenId(null);
    setHash("");
    // Drop the anchor too, so a closed Sheet cannot reopen from it.
    if (window.location.hash) history.replaceState(null, "", window.location.pathname + window.location.search);
  };
```

Import changes at the top of the file: drop `useSyncExternalStore`, add `useEffect`:

```tsx
import { useActionState, useId, useEffect, useLayoutEffect, useState } from "react";
```

Guarantee: every state where the sheet is open has at least one non-equal `close()` mutation (`hash` → `""` when hash-opened, `openId` → `null` when row-opened), so a re-render always runs.

- [ ] **Step 3: Re-run the spec**

Run: `npx playwright test item-messages.spec.ts`
Expected: PASS (including the new close assertion).

---

### Task 8: Bulk unarchive (F12)

**Files:**
- Modify: `app/app/requests/archive-message.ts`
- Modify: `app/app/requests/archive-message.test.ts`
- Modify: `app/app/requests/actions.ts` (new `unarchiveRequests`)
- Modify: `app/app/requests/requests-table.tsx`
- Modify: `e2e/staff-workflows.spec.ts` (bulk steps)

**Interfaces:**
- Consumes: existing RPC `unarchive_request(request_id uuid)` (returns the id, or null when not archived/not the caller's — see `setRequestArchived`, actions.ts:441), existing `archiveRequestsSchema`.
- Produces: `unarchiveRequests(requestIds: string[]): Promise<ActionResult<{ unarchived: number }>>`; `unarchiveResultMessage(unarchived, selected): string`.

- [ ] **Step 1: Toast helper + unit tests (TDD)**

`archive-message.ts` — add:

```ts
/** What the bulk unarchive toast says: everything, or what a colleague reopened first. */
export function unarchiveResultMessage(unarchived: number, selected: number): string {
  if (unarchived === selected) return `Unarchived ${plural(unarchived, "request")}.`;
  return `Unarchived ${unarchived} of ${plural(selected, "request")}. The rest were already open.`;
}
```

`archive-message.test.ts` — import it and add:

```ts
describe("unarchiveResultMessage", () => {
  it("reports everything", () => {
    expect(unarchiveResultMessage(2, 2)).toBe("Unarchived 2 requests.");
    expect(unarchiveResultMessage(1, 1)).toBe("Unarchived 1 request.");
  });
  it("reports a partial unarchive", () => {
    expect(unarchiveResultMessage(1, 2)).toBe("Unarchived 1 of 2 requests. The rest were already open.");
  });
});
```

Run: `npx vitest run app/app/requests/archive-message.test.ts`
Expected: PASS.

- [ ] **Step 2: Server action**

In `app/app/requests/actions.ts`, after `archiveRequests` (uses the same schema import already present):

```ts
/** Same effect as unarchiving each request: the guarded RPC, one call per id. */
export async function unarchiveRequests(requestIds: string[]): Promise<ActionResult<{ unarchived: number }>> {
  const staff = await requireStaff();
  const parsed = archiveRequestsSchema.safeParse(requestIds);
  if (!parsed.success) return fail(notFound);

  const supabase = await createClient();
  let unarchived = 0;
  for (const requestId of parsed.data) {
    const { data, error } = await supabase.rpc("unarchive_request", { request_id: requestId });
    if (error) return fail(error);
    if (data) unarchived += 1;
  }
  if (unarchived === 0) return fail(staleState);

  revalidatePath("/app/requests");
  return { ok: true, data: { unarchived } };
}
```

(ponytail: one guarded RPC per id — page-sized selections only; batch into a single SQL function if this ever runs over hundreds.)

- [ ] **Step 3: Selection + action bar in `requests-table.tsx`**

- Line 37: `const isSelectable = (row: RequestListRow) => row.status === "open" || row.status === "completed" || row.status === "archived";`
- Import `unarchiveRequests` from `./actions` and `unarchiveResultMessage` from `./archive-message`.
- After `selectableIds`/`chosen`, add the split (`chosen` is the existing selected∩rows list at old line 78 — reuse it, don't add a second copy):

```tsx
  const rowsById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  const toArchive = chosen.filter((id) => rowsById.get(id)!.status !== "archived");
  const toUnarchive = chosen.filter((id) => rowsById.get(id)!.status === "archived");
```

- Replace `archive()` and add `unarchive()`:

```tsx
  function archive() {
    const ids = toArchive;
    startTransition(async () => {
      const result = await archiveRequests(ids);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(archiveResultMessage(result.data?.archived ?? 0, ids.length));
      setSelected(new Set());
    });
  }

  function unarchive() {
    const ids = toUnarchive;
    startTransition(async () => {
      const result = await unarchiveRequests(ids);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(unarchiveResultMessage(result.data?.unarchived ?? 0, ids.length));
      setSelected(new Set());
    });
  }
```

- Replace the action bar (old lines 134–163):

```tsx
  const openCount = toArchive.filter((id) => rowsById.get(id)!.status === "open").length;

  return (
    <>
      {chosen.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{chosen.length} selected</span>
          {toArchive.length > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline">Archive {plural(toArchive.length)}</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Archive {plural(toArchive.length)}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Reminders stop and clients can no longer upload or submit. You can unarchive any of them later.
                    {openCount > 0 && ` ${openCount} of them are still open.`}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={archive}>Archive</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {toUnarchive.length > 0 && (
            <Button variant="outline" onClick={unarchive}>
              Unarchive {plural(toUnarchive.length)}
            </Button>
          )}
          <Button variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}
      <DataTable columns={allColumns} data={rows} emptyMessage="No requests match." />
    </>
  );
```

(The bar shows `chosen.length` — selected ∩ current rows — not `selected.size`, so stale ids outside the filter don't inflate the count.)

- [ ] **Step 4: e2e coverage**

In `e2e/staff-workflows.spec.ts`, insert after line 122 (`…toContainText("Open")`):

```ts
  // Bulk actions cover archived rows: archive from the list, then unarchive.
  await page.getByRole("link", { name: "Requests" }).click();
  await page.getByRole("checkbox", { name: "Select Quarterly (Q3)" }).check();
  await page.getByRole("button", { name: "Archive 1 request" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Archive" }).click();
  await expectToast(page, "Archived 1 request.");
  await page.getByLabel("Status").selectOption("archived");
  await page.getByRole("checkbox", { name: "Select Quarterly (Q3)" }).check();
  await page.getByRole("button", { name: "Unarchive 1 request" }).click();
  await expectToast(page, "Unarchived 1 request.");
```

The checkbox on an **archived** row is the finding's exact gap.

- [ ] **Step 5: Verify**

Run: `npx vitest run app/app/requests/archive-message.test.ts; if ($?) { npx playwright test staff-workflows.spec.ts }`
Expected: both PASS.

---

### Task 9: Pending QA Task — cron trigger, schedule verification, cleanup

**Files:** none modified — verification only, against the running app + local DB.

**Interfaces:**
- Consumes: `GET /api/cron/daily` (Bearer `local-cron-secret`), `schedules`/`schedule_clients`, RPC `send_scheduled_requests(schedule_id, today)`; summary field `scheduled` = number of requests created (`lib/daily-jobs.ts:221-227`).

- [ ] **Step 1: Confirm the server is up**

Run: `Invoke-WebRequest http://localhost:3000 -UseBasicParsing -TimeoutSec 5 | Select-Object StatusCode`
Expected: `200`. If down: start `npm run dev` in the project dir (background) and re-check.

- [ ] **Step 2: Find or create a due schedule**

Inspect (record ids for later cleanup):

```powershell
docker exec supabase_db_client-portal psql -U supabase_admin -d postgres -c "select id, title, paused, next_send_on, last_sent_on, firm_id, template_id from public.schedules order by created_at desc limit 5;"
```

**Branch A — a schedule exists** (likely: the user created one during manual QA): make it due:

```powershell
docker exec supabase_db_client-portal psql -U supabase_admin -d postgres -c "update public.schedules set next_send_on = current_date, paused = false where id = '<SCHED_ID>';"
```

**Branch B — no schedule:** pick a consistent triple (template with a **required** item, non-archived client **with a contact**, same firm):

```sql
select t.id as template_id, t.firm_id, c.id as client_id
from public.template_items i
join public.templates t on t.id = i.template_id
join public.clients c on c.firm_id = t.firm_id and c.archived_at is null
where i.required
  and exists (select 1 from public.client_contacts cc where cc.client_id = c.id)
limit 1;
```

Then insert:

```sql
insert into public.schedules (firm_id, template_id, title, every_months, day_of_month, next_send_on, due_after_days, paused)
values ('<FIRM_ID>', '<TEMPLATE_ID>', 'QA schedule check', 1,
        extract(day from current_date)::smallint, current_date, 7, false);
insert into public.schedule_clients (schedule_id, client_id, firm_id)
select s.id, '<CLIENT_ID>', s.firm_id from public.schedules s where s.title = 'QA schedule check';
```

- [ ] **Step 3: Trigger the daily cron**

Run: `curl.exe -s --write-out "\nHTTP %{http_code}\n" -H "Authorization: Bearer local-cron-secret" http://localhost:3000/api/cron/daily`
Expected: `HTTP 200` and JSON whose `scheduled` is ≥ 1 (requests created this run; other counters — reminders/digests/outbox — reflect whatever the data warrants, log mode). If `scheduled` is `0`: the chosen template likely has no required item — check `select title, required from public.template_items where template_id = '<TEMPLATE_ID>';`, and either give that template a required item or discard Branch A and use Branch B.

- [ ] **Step 4: Verify the generated request + schedule advance**

```sql
select id, title, status, sent_at from public.requests where title like '% – %' order by created_at desc limit 3;
select count(*) from public.request_items where request_id = '<GENERATED_REQUEST_ID>';
select next_send_on, last_sent_on from public.schedules where id = '<SCHED_ID>';
select count(*) from public.email_outbox where request_id = '<GENERATED_REQUEST_ID>';
select kind from public.request_events where request_id = '<GENERATED_REQUEST_ID>';
```

Expected: request titled `{schedule title} – {period label}` (e.g. "… – September 2026"), `status = open`, `sent_at` set; item count = the template's item count; `next_send_on` moved past today and `last_sent_on = current_date`; `email_outbox` count 0 (drained in log mode); a `sent` event row exists.

- [ ] **Step 5: Cleanup — delete the generated request and the schedule**

```sql
delete from public.email_outbox where request_id = '<GENERATED_REQUEST_ID>';
delete from public.request_events where request_id = '<GENERATED_REQUEST_ID>';
delete from public.request_items where request_id = '<GENERATED_REQUEST_ID>';
delete from public.requests where id = '<GENERATED_REQUEST_ID>';
delete from public.schedules where id = '<SCHED_ID>';
```

(`schedules` delete cascades `schedule_clients`. The generated request has no files/notes/messages, so no storage rows to remove.)

- [ ] **Step 6: Confirm clean state**

```sql
select count(*) from public.schedules;
select count(*) from public.requests where id = '<GENERATED_REQUEST_ID>';
select count(*) from public.schedule_clients where schedule_id = '<SCHED_ID>';
```

Expected: back to the pre-test counts (0 for the last two queries).

---

### Task 10: Full verification + report

- [ ] **Step 1: Static gates**

Run: `npm run lint; if ($?) { npm run typecheck }`
Expected: pass.

- [ ] **Step 2: Unit + DB + integration**

Run: `npm test`
Expected: PASS.
Run: `npm run test:db`
Expected: PASS except possibly the known-flaky `email_results_test.sql` claim tests — label any failure against that list.
Run: `npm run test:integration`
Expected: 17/17 PASS.

- [ ] **Step 3: Full e2e**

Run: `npx playwright test`
Expected: PASS except known flakes (`client-export`, `unavailable-items`, `portal-and-review`). Any failure *not* on that list is a regression from this work — fix before reporting.

- [ ] **Step 4: Final state + report**

Run: `git status --short; git diff --stat`
Expected: only intended files (see task file lists + `lib/database.types.ts`); `docs/PRD/` stays untracked; **no commits**.

Report to the user: finding-by-finding outcome, QA-task evidence (cron JSON, generated request, schedule advance, cleanup counts), test-gate results, and any known-flake failures observed.
