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
- Modify: `e2e/happy-path.spec.ts`
- Create: `app/app/requests/actions.ts`

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

- [ ] **Step 3: Add the actions**

Create `app/app/requests/actions.ts`. Rules it enforces, from spec section 7.3:
- `saveDraft` replaces a draft's title, due date, and items; the guarded update on `status = 'draft'` stops it from touching a sent request.
- `sendRequest` needs at least one required item. Its guarded update (`draft` to `open`) makes a double click harmless. Reply-to is the sender.
- `updateRequestDetails` and `addItem` work only on `open` or `completed` requests. A new required item reopens a completed request through the trigger.
- `removeItem` works only while the item is `requested` and has no files.
- `acceptItem` accepts from any state except `accepted`, which covers paper copies. `returnItem` needs a note and works from `submitted` or `accepted`; it emails every contact with reply-to set to the reviewer.
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
import { draftSchema, itemSchema, requestDetailsSchema, reviewNoteSchema } from "@/lib/validation";

/** Creates a draft, or replaces a draft's fields and items. */
export async function saveDraft(input: z.input<typeof draftSchema>): Promise<ActionResult<{ id: string }>> {
  const staff = await requireStaff();
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { requestId, clientId, title, dueDate, items } = parsed.data;
  const supabase = await createClient();

  let id = requestId;
  if (id) {
    const { data, error } = await supabase
      .from("requests")
      .update({ title, due_date: dueDate })
      .eq("id", id)
      .eq("firm_id", staff.firmId)
      .eq("status", "draft")
      .select("id")
      .maybeSingle();
    if (error) return fail(error);
    if (!data) return fail(staleState);
    const { error: deleteError } = await supabase.from("request_items").delete().eq("request_id", id);
    if (deleteError) return fail(deleteError);
  } else {
    const { data, error } = await supabase
      .from("requests")
      .insert({ firm_id: staff.firmId, client_id: clientId, title, due_date: dueDate, created_by: staff.userId })
      .select("id")
      .single();
    if (error) return fail(error);
    id = data.id;
  }

  if (items.length > 0) {
    const requestIdForItems = id;
    const { error } = await supabase.from("request_items").insert(
      items.map((item, index) => ({
        ...item,
        request_id: requestIdForItems,
        firm_id: staff.firmId,
        position: index + 1,
      })),
    );
    if (error) return fail(error);
  }

  revalidatePath(`/app/requests/${id}`);
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true, data: { id } };
}

/** Section 10.4. The guarded update makes a double click harmless. */
export async function sendRequest(requestId: string): Promise<ActionResult<{ contacts: number }>> {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data: request } = await supabase
    .from("requests")
    .select("id, title, due_date, client_id, request_items(required)")
    .eq("id", requestId)
    .eq("firm_id", staff.firmId)
    .maybeSingle();
  if (!request) return fail(notFound);
  if (!request.request_items.some((item) => item.required)) {
    return { ok: false, error: "Add at least one required item before sending." };
  }

  // Build the emails before changing anything, so a configuration error leaves the draft as is.
  const [{ data: contacts }, { data: firm }] = await Promise.all([
    supabase.from("client_contacts").select("email").eq("client_id", request.client_id),
    supabase.from("firms").select("name").eq("id", staff.firmId).single(),
  ]);
  const firmName = firm?.name ?? "";
  const content = requestSentEmail({
    firmName,
    title: request.title,
    dueDate: request.due_date,
    itemCount: request.request_items.length,
    requestId,
  });
  const messages = (contacts ?? []).map((c) => ({ ...content, to: c.email, fromName: firmName, replyTo: staff.email }));

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
  const parsed = itemSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    kind: formData.get("kind"),
    required: formData.get("required") === "on",
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data: request } = await supabase
    .from("requests")
    .select("status, request_items(position)")
    .eq("id", requestId)
    .eq("firm_id", staff.firmId)
    .maybeSingle();
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

/** Allowed only while the item is `requested`, has no files, and the request is open or completed. */
export async function removeItem(itemId: string): Promise<ActionResult> {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data: item } = await supabase
    .from("request_items")
    .select("request_id, status, requests(status), item_files(id)")
    .eq("id", itemId)
    .eq("firm_id", staff.firmId)
    .maybeSingle();
  if (!item) return fail(notFound);
  const requestOpen = item.requests?.status === "open" || item.requests?.status === "completed";
  if (!requestOpen || item.status !== "requested" || item.item_files.length > 0) return fail(staleState);

  const { data, error } = await supabase
    .from("request_items")
    .delete()
    .eq("id", itemId)
    .eq("status", "requested")
    .select("id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return fail(staleState);

  revalidatePath(`/app/requests/${item.request_id}`);
  return { ok: true };
}

