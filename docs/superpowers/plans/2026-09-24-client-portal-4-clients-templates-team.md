# Client Portal Phase 4: Clients, Templates, and Team Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff can manage clients and their contacts, edit checklist templates, and (admins) manage the firm name and team. The end-to-end test gains step 2: add a client with one contact.

**Architecture:** Server Components load data with the user-scoped client, always filtered by the caller's `firm_id`, and pass plain props to Client Components. Mutations are Server Actions in each segment's `actions.ts`: validate with zod, write through RLS, return `ActionResult`, revalidate. Adding a person (contact or staff) goes through `ensureUser()` after the caller's role is confirmed.

**Tech Stack:** shadcn Dialog, AlertDialog, Select, Switch, Table, Card, Checkbox; `useActionState`; Sonner.

**Spec:** sections 5 (items 2–4), 9.2 (clients, templates, settings), 10.2, 10.3
**Depends on:** Phase 3
**Index:** [2026-09-24-client-portal.md](2026-09-24-client-portal.md)

---

## Files

| File | Responsibility |
|---|---|
| `app/app/clients/actions.ts` | `addClient` |
| `app/app/clients/client-form-dialog.tsx` | Create and edit dialog (name, kind, owner) |
| `app/app/clients/clients-table.tsx` | Name search and "Show archived" over the DataTable |
| `app/app/clients/page.tsx` | Client list |
| `components/status-badge.tsx` | Item and request status badges |
| `components/action-button.tsx` | Button that runs a Server Action and toasts the result |
| `app/app/clients/[id]/actions.ts` | `updateClient`, `setClientArchived`, `addContact`, `removeContact` |
| `app/app/clients/[id]/contacts.tsx` | Contact list, add dialog, remove confirmation |
| `app/app/clients/[id]/page.tsx` | Client details, contacts, and requests |
| `lib/editor-items.ts` | Editor item type and helpers, callable from server and client |
| `components/item-editor.tsx` | Ordered item editor with up and down buttons |
| `app/app/templates/*` | Template list, editor, and actions |
| `app/app/settings/*` | Firm name, team table, and actions |

---

## Task 1: Client list and "New client"

**Files:**
- Modify: `e2e/happy-path.spec.ts`
- Create: `app/app/clients/actions.ts`, `app/app/clients/client-form-dialog.tsx`, `app/app/clients/clients-table.tsx`, `app/app/clients/page.tsx`

- [ ] **Step 1: Extend the end-to-end test**

Replace `e2e/happy-path.spec.ts` (step 2 added):

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
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:e2e`
Expected: FAIL, waiting for the `New client` button, because `/app/clients` does not exist.

- [ ] **Step 3: Add the create action**

Create `app/app/clients/actions.ts`. It returns the new id instead of redirecting, so the dialog can close before navigating. With Cache Components the list page stays mounted after you leave it, and a dialog left open would still be open when you come back.

```ts
"use server";

