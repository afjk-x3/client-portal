# Client Portal Phase 5: Requests and Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff create a request from a template or blank, edit it freely as a draft, send it (contacts get an email), and review each item: accept it, or return it with a note. Open requests allow the limited edits from spec section 7.3, and archive/unarchive. The end-to-end test gains step 3: send a request with one required item.

**Architecture:** One `actions.ts` for the requests segment. Every state change is a guarded update (`.eq("status", …)` plus `.select().maybeSingle()`), so a stale page or a double click changes nothing and returns `invalid_state`. Emails are built inside the action and sent in `after()` only when the guarded update returned a row. The completion trigger from Phase 2 keeps `requests.status` in sync; unarchive calls `refresh_request_status`.

**Tech Stack:** shadcn Popover + Calendar (react-day-picker), Sheet, Dialog, AlertDialog, Select; `useTransition` for the editors; `after()` from `next/server`.

**Spec:** sections 5 (items 5 and 7), 7.3, 9.2 (requests), 10.4, 10.7, 11.1
**Depends on:** Phase 4
**Index:** [2026-09-24-client-portal.md](2026-09-24-client-portal.md)

---

## Files

| File | Responsibility |
|---|---|
| `app/app/requests/actions.ts` | `saveDraft`, `sendRequest`, `deleteDraft`, `updateRequestDetails`, `addItem`, `removeItem`, `acceptItem`, `returnItem`, `setRequestArchived` |
| `components/date-picker.tsx` | Calendar in a Popover, value `YYYY-MM-DD` |
| `app/app/requests/request-editor.tsx` | Editor for new requests and drafts |
| `app/app/requests/new/page.tsx` | New request for `?client=<id>`, with the template picker |
| `app/app/requests/[id]/page.tsx` | Draft editor, or the review view once sent |
| `app/app/requests/[id]/request-actions.tsx` | Header actions: edit details, add item, zip, archive |
| `app/app/requests/[id]/review-items.tsx` | Item list and review Sheet |

---

## Task 1: Request actions

**Files:**
- Modify: `e2e/happy-path.spec.ts`, `lib/database.types.ts` (generated)
- Create: `supabase/migrations/20260925000800_request_editing.sql`, `app/app/requests/actions.ts`
- Test: `supabase/tests/request_editing_test.sql`

- [ ] **Step 1: Extend the end-to-end test**

Replace `e2e/happy-path.spec.ts` (step 3 added). The date picker's trigger is labelled "Due date"; the calendar's day buttons are named like "Thursday, October 15th, 2026".

```ts
import { expect, test, type Page } from "@playwright/test";
import { readSignInCode } from "./mailpit";

const run = Date.now();
const staffEmail = `staff-${run}@example.com`;
const contactEmail = `contact-${run}@example.com`;

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  const code = page.getByRole("textbox", { name: "Code" });
  await expect(code).toBeVisible();
  await code.fill(await readSignInCode(email));
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("a firm collects a document from a client", async ({ browser }) => {
  const staff = await (await browser.newContext()).newPage();

  // 1. Staff signs up and creates a firm.
  await signIn(staff, staffEmail);
  await expect(staff).toHaveURL(/\/onboarding$/);
  await staff.getByRole("textbox", { name: "Firm name" }).fill("Ledger & Co");
  await staff.getByRole("textbox", { name: "Your full name" }).fill("Sam Staff");
  await staff.getByRole("button", { name: "Create firm" }).click();
  await expect(staff.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  // 2. Staff adds a client with one contact.
  await staff.getByRole("link", { name: "Clients" }).click();
  await staff.getByRole("button", { name: "New client" }).click();
  const clientDialog = staff.getByRole("dialog");
  await clientDialog.getByRole("textbox", { name: "Name", exact: true }).fill("Pat Client");
  await clientDialog.getByRole("button", { name: "Save" }).click();
  await expect(staff.getByRole("heading", { name: "Pat Client" })).toBeVisible();
  await staff.getByRole("button", { name: "Add contact" }).click();
  const contactDialog = staff.getByRole("dialog");
  await contactDialog.getByRole("textbox", { name: "Full name" }).fill("Pat Client");
  await contactDialog.getByRole("textbox", { name: "Email" }).fill(contactEmail);
  await contactDialog.getByRole("button", { name: "Add contact" }).click();
  await expect(staff.getByRole("cell", { name: contactEmail })).toBeVisible();

  // 3. Staff sends a request with one required item.
  await staff.getByRole("link", { name: "New request" }).click();
  await staff.getByRole("textbox", { name: "Title", exact: true }).fill("2026 tax documents");
  await staff.getByRole("button", { name: "Due date" }).click();
  await staff.getByRole("button", { name: "Go to the Next Month" }).click();
  await staff.getByRole("button", { name: /15th/ }).click();
  await staff.getByRole("button", { name: "Add item" }).click();
  await staff.getByRole("textbox", { name: "Item 1 title" }).fill("Photo ID");
  await staff.getByRole("button", { name: "Send", exact: true }).click();
  await expect(staff).toHaveURL(/\/app\/requests\/[0-9a-f-]{36}$/);
  await expect(staff.getByText("Open", { exact: true })).toBeVisible();
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:e2e`
Expected: FAIL at step 3, because `/app/requests/new` does not exist.

- [ ] **Step 3: Write the request editing test**

Two edits must happen in one transaction. Saving a draft replaces its items: as separate requests, a stale editor could replace the checklist of a request sent a moment earlier, and a failure could leave an empty draft. Removing an item must see a file a contact registers at the same moment. Create `supabase/tests/request_editing_test.sql`:

```sql
-- save_draft creates a draft, or replaces a draft's fields and items, in one
-- transaction. remove_item removes an untouched item from a sent request.
begin;
select plan(14);
\ir fixtures/seed.psql

create temp table new_draft (id uuid) on commit drop;
grant all on new_draft to authenticated;

select tests.login_as('00000000-0000-0000-0000-0000000000a2');

insert into new_draft
select public.save_draft('c0000000-0000-0000-0000-0000000000a1', 'New draft', current_date + 14,
  '[{"title": "W-2", "description": null, "kind": "file", "required": true}]');
select results_eq(
  $$ select r.status, r.title, r.created_by, (select count(*)::int from public.request_items i where i.request_id = r.id)
     from public.requests r where r.id = (select id from new_draft) $$,
  $$ values ('draft'::text, 'New draft'::text, '00000000-0000-0000-0000-0000000000a2'::uuid, 1) $$,
  'a new draft is created with its items and creator');

select lives_ok($$ select public.save_draft('c0000000-0000-0000-0000-0000000000a1', 'A1 draft v2', current_date + 21,
  '[{"title": "One", "description": null, "kind": "file", "required": true},
    {"title": "Two", "description": null, "kind": "text", "required": false}]',
  'd0000000-0000-0000-0000-0000000000a9') $$,
  'an existing draft can be saved');
select results_eq($$ select position, title from public.request_items
  where request_id = 'd0000000-0000-0000-0000-0000000000a9' order by position $$,
  $$ values (1, 'One'::text), (2, 'Two'::text) $$,
  'its items are replaced, in array order');
select throws_ok($$ select public.save_draft('c0000000-0000-0000-0000-0000000000a1', 'Broken', current_date,
  '[{"title": "", "description": null, "kind": "file", "required": true}]',
  'd0000000-0000-0000-0000-0000000000a9') $$,
  '23514', null, 'an invalid item fails the whole save');
select is((select title from public.requests where id = 'd0000000-0000-0000-0000-0000000000a9'),
  'A1 draft v2', 'and leaves the draft as it was');
select throws_ok($$ select public.save_draft('c0000000-0000-0000-0000-0000000000a1', 'Late', current_date, '[]',
  'd0000000-0000-0000-0000-0000000000a1') $$,
  'P0001', 'invalid_state', 'a sent request cannot be saved as a draft');
select throws_ok($$ select public.save_draft('c0000000-0000-0000-0000-0000000000b1', 'Other firm', current_date, '[]') $$,
  'P0001', 'not_allowed', 'staff cannot create a draft for another firm''s client');

select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select public.save_draft('c0000000-0000-0000-0000-0000000000a1', 'Contact', current_date, '[]') $$,
  'P0001', 'not_allowed', 'contacts cannot create drafts');
select throws_ok($$ select public.remove_item('10000000-0000-0000-0000-0000000000a4') $$,
  'P0001', 'not_allowed', 'contacts cannot remove items');

-- remove_item, as staff. Item a1 has a file; a4 is requested with none.
select tests.login_as('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.remove_item('10000000-0000-0000-0000-0000000000a4') $$,
  'P0001', 'not_allowed', 'staff cannot remove another firm''s item');
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$ select public.remove_item('10000000-0000-0000-0000-0000000000a1') $$,
  'P0001', 'invalid_state', 'an item with files cannot be removed');
reset role;
update public.request_items set status = 'submitted', text_answer = 'Yes'
where id = '10000000-0000-0000-0000-0000000000a3';
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$ select public.remove_item('10000000-0000-0000-0000-0000000000a3') $$,
  'P0001', 'invalid_state', 'a submitted item cannot be removed');
select is(public.remove_item('10000000-0000-0000-0000-0000000000a4'),
  'd0000000-0000-0000-0000-0000000000a1'::uuid, 'a requested item without files is removed; its request id is returned');
select is_empty($$ select 1 from public.request_items where id = '10000000-0000-0000-0000-0000000000a4' $$,
  'and the row is gone');

select * from finish();
rollback;
```

Run: `npx supabase db reset && npm run test:db`
Expected: FAIL: `request_editing_test.sql` reports `function public.save_draft(unknown, unknown, date, unknown) does not exist`.

- [ ] **Step 4: Add the migration**

Create `supabase/migrations/20260925000800_request_editing.sql`. Both functions run as the caller, so RLS applies. `save_draft` locks the request with its guarded update, so it waits for a `sendRequest` in flight and then fails with `invalid_state`. `remove_item` locks the item row that `register_file` also locks.