/** Staff may accept an item in any state except accepted (paper copies count). */
export async function acceptItem(itemId: string): Promise<ActionResult> {
  const staff = await requireStaff();
  const supabase = await createClient();
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
  const note = reviewNoteSchema.safeParse(formData.get("note"));
  if (!note.success) return invalid(note.error);

  const supabase = await createClient();
  const { data: item } = await supabase
    .from("request_items")
    .select("title, request_id, requests(client_id)")
    .eq("id", itemId)
    .eq("firm_id", staff.firmId)
    .maybeSingle();
  if (!item) return fail(notFound);

  // Build the emails before changing anything, so a configuration error leaves the item as is.
  const [{ data: contacts }, { data: firm }] = await Promise.all([
    supabase.from("client_contacts").select("email").eq("client_id", item.requests?.client_id ?? ""),
    supabase.from("firms").select("name").eq("id", staff.firmId).single(),
  ]);
  const firmName = firm?.name ?? "";
  const content = needsChangesEmail({ firmName, itemTitle: item.title, note: note.data, requestId: item.request_id });
  const messages = (contacts ?? []).map((c) => ({ ...content, to: c.email, fromName: firmName, replyTo: staff.email }));

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

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Expected: no errors.

---

## Task 2: Request editor and "New request"

**Files:**
- Create: `components/date-picker.tsx`, `app/app/requests/request-editor.tsx`, `app/app/requests/new/page.tsx`

- [ ] **Step 1: Add the date picker**

Create `components/date-picker.tsx`. It converts with `toDateString()` and `fromDateString()` from `lib/dates.ts`, which use the local calendar day, so the picked date is the date that gets saved in any time zone. With `name`, it also submits the value through a hidden input.

```tsx
"use client";

import { useState } from "react";
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

Create `app/app/requests/new/page.tsx`. Template items are copied into the editor. Saving creates `request_items` rows, so later template edits never change this request (spec section 7.2).

```tsx
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
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
  if (typeof clientId !== "string") notFound();

  const staff = await requireStaff();
  const supabase = await createClient();
  const [{ data: client }, { data: templates }] = await Promise.all([
    supabase.from("clients").select("id, name").eq("id", clientId).eq("firm_id", staff.firmId).maybeSingle(),
    supabase
      .from("templates")
      .select("id, name, template_items(title, description, kind, required, position)")
      .eq("firm_id", staff.firmId)
      .order("name")
      .order("position", { referencedTable: "template_items" })
      .order("id", { referencedTable: "template_items" }),
  ]);
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
      <RequestEditor
        clientId={client.id}
        initial={{ title: "", dueDate: null, items: [] }}
        templates={(templates ?? []).map((t) => ({ id: t.id, name: t.name, items: t.template_items }))}
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

Create `app/app/requests/[id]/request-actions.tsx`. "Download all (.zip)" links to the route that Phase 7 adds.

```tsx
"use client";

import { useActionState, useState } from "react";
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Edit details</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit request</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="request-title">Title</Label>
            <Input id="request-title" name="title" defaultValue={title} maxLength={LIMITS.name} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="request-due">Due date</Label>
            <DatePicker id="request-due" name="dueDate" value={date} onChange={setDate} />
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
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="item-title">Title</Label>
            <Input id="item-title" name="title" maxLength={LIMITS.name} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="item-description">Details (optional)</Label>
            <Textarea id="item-description" name="description" maxLength={LIMITS.description} rows={3} />
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
              <Checkbox id="item-required" name="required" defaultChecked />
              <Label htmlFor="item-required">Required</Label>
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

Create `app/app/requests/[id]/review-items.tsx`. File links go through `/api/files/[id]` (Phase 6): "Open" in a new tab, "Download" with `?download=1`. "Remove item" appears only when section 7.3 allows it.

```tsx
"use client";

import { useActionState, useState } from "react";
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
  const canReturn = item.status === "submitted" || item.status === "accepted";
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
        {item.status !== "accepted" && (
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
  const [, formAction, pending] = useActionState(async (prev: ActionResult | null, formData: FormData) => {
    const result = await returnItem(itemId, prev, formData);
    if (result.ok) toast.success("Returned to the client with your note.");
    else toast.error(result.error);
    return result;
  }, null);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Label htmlFor="review-note">What needs to change?</Label>
      <Textarea id="review-note" name="note" maxLength={LIMITS.reviewNote} rows={3} required />
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
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data: request } = await supabase
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