import { requireStaff } from "@/lib/auth";
import { fail, invalid, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { clientSchema } from "@/lib/validation";

export async function addClient(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const staff = await requireStaff();
  const parsed = clientSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .insert({
      firm_id: staff.firmId,
      name: parsed.data.name,
      kind: parsed.data.kind,
      owner_id: parsed.data.ownerId,
    })
    .select("id")
    .single();
  if (error) return fail(error);

  return { ok: true, data: { id: data.id } };
}
```

- [ ] **Step 4: Add the client dialog**

Create `app/app/clients/client-form-dialog.tsx`. The owner select uses the value `"none"` for "No owner", because a Radix select item cannot have an empty value; `clientSchema` turns it into `null`.

```tsx
"use client";

import { useActionState, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import type { ActionResult } from "@/lib/errors";

export type Member = { userId: string; fullName: string };

type ClientValues = { name: string; kind: string; ownerId: string | null };

type Result = ActionResult<{ id: string }>;

/**
 * Create or edit a client. `action` receives the form fields name, kind, ownerId.
 * With `openAfterSave`, navigates to the saved client after closing.
 */
export function ClientFormDialog({
  title,
  trigger,
  members,
  initial,
  action,
  openAfterSave = false,
}: {
  title: string;
  trigger: ReactNode;
  members: Member[];
  initial?: ClientValues;
  action: (prev: Result | null, formData: FormData) => Promise<Result>;
  openAfterSave?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, formAction, pending] = useActionState(async (prev: Result | null, formData: FormData) => {
    const result = await action(prev, formData);
    if (result.ok) {
      toast.success("Client saved.");
      setOpen(false);
      if (openAfterSave) router.push(`/app/clients/${result.data!.id}`);
    } else {
      toast.error(result.error);
    }
    return result;
  }, null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="client-name">Name</Label>
            <Input id="client-name" name="name" defaultValue={initial?.name} maxLength={200} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="client-kind">Type</Label>
            <Select name="kind" defaultValue={initial?.kind ?? "individual"}>
              <SelectTrigger id="client-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="individual">Individual or household</SelectItem>
                <SelectItem value="business">Business</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="client-owner">Owner</Label>
            <Select name="ownerId" defaultValue={initial?.ownerId ?? "none"}>
              <SelectTrigger id="client-owner">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No owner</SelectItem>
                {members.map((member) => (
                  <SelectItem key={member.userId} value={member.userId}>
                    {member.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Add the table and page**

Create `app/app/clients/clients-table.tsx`:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DataTable, type DataTableColumn } from "@/components/data-table";

export type ClientRow = {
  id: string;
  name: string;
  kind: string;
  owner: string;
  archived: boolean;
};

const columns: DataTableColumn<ClientRow>[] = [
  {
    id: "name",
    header: "Name",
    cell: ({ row }) => (
      <Link className="font-medium underline-offset-4 hover:underline" href={`/app/clients/${row.original.id}`}>
        {row.original.name}
      </Link>
    ),
  },
  { id: "kind", header: "Type", cell: ({ row }) => (row.original.kind === "business" ? "Business" : "Individual") },
  { accessorKey: "owner", header: "Owner" },
  { id: "status", header: "", cell: ({ row }) => row.original.archived && <Badge variant="outline">Archived</Badge> },
];

export function ClientsTable({ clients }: { clients: ClientRow[] }) {
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const needle = query.trim().toLowerCase();
  const visible = clients.filter(
    (client) => (showArchived || !client.archived) && client.name.toLowerCase().includes(needle),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <Input
          className="max-w-xs"
          placeholder="Search by name"
          aria-label="Search by name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <Switch id="show-archived" checked={showArchived} onCheckedChange={setShowArchived} />
          <Label htmlFor="show-archived">Show archived</Label>
        </div>
      </div>
      <DataTable columns={columns} data={visible} emptyMessage="No clients." />
    </div>
  );
}
```

Create `app/app/clients/page.tsx`:

```tsx
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addClient } from "./actions";
import { ClientFormDialog } from "./client-form-dialog";
import { ClientsTable } from "./clients-table";

export default function ClientsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <Clients />
    </Suspense>
  );
}

async function Clients() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const [clients, members] = await Promise.all([
    supabase.from("clients").select("id, name, kind, owner_id, archived_at").eq("firm_id", staff.firmId).order("name"),
    supabase.from("firm_members").select("user_id, full_name").eq("firm_id", staff.firmId).order("full_name"),
  ]);
  if (clients.error) throw clients.error;
  if (members.error) throw members.error;

  const memberList = members.data.map((m) => ({ userId: m.user_id, fullName: m.full_name }));
  const ownerName = new Map(memberList.map((m) => [m.userId, m.fullName]));

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Clients</h1>
        <ClientFormDialog
          title="New client"
          members={memberList}
          action={addClient}
          openAfterSave
          trigger={
            <Button>
              <Plus />
              New client
            </Button>
          }
        />
      </div>
      <ClientsTable
        clients={clients.data.map((c) => ({
          id: c.id,
          name: c.name,
          kind: c.kind,
          owner: (c.owner_id && ownerName.get(c.owner_id)) || "",
          archived: c.archived_at !== null,
        }))}
      />
    </>
  );
}
```

- [ ] **Step 6: Run the test**

Run: `npm run test:e2e`
Expected: still FAIL, but later: the client is created, and the test waits for the `Pat Client` heading because `/app/clients/[id]` does not exist yet.

---

## Task 2: Client page and contacts

**Files:**
- Create: `components/status-badge.tsx`, `components/action-button.tsx`, `app/app/clients/[id]/actions.ts`, `app/app/clients/[id]/contacts.tsx`, `app/app/clients/[id]/page.tsx`

- [ ] **Step 1: Add the shared components**

Create `components/status-badge.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";

type Variant = "default" | "secondary" | "destructive" | "outline";

const ITEM: Record<string, [string, Variant]> = {
  requested: ["Requested", "outline"],
  submitted: ["Submitted", "secondary"],
  needs_changes: ["Needs changes", "destructive"],
  accepted: ["Accepted", "default"],
};

const REQUEST: Record<string, [string, Variant]> = {
  draft: ["Draft", "outline"],
  open: ["Open", "secondary"],
  completed: ["Completed", "default"],
  archived: ["Archived", "outline"],
};

export function ItemStatusBadge({ status }: { status: string }) {
  const [label, variant] = ITEM[status] ?? [status, "outline"];
  return <Badge variant={variant}>{label}</Badge>;
}

export function RequestStatusBadge({ status }: { status: string }) {
  const [label, variant] = REQUEST[status] ?? [status, "outline"];
  return <Badge variant={variant}>{label}</Badge>;
}
```

Create `components/action-button.tsx`. Pass it a Server Action bound to its arguments (`setClientArchived.bind(null, id, true)`) or an inline async function.

```tsx
"use client";

import { useTransition, type ComponentProps } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/errors";

/** A button that runs a Server Action and reports the result in a toast. */
export function ActionButton({
  action,
  success,
  disabled,
  ...props
}: Omit<ComponentProps<typeof Button>, "onClick" | "action"> & {
  action: () => Promise<ActionResult<unknown>>;
  success?: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      {...props}
      disabled={disabled || pending}
      onClick={() =>
        startTransition(async () => {
          const result = await action();
          if (!result.ok) toast.error(result.error);
          else if (success) toast.success(success);
        })
      }
    />
  );
}
```

- [ ] **Step 2: Add the client actions**

Create `app/app/clients/[id]/actions.ts`. `addContact` follows spec section 10.3: it confirms the caller is staff and that the client belongs to their firm before `ensureUser()` creates any auth user, and it sends no email.

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { fail, invalid, notFound, type ActionResult } from "@/lib/errors";
import { ensureUser } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { clientSchema, contactSchema } from "@/lib/validation";

export async function updateClient(
  clientId: string,
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const staff = await requireStaff();
  const parsed = clientSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .update({ name: parsed.data.name, kind: parsed.data.kind, owner_id: parsed.data.ownerId })
    .eq("id", clientId)
    .eq("firm_id", staff.firmId)
    .select("id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return fail(notFound);

  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true, data: { id: clientId } };
}

export async function setClientArchived(clientId: string, archived: boolean): Promise<ActionResult> {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase
    .from("clients")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", clientId)
    .eq("firm_id", staff.firmId);
  if (error) return fail(error);

  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}

/** Section 10.3: confirm the caller is staff, ensure the auth user, insert the contact. No email. */
export async function addContact(
  clientId: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = contactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .eq("firm_id", staff.firmId)
    .maybeSingle();
  if (!client) return fail(notFound);

  const userId = await ensureUser(parsed.data.email);
  const { error } = await supabase.from("client_contacts").insert({
    client_id: clientId,
    firm_id: staff.firmId,
    user_id: userId,
    full_name: parsed.data.fullName,
    email: parsed.data.email,
  });
  if (error) return fail(error, { "23505": "This person is already a contact of this client." });

  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}

export async function removeContact(clientId: string, userId: string): Promise<ActionResult> {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase
    .from("client_contacts")
    .delete()
    .eq("client_id", clientId)
    .eq("user_id", userId)
    .eq("firm_id", staff.firmId);
  if (error) return fail(error);

  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}
```

- [ ] **Step 3: Add the contacts section**

Create `app/app/clients/[id]/contacts.tsx`:

```tsx
"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import type { ActionResult } from "@/lib/errors";
import { addContact, removeContact } from "./actions";

type Contact = { userId: string; fullName: string; email: string };

export function Contacts({ clientId, contacts }: { clientId: string; contacts: Contact[] }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Contacts</h2>
        <AddContactDialog clientId={clientId} />
      </div>
      {contacts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No contacts yet. Add the people who will sign in and upload documents.
        </p>
      ) : (
        <Table>
          <TableBody>
            {contacts.map((contact) => (
              <TableRow key={contact.userId}>
                <TableCell className="font-medium">{contact.fullName}</TableCell>
                <TableCell>{contact.email}</TableCell>
                <TableCell className="text-right">
                  <RemoveContactButton clientId={clientId} contact={contact} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function AddContactDialog({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const [, formAction, pending] = useActionState(async (prev: ActionResult | null, formData: FormData) => {
    const result = await addContact(clientId, prev, formData);
    if (result.ok) {
      toast.success("Contact added.");
      setOpen(false);
    } else {
      toast.error(result.error);
    }
    return result;
  }, null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus />
          Add contact
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add contact</DialogTitle>
          <DialogDescription>They sign in with a code sent to this email. Nothing is sent until you send a request.</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="contact-name">Full name</Label>
            <Input id="contact-name" name="fullName" maxLength={200} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="contact-email">Email</Label>
            <Input id="contact-email" name="email" type="email" required />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add contact"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RemoveContactButton({ clientId, contact }: { clientId: string; contact: Contact }) {
  async function remove() {
    const result = await removeContact(clientId, contact.userId);
    if (result.ok) toast.success("Contact removed.");
    else toast.error(result.error);
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Remove
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {contact.fullName}?</AlertDialogTitle>
          <AlertDialogDescription>They will lose access to this client&apos;s requests.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={remove}>Remove</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 4: Add the client page**

Create `app/app/clients/[id]/page.tsx`. A client hidden by RLS, or in another firm, renders `notFound()`, never a 403. The "New request" link points at `/app/requests/new`, which Phase 5 adds.

```tsx
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { ActionButton } from "@/components/action-button";
import { RequestStatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { requireStaff } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { ClientFormDialog } from "../client-form-dialog";
import { setClientArchived, updateClient } from "./actions";
import { Contacts } from "./contacts";

export default function ClientPage({ params }: PageProps<"/app/clients/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Client params={params} />
    </Suspense>
  );
}

async function Client({ params }: Pick<PageProps<"/app/clients/[id]">, "params">) {
  const { id } = await params;
  const staff = await requireStaff();
  const supabase = await createClient();
  const [{ data: client }, contacts, requests, members] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, kind, owner_id, archived_at")
      .eq("id", id)
      .eq("firm_id", staff.firmId)
      .maybeSingle(),
    supabase
      .from("client_contacts")
      .select("user_id, full_name, email")
      .eq("client_id", id)
      .eq("firm_id", staff.firmId)
      .order("full_name"),
    supabase
      .from("requests")
      .select("id, title, status, due_date")
      .eq("client_id", id)
      .eq("firm_id", staff.firmId)
      .order("created_at", { ascending: false }),
    supabase.from("firm_members").select("user_id, full_name").eq("firm_id", staff.firmId).order("full_name"),
  ]);
  if (!client) notFound();

  const memberList = (members.data ?? []).map((m) => ({ userId: m.user_id, fullName: m.full_name }));
  const owner = memberList.find((m) => m.userId === client.owner_id);
  const archived = client.archived_at !== null;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            {client.name}
            {archived && <Badge variant="outline">Archived</Badge>}
          </h1>
          <p className="text-sm text-muted-foreground">
            {client.kind === "business" ? "Business" : "Individual"}
            {owner && ` · Owner: ${owner.fullName}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ClientFormDialog
            title="Edit client"
            members={memberList}
            initial={{ name: client.name, kind: client.kind, ownerId: client.owner_id }}
            action={updateClient.bind(null, id)}
            trigger={<Button variant="outline">Edit</Button>}
          />
          <ActionButton
            variant="outline"
            action={setClientArchived.bind(null, id, !archived)}
            success={archived ? "Client unarchived." : "Client archived."}
          >
            {archived ? "Unarchive" : "Archive"}
          </ActionButton>
          <Button asChild>
            <Link href={`/app/requests/new?client=${id}`}>
              <Plus />
              New request
            </Link>
          </Button>
        </div>
      </div>

      <Contacts
        clientId={id}
        contacts={(contacts.data ?? []).map((c) => ({ userId: c.user_id, fullName: c.full_name, email: c.email }))}
      />

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Requests</h2>
        {(requests.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No requests yet.</p>
        ) : (
          <Table>
            <TableBody>
              {(requests.data ?? []).map((request) => (
                <TableRow key={request.id}>
                  <TableCell>
                    <Link className="font-medium underline-offset-4 hover:underline" href={`/app/requests/${request.id}`}>
                      {request.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <RequestStatusBadge status={request.status} />
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    Due {formatDate(request.due_date)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 5: Run the test to make sure it passes**

Run: `npm run test:e2e`
Expected: PASS, `1 passed`.

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

```bash
git add -A
git commit -m "feat: add clients, contacts, and client archive"
```

---

## Task 3: Templates

**Files:**
- Create: `lib/editor-items.ts`, `components/item-editor.tsx`, `app/app/templates/actions.ts`, `app/app/templates/page.tsx`, `app/app/templates/template-editor.tsx`, `app/app/templates/[id]/page.tsx`

- [ ] **Step 1: Add the editor item helpers**

Create `lib/editor-items.ts`. These helpers are called from Server Components (to build the editor's initial items), so they must not live in a `'use client'` module: calling a function exported from a client module on the server fails at runtime with "Attempted to call newEditorItem() from the server", and neither `tsc` nor `next build` catches it.

```ts
import type { ItemInput } from "@/lib/validation";

/** An item row in the request and template editors. `key` is only for React. */
export type EditorItem = {
  key: string;
  title: string;
  description: string;
  kind: "file" | "text";
  required: boolean;
};

export function newEditorItem(from?: {
  title: string;
  description: string | null;
  kind: string;
  required: boolean;
}): EditorItem {
  return {
    key: crypto.randomUUID(),
    title: from?.title ?? "",
    description: from?.description ?? "",
    kind: from?.kind === "text" ? "text" : "file",
    required: from?.required ?? true,
  };
}

export function toItemInputs(items: EditorItem[]): ItemInput[] {
  return items.map(({ title, description, kind, required }) => ({ title, description, kind, required }));
}
```

- [ ] **Step 2: Add the item editor**

Create `components/item-editor.tsx`. Reordering uses up and down buttons, not drag and drop (spec section 3). Both the template editor and the request editor (Phase 5) use it.

```tsx
"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MAX_ITEMS_PER_REQUEST } from "@/lib/constants";
import { newEditorItem, type EditorItem } from "@/lib/editor-items";

/** Ordered list of checklist items. Shared by the request and template editors. */
export function ItemEditor({ items, onChange }: { items: EditorItem[]; onChange: (items: EditorItem[]) => void }) {
  function update(index: number, patch: Partial<EditorItem>) {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function move(index: number, offset: -1 | 1) {
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(index + offset, 0, item);
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((item, index) => (
        <Card key={item.key}>
          <CardContent className="flex gap-3">
            <span className="pt-2 text-sm text-muted-foreground">{index + 1}.</span>
            <div className="flex flex-1 flex-col gap-2">
              <Input
                aria-label={`Item ${index + 1} title`}
                placeholder="What do you need?"
                value={item.title}
                maxLength={200}
                onChange={(e) => update(index, { title: e.target.value })}
              />
              <Textarea
                aria-label={`Item ${index + 1} description`}
                placeholder="Details for the client (optional)"
                value={item.description}
                maxLength={2000}
                rows={2}
                onChange={(e) => update(index, { description: e.target.value })}
              />
              <div className="flex flex-wrap items-center gap-4">
                <Select value={item.kind} onValueChange={(kind) => update(index, { kind: kind as EditorItem["kind"] })}>
                  <SelectTrigger aria-label={`Item ${index + 1} type`} className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="file">File upload</SelectItem>
                    <SelectItem value="text">Written answer</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`required-${item.key}`}
                    checked={item.required}
                    onCheckedChange={(checked) => update(index, { required: checked === true })}
                  />
                  <Label htmlFor={`required-${item.key}`}>Required</Label>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Move item ${index + 1} up`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Move item ${index + 1} down`}
                disabled={index === items.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove item ${index + 1}`}
                onClick={() => onChange(items.filter((_, i) => i !== index))}
              >
                <Trash2 />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
      <Button
        type="button"
        variant="outline"
        className="self-start"
        disabled={items.length >= MAX_ITEMS_PER_REQUEST}
        onClick={() => onChange([...items, newEditorItem()])}
      >
        <Plus />
        Add item
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Add the template actions**

Create `app/app/templates/actions.ts`. Saving replaces the template's items. Requests keep their own copies (spec section 7.2), so editing a template never changes an existing request.

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { fail, invalid, notFound, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { templateSchema } from "@/lib/validation";

export async function createTemplate(): Promise<ActionResult> {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("templates")
    .insert({ firm_id: staff.firmId, name: "Untitled template" })
    .select("id")
    .single();
  if (error) return fail(error);

  redirect(`/app/templates/${data.id}`);
}

/** Replaces the template's name and items. Requests already created from it keep their copies. */
export async function saveTemplate(input: z.input<typeof templateSchema>): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { templateId, name, items } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("templates")
    .update({ name })
    .eq("id", templateId)
    .eq("firm_id", staff.firmId)
    .select("id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return fail(notFound);

  const { error: deleteError } = await supabase.from("template_items").delete().eq("template_id", templateId);
  if (deleteError) return fail(deleteError);
  if (items.length > 0) {
    const { error: insertError } = await supabase.from("template_items").insert(
      items.map((item, index) => ({ ...item, template_id: templateId, firm_id: staff.firmId, position: index + 1 })),
    );
    if (insertError) return fail(insertError);
  }

  revalidatePath(`/app/templates/${templateId}`);
  revalidatePath("/app/templates");
  return { ok: true };
}

export async function deleteTemplate(templateId: string): Promise<ActionResult> {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.from("templates").delete().eq("id", templateId).eq("firm_id", staff.firmId);
  if (error) return fail(error);

  redirect("/app/templates");
}
```

- [ ] **Step 4: Add the pages**

Create `app/app/templates/page.tsx`:

```tsx
import { Suspense } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ActionButton } from "@/components/action-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createTemplate } from "./actions";

export default function TemplatesPage() {
  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Templates</h1>
        <ActionButton action={createTemplate}>
          <Plus />
          New template
        </ActionButton>
      </div>
      <Suspense fallback={<Skeleton className="h-48" />}>
        <Templates />
      </Suspense>
    </>
  );
}

async function Templates() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data: templates, error } = await supabase
    .from("templates")
    .select("id, name, template_items(count)")
    .eq("firm_id", staff.firmId)
    .order("name");
  if (error) throw error;

  if (templates.length === 0) {
    return <p className="text-sm text-muted-foreground">No templates yet.</p>;
  }
  return (
    <Table>
      <TableBody>
        {templates.map((template) => (
          <TableRow key={template.id}>
            <TableCell>
              <Link className="font-medium underline-offset-4 hover:underline" href={`/app/templates/${template.id}`}>
                {template.name}
              </Link>
            </TableCell>
            <TableCell className="text-right text-sm text-muted-foreground">
              {template.template_items[0]?.count ?? 0} items
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

Create `app/app/templates/template-editor.tsx`. The input id comes from `useId()`: several template pages can stay mounted (hidden) at once, and fixed ids would repeat and merge their labels.

```tsx
"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { ItemEditor } from "@/components/item-editor";
import { toItemInputs, type EditorItem } from "@/lib/editor-items";
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
import { deleteTemplate, saveTemplate } from "./actions";

export function TemplateEditor({
  templateId,
  initial,
}: {
  templateId: string;
  initial: { name: string; items: EditorItem[] };
}) {
  const id = useId();
  const [name, setName] = useState(initial.name);
  const [items, setItems] = useState(initial.items);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await saveTemplate({ templateId, name, items: toItemInputs(items) });
      if (result.ok) toast.success("Template saved.");
      else toast.error(result.error);
    });
  }

  async function remove() {
    const result = await deleteTemplate(templateId);
    if (!result.ok) toast.error(result.error);
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-name`}>Name</Label>
        <Input id={`${id}-name`} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Items</h2>
        <ItemEditor items={items} onChange={setItems} />
      </div>
      <div className="flex gap-2">
        <Button type="button" disabled={pending} onClick={save}>
          Save template
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="ghost">
              Delete template
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this template?</AlertDialogTitle>
              <AlertDialogDescription>Requests created from it are not affected.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
```

Create `app/app/templates/[id]/page.tsx`. Items sort by `position`, then `id` (spec section 7.2).

```tsx
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/auth";
import { newEditorItem } from "@/lib/editor-items";
import { createClient } from "@/lib/supabase/server";
import { TemplateEditor } from "../template-editor";

export default function TemplatePage({ params }: PageProps<"/app/templates/[id]">) {
  return (
    <>
      <h1 className="text-2xl font-semibold">Edit template</h1>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Template params={params} />
      </Suspense>
    </>
  );
}

async function Template({ params }: Pick<PageProps<"/app/templates/[id]">, "params">) {
  const { id } = await params;
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data: template } = await supabase
    .from("templates")
    .select("id, name, template_items(title, description, kind, required, position)")
    .eq("id", id)
    .eq("firm_id", staff.firmId)
    .order("position", { referencedTable: "template_items" })
    .order("id", { referencedTable: "template_items" })
    .maybeSingle();
  if (!template) notFound();

  return (
    <TemplateEditor
      templateId={template.id}
      initial={{ name: template.name, items: template.template_items.map((item) => newEditorItem(item)) }}
    />
  );
}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

Then check by hand. Run `npm run dev`, sign in as a staff user (codes arrive in Mailpit at http://127.0.0.1:54324), and open `/app/templates`:
1. "Annual tax return (starter)" is listed with 7 items. Open it: item 7 is "Anything else we should know?".
2. Click "Move item 2 up", then "Save template". Expected: toast "Template saved."; after a reload, item 1 is "Income statements from all employers".
3. Back on `/app/templates`, click "New template". Expected: the "Edit template" page for "Untitled template". Click "Delete template", then "Delete". Expected: back on `/app/templates`, and the template is gone.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add template list and editor"
```

---

## Task 4: Settings and team

**Files:**
- Create: `app/app/settings/actions.ts`, `app/app/settings/firm-name-form.tsx`, `app/app/settings/team.tsx`, `app/app/settings/page.tsx`

- [ ] **Step 1: Add the settings actions**

Create `app/app/settings/actions.ts`. `addStaff` follows spec section 10.2: confirm the caller is an admin, `ensureUser()`, insert the membership (RLS allows admins only), then send the `staff_added` email in `after()`. The unique `user_id` constraint produces "This person already belongs to a firm." `changeRole` and `removeStaff` exclude the caller's own row; RLS enforces the same rule.

```ts
"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { sendEmails } from "@/lib/email/send";
import { staffAddedEmail } from "@/lib/email/templates";
import { fail, invalid, notFound, staleState, type ActionResult } from "@/lib/errors";
import { ensureUser } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { firmNameSchema, staffSchema } from "@/lib/validation";

export async function renameFirm(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const staff = await requireAdmin();
  const name = firmNameSchema.safeParse(formData.get("name"));
  if (!name.success) return invalid(name.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("firms")
    .update({ name: name.data })
    .eq("id", staff.firmId)
    .select("id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return fail(notFound);

  revalidatePath("/app", "layout");
  return { ok: true };
}

/** Section 10.2: admin check, ensure the auth user, insert the membership, then email them. */
export async function addStaff(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = staffSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);

  const userId = await ensureUser(parsed.data.email);
  const supabase = await createClient();
  const { error } = await supabase.from("firm_members").insert({
    firm_id: admin.firmId,
    user_id: userId,
    role: parsed.data.role,
    full_name: parsed.data.fullName,
    email: parsed.data.email,
  });
  if (error) return fail(error, { "23505": "This person already belongs to a firm." });

  const { data: firm } = await supabase.from("firms").select("name").eq("id", admin.firmId).single();
  const firmName = firm?.name ?? "";
  const content = staffAddedEmail({ firmName, adminName: admin.fullName });
  after(() =>
    sendEmails([{ ...content, to: parsed.data.email, fromName: firmName, replyTo: admin.email }]),
  );

  revalidatePath("/app/settings");
  return { ok: true };
}

export async function changeRole(userId: string, role: "admin" | "staff"): Promise<ActionResult> {
  const admin = await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("firm_members")
    .update({ role })
    .eq("firm_id", admin.firmId)
    .eq("user_id", userId)
    .neq("user_id", admin.userId)
    .select("user_id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return fail(staleState);

  revalidatePath("/app/settings");
  return { ok: true };
}

export async function removeStaff(userId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("firm_members")
    .delete()
    .eq("firm_id", admin.firmId)
    .eq("user_id", userId)
    .neq("user_id", admin.userId)
    .select("user_id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return fail(staleState);

  revalidatePath("/app/settings");
  return { ok: true };
}
```

- [ ] **Step 2: Add the firm name form**

Create `app/app/settings/firm-name-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/lib/errors";
import { renameFirm } from "./actions";

export function FirmNameForm({ name, editable }: { name: string; editable: boolean }) {
  const [, formAction, pending] = useActionState(async (prev: ActionResult | null, formData: FormData) => {
    const result = await renameFirm(prev, formData);
    if (result.ok) toast.success("Firm name saved.");
    else toast.error(result.error);
    return result;
  }, null);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-2">
      <Label htmlFor="firm-name">Firm name</Label>
      <div className="flex gap-2">
        <Input id="firm-name" name="name" defaultValue={name} maxLength={120} required disabled={!editable} />
        {editable && (
          <Button type="submit" disabled={pending}>
            Save
          </Button>
        )}
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Add the team table**

Create `app/app/settings/team.tsx`. An admin's own row is read-only.

```tsx
"use client";

import { useActionState, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ActionResult } from "@/lib/errors";
import { addStaff, changeRole, removeStaff } from "./actions";

type Member = { userId: string; fullName: string; email: string; role: "admin" | "staff" };

export function Team({ members, currentUserId, isAdmin }: { members: Member[]; currentUserId: string; isAdmin: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Team</h2>
        {isAdmin && <AddStaffDialog />}
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => {
              // An admin's own row is read-only, so every firm keeps an admin.
              const editable = isAdmin && member.userId !== currentUserId;
              return (
                <TableRow key={member.userId}>
                  <TableCell className="font-medium">{member.fullName}</TableCell>
                  <TableCell>{member.email}</TableCell>
                  <TableCell>{editable ? <RoleSelect member={member} /> : roleLabel(member.role)}</TableCell>
                  <TableCell className="text-right">{editable && <RemoveButton member={member} />}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function roleLabel(role: string) {
  return role === "admin" ? "Admin" : "Staff";
}

function RoleSelect({ member }: { member: Member }) {
  const [pending, startTransition] = useTransition();

  return (
    <Select
      value={member.role}
      disabled={pending}
      onValueChange={(role) =>
        startTransition(async () => {
          const result = await changeRole(member.userId, role as Member["role"]);
          if (result.ok) toast.success("Role updated.");
          else toast.error(result.error);
        })
      }
    >
      <SelectTrigger aria-label={`Role for ${member.fullName}`} className="w-28">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="admin">Admin</SelectItem>
        <SelectItem value="staff">Staff</SelectItem>
      </SelectContent>
    </Select>
  );
}

function RemoveButton({ member }: { member: Member }) {
  async function remove() {
    const result = await removeStaff(member.userId);
    if (result.ok) toast.success("Removed from the team.");
    else toast.error(result.error);
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Remove
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {member.fullName}?</AlertDialogTitle>
          <AlertDialogDescription>They will lose access to this firm.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={remove}>Remove</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function AddStaffDialog() {
  const [open, setOpen] = useState(false);
  const [, formAction, pending] = useActionState(async (prev: ActionResult | null, formData: FormData) => {
    const result = await addStaff(prev, formData);
    if (result.ok) {
      toast.success("Added. We emailed them a sign-in link.");
      setOpen(false);
    } else {
      toast.error(result.error);
    }
    return result;
  }, null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus />
          Add staff
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add staff</DialogTitle>
          <DialogDescription>Every staff member sees every client in the firm.</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="staff-name">Full name</Label>
            <Input id="staff-name" name="fullName" maxLength={200} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="staff-email">Email</Label>
            <Input id="staff-email" name="email" type="email" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="staff-role">Role</Label>
            <Select name="role" defaultValue="staff">
              <SelectTrigger id="staff-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="staff">Staff</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add staff"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Add the page**

Create `app/app/settings/page.tsx`. Staff who are not admins see the firm name and team read-only.

```tsx
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FirmNameForm } from "./firm-name-form";
import { Team } from "./team";

export default function SettingsPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Settings />
      </Suspense>
    </>
  );
}

async function Settings() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const [{ data: firm }, { data: members }] = await Promise.all([
    supabase.from("firms").select("name").eq("id", staff.firmId).single(),
    supabase.from("firm_members").select("user_id, full_name, email, role").eq("firm_id", staff.firmId).order("full_name"),
  ]);
  const isAdmin = staff.role === "admin";

  return (
    <>
      <FirmNameForm name={firm?.name ?? ""} editable={isAdmin} />
      <Team
        currentUserId={staff.userId}
        isAdmin={isAdmin}
        members={(members ?? []).map((m) => ({
          userId: m.user_id,
          fullName: m.full_name,
          email: m.email,
          role: m.role === "admin" ? "admin" : "staff",
        }))}
      />
    </>
  );
}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all succeed.

Then check by hand as an admin on `/app/settings` (with `npm run dev` running):
1. Change the firm name and click "Save". Expected: toast "Firm name saved." and the new name in the sidebar.
2. "Add staff" with a new email. Expected: toast "Added. We emailed them a sign-in link.", the person in the team table, and a `[email] … subject="You've been added to …"` line in the dev server output.
3. "Add staff" again with the same email in capitals. Expected: toast "This person already belongs to a firm." (this exercises `ensureUser()`'s `email_exists` path).
4. Change that person's role to Admin, then remove them. Expected: toasts "Role updated." and "Removed from the team."; your own row has no role select and no Remove button.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add firm settings and team management"
```