```sql
-- Request editing that must happen in one transaction.

-- Creates a draft, or replaces a draft's title, due date, and items, in one
-- transaction. The guarded update locks the request row and raises
-- invalid_state once the request has been sent, so a stale editor or two
-- saves at once never leave a mix of items. Security invoker: RLS applies to
-- every statement.
create function public.save_draft(
  client_id uuid,
  title text,
  due_date date,
  items jsonb,
  request_id uuid default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := save_draft.request_id;
  v_firm_id uuid;
begin
  if v_id is null then
    select c.firm_id into v_firm_id
    from public.clients c
    where c.id = save_draft.client_id
      and public.is_firm_member(c.firm_id);
    if not found then
      raise exception 'not_allowed';
    end if;

    insert into public.requests (firm_id, client_id, title, due_date, created_by)
    values (v_firm_id, save_draft.client_id, save_draft.title, save_draft.due_date, (select auth.uid()))
    returning id into v_id;
  else
    update public.requests r
    set title = save_draft.title, due_date = save_draft.due_date
    where r.id = v_id
      and r.status = 'draft'
    returning r.firm_id into v_firm_id;
    if not found then
      raise exception 'invalid_state';
    end if;

    delete from public.request_items i where i.request_id = v_id;
  end if;

  insert into public.request_items (request_id, firm_id, position, title, description, kind, required)
  select v_id, v_firm_id, e.position, e.item ->> 'title', e.item ->> 'description',
         e.item ->> 'kind', (e.item ->> 'required')::boolean
  from jsonb_array_elements(save_draft.items) with ordinality as e(item, position);

  return v_id;
end;
$$;

revoke execute on function public.save_draft(uuid, text, date, jsonb, uuid) from public, anon;

-- Removes an item from a sent request. Allowed only while the item is
-- `requested`, has no files, and the request is open or completed. Locking the
-- item row first means a file that register_file is adding at the same moment
-- (it locks the same row) is either seen here or waits for the delete.
-- Security invoker: RLS applies. Returns the request id.
create function public.remove_item(item_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_request_id uuid;
  v_status text;
  v_request_status text;
begin
  select i.request_id, i.status, r.status
  into v_request_id, v_status, v_request_status
  from public.request_items i
  join public.requests r on r.id = i.request_id
  where i.id = remove_item.item_id
  for update of i;

  if not found then
    raise exception 'not_allowed';
  end if;
  if v_request_status not in ('open', 'completed')
     or v_status <> 'requested'
     or exists (select 1 from public.item_files f where f.item_id = remove_item.item_id) then
    raise exception 'invalid_state';
  end if;

  delete from public.request_items i where i.id = remove_item.item_id;
  return v_request_id;
end;
$$;

revoke execute on function public.remove_item(uuid) from public, anon;
```

Run: `npx supabase db reset && npm run test:db && npm run db:types`
Expected: `Files=14, Tests=193`, `Result: PASS`; `lib/database.types.ts` gains `save_draft` and `remove_item`.

- [ ] **Step 5: Add the actions**

Create `app/app/requests/actions.ts`. Rules it enforces, from spec section 7.3:
- `saveDraft` calls `save_draft`, which replaces a draft's title, due date, and items in one transaction and refuses a sent request.
- `sendRequest` needs at least one required item. Its guarded update (`draft` to `open`) makes a double click harmless. Reply-to is the sender.
- `updateRequestDetails` and `addItem` work only on `open` or `completed` requests. A new required item reopens a completed request through the trigger.
- `removeItem` calls `remove_item`: only while the item is `requested` and has no files.
- `acceptItem` accepts from any state except `accepted`, which covers paper copies. `returnItem` needs a note and works from `submitted` or `accepted`; it emails every contact with reply-to set to the reviewer. Both work only while the request is open or completed: a closed request's portal is read-only, so its contacts could not act on a note.
- Ids from the browser go through `isId()`. A failed contacts or firm query stops `sendRequest` and `returnItem` before any change, instead of sending to nobody.
- `sendRequest` and `returnItem` build their emails before the guarded update, so a configuration error (for example a missing `NEXT_PUBLIC_SITE_URL`) changes nothing.
- `setRequestArchived(…, false)` reopens and then calls `refresh_request_status`.

```ts
"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { MAX_ITEMS_PER_REQUEST } from "@/lib/constants";
import { sendEmails } from "@/lib/email/send";
import { needsChangesEmail, requestSentEmail } from "@/lib/email/templates";
import { fail, invalid, notFound, staleState, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { draftSchema, isId, itemSchema, requestDetailsSchema, reviewNoteSchema } from "@/lib/validation";

/**
 * Creates a draft, or replaces a draft's fields and items, in one transaction
 * (`save_draft`). A sent request fails with `invalid_state` and is not touched.
 */
export async function saveDraft(input: z.input<typeof draftSchema>): Promise<ActionResult<{ id: string }>> {
  await requireStaff();
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { requestId, clientId, title, dueDate, items } = parsed.data;

  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("save_draft", {
    client_id: clientId,
    title,
    due_date: dueDate,
    items,
    request_id: requestId,
  });
  if (error) return fail(error);

  revalidatePath(`/app/requests/${id}`);
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true, data: { id } };
}

/** Accept and return work only while the request is open or completed. */
function isReviewable(status: string | undefined) {
  return status === "open" || status === "completed";
}

/** Section 10.4. The guarded update makes a double click harmless. */
export async function sendRequest(requestId: string): Promise<ActionResult<{ contacts: number }>> {
  const staff = await requireStaff();
  if (!isId(requestId)) return fail(notFound);
  const supabase = await createClient();
  const { data: request, error: requestError } = await supabase
    .from("requests")
    .select("id, title, due_date, client_id, request_items(required)")
    .eq("id", requestId)
    .eq("firm_id", staff.firmId)
    .maybeSingle();
  if (requestError) return fail(requestError);
  if (!request) return fail(notFound);
  if (!request.request_items.some((item) => item.required)) {
    return { ok: false, error: "Add at least one required item before sending." };
  }

  // Build the emails before changing anything, so a configuration error leaves the draft as is.
  const [contacts, firm] = await Promise.all([
    supabase.from("client_contacts").select("email").eq("client_id", request.client_id),
    supabase.from("firms").select("name").eq("id", staff.firmId).single(),
  ]);
  if (contacts.error) return fail(contacts.error);
  if (firm.error) return fail(firm.error);
  const firmName = firm.data.name;
  const content = requestSentEmail({
    firmName,
    title: request.title,
    dueDate: request.due_date,
    itemCount: request.request_items.length,
    requestId,
  });
  const messages = contacts.data.map((c) => ({ ...content, to: c.email, fromName: firmName, replyTo: staff.email }));

  const { data: sent, error } = await supabase
    .from("requests")
    .update({ status: "open", sent_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("firm_id", staff.firmId)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();
  if (error) return fail(error);
  if (!sent) return fail(staleState);

  after(() => sendEmails(messages));

  revalidatePath(`/app/requests/${requestId}`);
  revalidatePath(`/app/clients/${request.client_id}`);
  return { ok: true, data: { contacts: messages.length } };
}

export async function deleteDraft(requestId: string): Promise<ActionResult> {
  const staff = await requireStaff();
  if (!isId(requestId)) return fail(notFound);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("requests")
    .delete()
    .eq("id", requestId)
    .eq("firm_id", staff.firmId)
    .eq("status", "draft")
    .select("client_id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return fail(staleState);

  redirect(`/app/clients/${data.client_id}`);
}

/** Title and due date of a sent request (drafts use saveDraft). */
export async function updateRequestDetails(
  requestId: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const staff = await requireStaff();
  if (!isId(requestId)) return fail(notFound);
  const parsed = requestDetailsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("requests")
    .update({ title: parsed.data.title, due_date: parsed.data.dueDate })
    .eq("id", requestId)
    .eq("firm_id", staff.firmId)
    .in("status", ["open", "completed"])
    .select("id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return fail(staleState);

  revalidatePath(`/app/requests/${requestId}`);
  return { ok: true };
}

/** Adds an item to a sent request. A required item reopens a completed request (trigger). */
export async function addItem(requestId: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const staff = await requireStaff();
  if (!isId(requestId)) return fail(notFound);
  const parsed = itemSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    kind: formData.get("kind"),
    required: formData.get("required") === "on",
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data: request, error: requestError } = await supabase
    .from("requests")
    .select("status, request_items(position)")
    .eq("id", requestId)
    .eq("firm_id", staff.firmId)
    .maybeSingle();
  if (requestError) return fail(requestError);
  if (!request) return fail(notFound);
  if (request.status !== "open" && request.status !== "completed") return fail(staleState);
  if (request.request_items.length >= MAX_ITEMS_PER_REQUEST) {
    return { ok: false, error: `A request can have at most ${MAX_ITEMS_PER_REQUEST} items.` };
  }

  const position = Math.max(0, ...request.request_items.map((item) => item.position)) + 1;
  const { error } = await supabase
    .from("request_items")
    .insert({ ...parsed.data, request_id: requestId, firm_id: staff.firmId, position });
  if (error) return fail(error);

  revalidatePath(`/app/requests/${requestId}`);
  return { ok: true };
}

/**
 * Allowed only while the item is `requested`, has no files, and the request is open or
 * completed. `remove_item` checks and deletes under one row lock, so a file a contact is
 * registering at the same moment is never deleted with the item.
 */
export async function removeItem(itemId: string): Promise<ActionResult> {
  await requireStaff();
  if (!isId(itemId)) return fail(notFound);
  const supabase = await createClient();
  const { data: requestId, error } = await supabase.rpc("remove_item", { item_id: itemId });
  if (error) return fail(error);

  revalidatePath(`/app/requests/${requestId}`);
  return { ok: true };
}

/** Staff may accept an item in any state except accepted (paper copies count). */
export async function acceptItem(itemId: string): Promise<ActionResult> {
  const staff = await requireStaff();
  if (!isId(itemId)) return fail(notFound);
  const supabase = await createClient();
  const { data: item, error: itemError } = await supabase
    .from("request_items")
    .select("requests(status)")
    .eq("id", itemId)
    .eq("firm_id", staff.firmId)
    .maybeSingle();
  if (itemError) return fail(itemError);
  if (!item) return fail(notFound);
  if (!isReviewable(item.requests?.status)) return fail(staleState);

  const { data, error } = await supabase
    .from("request_items")
    .update({
      status: "accepted",
      review_note: null,
      reviewed_by: staff.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .eq("firm_id", staff.firmId)
    .neq("status", "accepted")
    .select("request_id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return fail(staleState);

  revalidatePath(`/app/requests/${data.request_id}`);
  return { ok: true };
}

/** Returns a submitted or accepted item with a note, then emails the client's contacts. */
export async function returnItem(itemId: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const staff = await requireStaff();
  if (!isId(itemId)) return fail(notFound);
  const note = reviewNoteSchema.safeParse(formData.get("note"));
  if (!note.success) return invalid(note.error);

  const supabase = await createClient();
  const { data: item, error: itemError } = await supabase
    .from("request_items")
    .select("title, request_id, requests(client_id, status)")
    .eq("id", itemId)
    .eq("firm_id", staff.firmId)
    .maybeSingle();
  if (itemError) return fail(itemError);
  if (!item?.requests) return fail(notFound);
  // A closed request's portal is read-only, so its contacts could not act on the note.
  if (!isReviewable(item.requests.status)) return fail(staleState);

  // Build the emails before changing anything, so a configuration error leaves the item as is.
  const [contacts, firm] = await Promise.all([
    supabase.from("client_contacts").select("email").eq("client_id", item.requests.client_id),
    supabase.from("firms").select("name").eq("id", staff.firmId).single(),
  ]);
  if (contacts.error) return fail(contacts.error);
  if (firm.error) return fail(firm.error);
  const firmName = firm.data.name;
  const content = needsChangesEmail({ firmName, itemTitle: item.title, note: note.data, requestId: item.request_id });
  const messages = contacts.data.map((c) => ({ ...content, to: c.email, fromName: firmName, replyTo: staff.email }));

  const { data: returned, error } = await supabase
    .from("request_items")
    .update({
      status: "needs_changes",
      review_note: note.data,
      reviewed_by: staff.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .eq("firm_id", staff.firmId)
    .in("status", ["submitted", "accepted"])
    .select("id")
    .maybeSingle();
  if (error) return fail(error);
  if (!returned) return fail(staleState);

  after(() => sendEmails(messages));

  revalidatePath(`/app/requests/${item.request_id}`);
  return { ok: true };
}

/** Archive stops reminders. Unarchive reopens, then recomputes the status. */
export async function setRequestArchived(requestId: string, archived: boolean): Promise<ActionResult> {
  const staff = await requireStaff();
  if (!isId(requestId) || typeof archived !== "boolean") return fail(notFound);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("requests")
    .update({ status: archived ? "archived" : "open" })
    .eq("id", requestId)
    .eq("firm_id", staff.firmId)
    .in("status", archived ? ["open", "completed"] : ["archived"])
    .select("id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return fail(staleState);

  if (!archived) {
    const { error: refreshError } = await supabase.rpc("refresh_request_status", { request_id: requestId });
    if (refreshError) return fail(refreshError);
  }

  revalidatePath(`/app/requests/${requestId}`);
  return { ok: true };
}
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck`
Expected: no errors.

---

## Task 2: Request editor and "New request"

**Files:**
- Create: `components/date-picker.tsx`, `app/app/requests/request-editor.tsx`, `app/app/requests/new/page.tsx`

- [ ] **Step 1: Add the date picker**

Create `components/date-picker.tsx`. It converts with `toDateString()` and `fromDateString()` from `lib/dates.ts`, which use the local calendar day, so the picked date is the date that gets saved in any time zone. With `name`, it also submits the value through a hidden input. The calendar is `required`, so clicking the picked day again does not clear it.

```tsx
"use client";

import { useLayoutEffect, useState } from "react";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDate, fromDateString, toDateString } from "@/lib/dates";

/** Picks a YYYY-MM-DD date. With `name`, also submits it in a form. */
export function DatePicker({
  id,
  name,
  value,
  onChange,
}: {
  id?: string;
  name?: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  // Next keeps visited pages mounted but hidden; close so Back and Forward never return to it open.
  useLayoutEffect(() => () => setOpen(false), []);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button id={id} type="button" variant="outline" className="w-full justify-start font-normal">
            <CalendarIcon />
            {value ? formatDate(value) : "Pick a date"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            required
            selected={value ? fromDateString(value) : undefined}
            onSelect={(date) => {
              onChange(date ? toDateString(date) : null);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {name && <input type="hidden" name={name} value={value ?? ""} />}
    </>
  );
}
```

- [ ] **Step 2: Add the request editor**

Create `app/app/requests/request-editor.tsx`. Notes:
- It calls the actions directly inside `useTransition`, because it sends structured data (the item list) rather than a flat form.
- "Send" saves first, then sends.
- Field ids come from `useId()`, because a new-request page and several draft pages can be mounted (hidden) at the same time.
- Next keeps the "New request" page mounted after you leave it. After creating a request, the editor clears its state and navigates in the same transition, so the next visit starts blank and the old form never flashes empty.
- An unexpected error while saving shows a toast and keeps the unsaved work on screen.

```tsx
"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DatePicker } from "@/components/date-picker";
import { ItemEditor } from "@/components/item-editor";
import { LIMITS } from "@/lib/constants";
import { newEditorItem, toItemInputs, type EditorItem } from "@/lib/editor-items";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deleteDraft, saveDraft, sendRequest } from "./actions";

export type TemplateOption = {
  id: string;
  name: string;
  items: { title: string; description: string | null; kind: string; required: boolean }[];
};

/** Editor for a new request or a draft. Everything is editable until the request is sent. */
export function RequestEditor({
  clientId,
  requestId,
  initial,
  templates = [],
}: {
  clientId: string;
  requestId?: string;
  initial: { title: string; dueDate: string | null; items: EditorItem[] };
  templates?: TemplateOption[];
}) {
  const router = useRouter();
  const id = useId();
  const [templateId, setTemplateId] = useState("blank");
  const [title, setTitle] = useState(initial.title);
  const [dueDate, setDueDate] = useState(initial.dueDate);
  const [items, setItems] = useState(initial.items);
  const [pending, startTransition] = useTransition();

  function applyTemplate(value: string) {
    setTemplateId(value);
    const template = templates.find((t) => t.id === value);
    setItems(template ? template.items.map((item) => newEditorItem(item)) : []);
    if (template && !title) setTitle(template.name);
  }

  function save(send: boolean) {
    startTransition(async () => {
      try {
        const saved = await saveDraft({ requestId, clientId, title, dueDate: dueDate ?? "", items: toItemInputs(items) });
        if (!saved.ok) {
          toast.error(saved.error);
          return;
        }
        const savedId = saved.data!.id;
        if (send) {
          const sent = await sendRequest(savedId);
          if (!sent.ok) toast.error(sent.error);
          else if (sent.data?.contacts) toast.success("Request sent.");
          else toast.warning("Request sent, but this client has no contacts yet. Add one so they can sign in.");
        } else {
          toast.success("Draft saved.");
        }
        if (!requestId) {
          // Next keeps this page mounted (hidden) after navigating, so clear the form
          // for the next visit. One transition, so the old form stays until the new page shows.
          startTransition(() => {
            setTemplateId("blank");
            setTitle("");
            setDueDate(null);
            setItems([]);
            router.push(`/app/requests/${savedId}`);
          });
        }
      } catch (error) {
        // Keep the unsaved work on screen rather than replacing the page with the error boundary.
        console.error(error);
        toast.error("Something went wrong. Check your connection and try again.");
      }
    });
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {templates.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-template`}>Start from</Label>
          <Select value={templateId} onValueChange={applyTemplate}>
            <SelectTrigger id={`${id}-template`} className="w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="blank">Start blank</SelectItem>
              {templates.map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  {template.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-[1fr_16rem]">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-title`}>Title</Label>
          <Input id={`${id}-title`} value={title} maxLength={LIMITS.name} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-due-date`}>Due date</Label>
          <DatePicker id={`${id}-due-date`} value={dueDate} onChange={setDueDate} />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Items</h2>
        <ItemEditor items={items} onChange={setItems} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={pending} onClick={() => save(false)}>
          Save draft
        </Button>
        <Button type="button" disabled={pending} onClick={() => save(true)}>
          Send
        </Button>
        {requestId && <DeleteDraftButton requestId={requestId} />}
      </div>
    </div>
  );
}

function DeleteDraftButton({ requestId }: { requestId: string }) {
  async function remove() {
    const result = await deleteDraft(requestId);
    if (!result.ok) toast.error(result.error);
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost">
          Delete draft
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 3: Add the new request page**

Create `app/app/requests/new/page.tsx`. Template items are copied into the editor. Saving creates `request_items` rows, so later template edits never change this request (spec section 7.2). The editor is keyed by client: Next keeps this page mounted without its search params, so an unsaved request for one client must not carry over to the next client's New request.

```tsx
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isId } from "@/lib/validation";
import { RequestEditor } from "../request-editor";

export default function NewRequestPage({ searchParams }: PageProps<"/app/requests/new">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <NewRequest searchParams={searchParams} />
    </Suspense>
  );
}

async function NewRequest({ searchParams }: Pick<PageProps<"/app/requests/new">, "searchParams">) {
  const { client: clientId } = await searchParams;
  if (!isId(clientId)) notFound();

  const staff = await requireStaff();
  const supabase = await createClient();
  const [clientResult, templates] = await Promise.all([
    supabase.from("clients").select("id, name").eq("id", clientId).eq("firm_id", staff.firmId).maybeSingle(),
    supabase
      .from("templates")
      .select("id, name, template_items(title, description, kind, required, position)")
      .eq("firm_id", staff.firmId)
      .order("name")
      .order("position", { referencedTable: "template_items" })
      .order("id", { referencedTable: "template_items" }),
  ]);
  if (clientResult.error) throw clientResult.error;
  if (templates.error) throw templates.error;
  const client = clientResult.data;
  if (!client) notFound();

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">New request</h1>
        <p className="text-sm text-muted-foreground">
          For{" "}
          <Link className="underline-offset-4 hover:underline" href={`/app/clients/${client.id}`}>
            {client.name}
          </Link>
        </p>
      </div>
      {/* Keyed by client: Next keeps this page mounted without its search params, so an
          unsaved request for one client must not carry over to another. */}
      <RequestEditor
        key={client.id}
        clientId={client.id}
        initial={{ title: "", dueDate: null, items: [] }}
        templates={templates.data.map((t) => ({ id: t.id, name: t.name, items: t.template_items }))}
      />
    </>
  );
}
```

- [ ] **Step 4: Run the test**

Run: `npm run test:e2e`
Expected: still FAIL, but later: after "Send" the URL is `/app/requests/<uuid>`, and the test waits for the "Open" badge because that page does not exist yet.

---

## Task 3: Request page and review view

**Files:**
- Create: `app/app/requests/[id]/request-actions.tsx`, `app/app/requests/[id]/review-items.tsx`, `app/app/requests/[id]/page.tsx`

- [ ] **Step 1: Add the header actions**

Create `app/app/requests/[id]/request-actions.tsx`. "Download all (.zip)" links to the route that Phase 7 adds. Its dialogs close when Next hides the page, and "Edit details" starts from the saved due date each time it opens.

```tsx
"use client";

import { useActionState, useId, useLayoutEffect, useState } from "react";
import { Download, Plus } from "lucide-react";
import { toast } from "sonner";
import { ActionButton } from "@/components/action-button";
import { DatePicker } from "@/components/date-picker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { LIMITS } from "@/lib/constants";
import type { ActionResult } from "@/lib/errors";
import { submitKeepingValues } from "@/lib/forms";
import { addItem, setRequestArchived, updateRequestDetails } from "../actions";

/** Header actions for a sent request. */
export function RequestActions({
  requestId,
  title,
  dueDate,
  status,
}: {
  requestId: string;
  title: string;
  dueDate: string;
  status: string;
}) {
  const archived = status === "archived";

  return (
    <div className="flex flex-wrap gap-2">
      {!archived && <EditDetailsDialog requestId={requestId} title={title} dueDate={dueDate} />}
      {!archived && <AddItemDialog requestId={requestId} />}
      <Button variant="outline" asChild>
        <a href={`/api/requests/${requestId}/zip`} download>
          <Download />
          Download all (.zip)
        </a>
      </Button>
      <ActionButton
        variant="outline"
        action={() => setRequestArchived(requestId, !archived)}
        success={archived ? "Request unarchived." : "Request archived. Reminders have stopped."}
      >
        {archived ? "Unarchive" : "Archive"}
      </ActionButton>
    </div>
  );
}

function useDialogAction(action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>, success: string) {
  const [open, setOpen] = useState(false);
  // Next keeps visited pages mounted but hidden; close so Back and Forward never return to an open dialog.
  useLayoutEffect(() => () => setOpen(false), []);
  const [, formAction, pending] = useActionState(async (prev: ActionResult | null, formData: FormData) => {
    const result = await action(prev, formData);
    if (result.ok) {
      toast.success(success);
      setOpen(false);
    } else {
      toast.error(result.error);
    }
    return result;
  }, null);
  return { open, setOpen, formAction, pending };
}

function EditDetailsDialog({ requestId, title, dueDate }: { requestId: string; title: string; dueDate: string }) {
  const { open, setOpen, formAction, pending } = useDialogAction(
    updateRequestDetails.bind(null, requestId),
    "Request updated.",
  );
  const [date, setDate] = useState<string | null>(dueDate);
  const id = useId();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Start from the saved date each time, not one picked and then cancelled.
        if (next) setDate(dueDate);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">Edit details</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit request</DialogTitle>
        </DialogHeader>
        <form onSubmit={submitKeepingValues(formAction)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-title`}>Title</Label>
            <Input id={`${id}-title`} name="title" defaultValue={title} maxLength={LIMITS.name} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-due`}>Due date</Label>
            <DatePicker id={`${id}-due`} name="dueDate" value={date} onChange={setDate} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddItemDialog({ requestId }: { requestId: string }) {
  const { open, setOpen, formAction, pending } = useDialogAction(addItem.bind(null, requestId), "Item added.");
  const id = useId();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus />
          Add item
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add item</DialogTitle>
        </DialogHeader>
        <form onSubmit={submitKeepingValues(formAction)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-title`}>Title</Label>
            <Input id={`${id}-title`} name="title" maxLength={LIMITS.name} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-description`}>Details (optional)</Label>
            <Textarea id={`${id}-description`} name="description" maxLength={LIMITS.description} rows={3} />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Select name="kind" defaultValue="file">
              <SelectTrigger aria-label="Item type" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="file">File upload</SelectItem>
                <SelectItem value="text">Written answer</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Checkbox id={`${id}-required`} name="required" defaultChecked />
              <Label htmlFor={`${id}-required`}>Required</Label>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              Add item
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Add the review list and Sheet**

Create `app/app/requests/[id]/review-items.tsx`. File links go through `/api/files/[id]` (Phase 6): "Open" in a new tab, "Download" with `?download=1`. "Accept", "Needs changes", and "Remove item" appear only when section 7.3 allows them, and the Sheet closes when Next hides the page.

```tsx
"use client";

import { useActionState, useId, useLayoutEffect, useState } from "react";
import { toast } from "sonner";
import { ActionButton } from "@/components/action-button";
import { ItemStatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { LIMITS } from "@/lib/constants";
import { formatDateTime } from "@/lib/dates";
import type { ActionResult } from "@/lib/errors";
import { submitKeepingValues } from "@/lib/forms";
import { acceptItem, removeItem, returnItem } from "../actions";

export type ReviewItem = {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  required: boolean;
  status: string;
  textAnswer: string | null;
  reviewNote: string | null;
  submittedAt: string | null;
  files: { id: string; filename: string; sizeBytes: number }[];
};

export function ReviewItems({ items, editable }: { items: ReviewItem[]; editable: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  // Next keeps visited pages mounted but hidden; close so Back and Forward never return to an open Sheet.
  useLayoutEffect(() => () => setOpenId(null), []);
  const selected = items.find((item) => item.id === openId);

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Files</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, index) => (
              <TableRow key={item.id} className="cursor-pointer" onClick={() => setOpenId(item.id)}>
                <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                <TableCell>
                  <button type="button" className="text-left font-medium underline-offset-4 hover:underline">
                    {item.title}
                  </button>
                  {!item.required && <span className="ml-2 text-xs text-muted-foreground">Optional</span>}
                </TableCell>
                <TableCell>
                  <ItemStatusBadge status={item.status} />
                </TableCell>
                <TableCell className="text-right">{item.kind === "file" ? item.files.length : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Sheet open={selected !== undefined} onOpenChange={(open) => !open && setOpenId(null)}>
        <SheetContent className="overflow-y-auto">
          {selected && <ItemDetails item={selected} editable={editable} onRemoved={() => setOpenId(null)} />}
        </SheetContent>
      </Sheet>
    </>
  );
}

function ItemDetails({ item, editable, onRemoved }: { item: ReviewItem; editable: boolean; onRemoved: () => void }) {
  const canAccept = editable && item.status !== "accepted";
  const canReturn = editable && (item.status === "submitted" || item.status === "accepted");
  const canRemove = editable && item.status === "requested" && item.files.length === 0;

  return (
    <div className="flex flex-col gap-6 p-4">
      <SheetHeader className="p-0">
        <SheetTitle>{item.title}</SheetTitle>
        <SheetDescription>
          {item.required ? "Required" : "Optional"} · {item.kind === "file" ? "File upload" : "Written answer"}
        </SheetDescription>
      </SheetHeader>
      <div className="flex items-center gap-2">
        <ItemStatusBadge status={item.status} />
        {item.submittedAt && (
          <span className="text-sm text-muted-foreground">Submitted {formatDateTime(item.submittedAt)}</span>
        )}
      </div>
      {item.description && <p className="whitespace-pre-wrap text-sm">{item.description}</p>}
      {item.kind === "text" && (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">Answer</h3>
          <p className="whitespace-pre-wrap text-sm">{item.textAnswer ?? "No answer yet."}</p>
        </div>
      )}
      {item.kind === "file" && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Files</h3>
          {item.files.length === 0 && <p className="text-sm text-muted-foreground">No files yet.</p>}
          {item.files.map((file) => (
            <div key={file.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{file.filename}</span>
              <span className="flex shrink-0 gap-3">
                <a className="underline" href={`/api/files/${file.id}`} target="_blank" rel="noopener noreferrer">
                  Open
                </a>
                <a className="underline" href={`/api/files/${file.id}?download=1`}>
                  Download
                </a>
              </span>
            </div>
          ))}
        </div>
      )}
      {item.reviewNote && (
        <Alert>
          <AlertTitle>Review note</AlertTitle>
          <AlertDescription className="whitespace-pre-wrap">{item.reviewNote}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col gap-4 border-t pt-4">
        {canAccept && (
          <ActionButton action={() => acceptItem(item.id)} success="Item accepted.">
            Accept
          </ActionButton>
        )}
        {canReturn && <NeedsChangesForm itemId={item.id} />}
        {canRemove && (
          <ActionButton
            variant="ghost"
            action={async () => {
              const result = await removeItem(item.id);
              if (result.ok) onRemoved();
              return result;
            }}
            success="Item removed."
          >
            Remove item
          </ActionButton>
        )}
      </div>
    </div>
  );
}

function NeedsChangesForm({ itemId }: { itemId: string }) {
  const id = useId();
  const [, formAction, pending] = useActionState(async (prev: ActionResult | null, formData: FormData) => {
    const result = await returnItem(itemId, prev, formData);
    if (result.ok) toast.success("Returned to the client with your note.");
    else toast.error(result.error);
    return result;
  }, null);

  return (
    <form onSubmit={submitKeepingValues(formAction)} className="flex flex-col gap-2">
      <Label htmlFor={`${id}-note`}>What needs to change?</Label>
      <Textarea id={`${id}-note`} name="note" maxLength={LIMITS.reviewNote} rows={3} required />
      <Button type="submit" variant="outline" disabled={pending}>
        Needs changes
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: Add the request page**

Create `app/app/requests/[id]/page.tsx`. Two things to keep:
- Pass `select()` one string literal. A template literal across lines is fine; joining strings with `+` makes the argument a plain `string`, and supabase-js then types the result as an error.
- Embedded rows are ordered with `referencedTable` (`request_items` by `position`, then `id`; files by `created_at`).

```tsx
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RequestStatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/dates";
import { newEditorItem } from "@/lib/editor-items";
import { createClient } from "@/lib/supabase/server";
import { isId } from "@/lib/validation";
import { RequestEditor } from "../request-editor";
import { RequestActions } from "./request-actions";
import { ReviewItems } from "./review-items";

export default function RequestPage({ params }: PageProps<"/app/requests/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Request params={params} />
    </Suspense>
  );
}

async function Request({ params }: Pick<PageProps<"/app/requests/[id]">, "params">) {
  const { id } = await params;
  if (!isId(id)) notFound();
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data: request, error } = await supabase
    .from("requests")
    .select(
      `id, title, status, due_date, sent_at, client_id, clients(name),
       request_items(id, position, title, description, kind, required, status, text_answer, review_note, submitted_at,
         item_files(id, filename, size_bytes, created_at))`,
    )
    .eq("id", id)
    .eq("firm_id", staff.firmId)
    .order("position", { referencedTable: "request_items" })
    .order("id", { referencedTable: "request_items" })
    .order("created_at", { referencedTable: "request_items.item_files" })
    .maybeSingle();
  if (error) throw error;
  if (!request) notFound();

  const clientLink = (
    <Link className="underline-offset-4 hover:underline" href={`/app/clients/${request.client_id}`}>
      {request.clients?.name}
    </Link>
  );

  if (request.status === "draft") {
    return (
      <>
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            Draft request <RequestStatusBadge status="draft" />
          </h1>
          <p className="text-sm text-muted-foreground">For {clientLink}</p>
        </div>
        <RequestEditor
          clientId={request.client_id}
          requestId={request.id}
          initial={{
            title: request.title,
            dueDate: request.due_date,
            items: request.request_items.map((item) => newEditorItem(item)),
          }}
        />
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            {request.title} <RequestStatusBadge status={request.status} />
          </h1>
          <p className="text-sm text-muted-foreground">
            For {clientLink} · Due {formatDate(request.due_date)}
            {request.sent_at && ` · Sent ${formatDateTime(request.sent_at)}`}
          </p>
        </div>
        <RequestActions
          requestId={request.id}
          title={request.title}
          dueDate={request.due_date}
          status={request.status}
        />
      </div>
      <ReviewItems
        editable={request.status === "open" || request.status === "completed"}
        items={request.request_items.map((item) => ({
          id: item.id,
          title: item.title,
          description: item.description,
          kind: item.kind,
          required: item.required,
          status: item.status,
          textAnswer: item.text_answer,
          reviewNote: item.review_note,
          submittedAt: item.submitted_at,
          files: item.item_files.map((file) => ({ id: file.id, filename: file.filename, sizeBytes: file.size_bytes })),
        }))}
      />
    </>
  );
}
```

- [ ] **Step 4: Run the test to make sure it passes**

Run: `npm run test:e2e`
Expected: PASS, `1 passed`. If `npm run dev` is already running in another terminal, Playwright reuses it, and that terminal shows `[email] to=contact-…@example.com subject="Ledger & Co needs documents from you: 2026 tax documents"`.

- [ ] **Step 5: Check the rest by hand**

With `npm run dev` running, as staff:
1. Create a client with no contacts. Choose "New request", pick "Annual tax return (starter)" under "Start from" (the title fills in), pick a due date, and click "Save draft". Expected: toast "Draft saved." and the URL changes to `/app/requests/<id>`, showing the draft editor with 7 items.
2. Click "Delete draft", then "Delete". Expected: back on the client page, and the draft is gone.
3. Create another request with one item and click "Send". Expected: toast "Request sent, but this client has no contacts yet. Add one so they can sign in."
4. "Add item" titled "Receipts". Expected: toast "Item added." Open "Receipts" and click "Remove item". Expected: toast "Item removed." and the row disappears.
5. "Edit details", change the title, "Save". Expected: toast "Request updated." and the new title.
6. "Archive". Expected: the badge shows "Archived". "Unarchive". Expected: the badge shows "Open".

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all succeed.

```bash
git add -A
git commit -m "feat: add request editor, sending, and item review"
```
