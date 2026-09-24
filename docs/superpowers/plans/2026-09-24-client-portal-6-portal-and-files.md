# Client Portal Phase 6: Client Portal and Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A client contact signs in with a code, sees their requests, uploads files straight to Storage, answers questions, and submits each item; staff and contacts download files through short-lived signed URLs. The end-to-end test becomes the complete seven-step test from spec section 14.

**Architecture:** The portal shows only requests of clients the user is a contact of (their own `client_contacts` rows), never drafts. Uploads follow spec section 10.5: a Server Action checks `can_write_document` and creates a signed upload URL; the browser uploads one file at a time with `uploadToSignedUrl`; a second Server Action registers the file through the `register_file` RPC. File bytes never pass through a Vercel function. Downloads go through `/api/files/[id]`, which finds the row under RLS and redirects to a 60-second signed URL.

**Tech Stack:** shadcn Card, Progress, Alert, Textarea; Supabase Storage signed upload and download URLs; native `<input type="file" multiple>` and drag events.

**Spec:** sections 5 (items 6 and 9), 8.4 (downloads), 9.3, 10.5, 10.6
**Depends on:** Phase 5
**Index:** [2026-09-24-client-portal.md](2026-09-24-client-portal.md)

---

## Files

| File | Responsibility |
|---|---|
| `app/portal/layout.tsx`, `app/portal/error.tsx` | Mobile-first single-column layout; error boundary |
| `app/portal/progress.ts` | Share of required items submitted or accepted |
| `app/portal/page.tsx` | Open and past requests, grouped by firm when there are several |
| `app/portal/requests/[id]/actions.ts` | `createUploadUrl`, `registerFile`, `removeFile`, `submitItem` |
| `app/portal/requests/[id]/item-card.tsx` | One item: note, files, upload queue, answer, submit |
| `app/portal/requests/[id]/page.tsx` | Request detail with progress |
| `app/api/files/[id]/route.ts` | Signed download redirect |

---

## Task 1: The complete end-to-end test

**Files:**
- Modify: `e2e/happy-path.spec.ts`

- [ ] **Step 1: Write the final test**

Replace `e2e/happy-path.spec.ts` with the complete test (steps 4 to 7 added). A modal Sheet hides the rest of the page from the accessibility tree, so the test closes it with Escape before the last assertion.

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

  // 4. The contact signs in with a code.
  const contact = await (await browser.newContext()).newPage();
  await signIn(contact, contactEmail);
  await expect(contact).toHaveURL(/\/portal$/);

  // 5. The contact uploads a PDF and submits the item.
  await contact.getByRole("link", { name: /2026 tax documents/ }).click();
  await contact.locator('input[type="file"]').setInputFiles({
    name: "passport.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"),
  });
  await expect(contact.getByText("passport.pdf")).toBeVisible();
  await contact.getByRole("button", { name: "Submit" }).click();
  await expect(contact.getByText("Submitted", { exact: true })).toBeVisible();

  // 6. Staff accepts the item.
  await staff.reload();
  await staff.getByRole("button", { name: "Photo ID" }).click();
  const sheet = staff.getByRole("dialog", { name: "Photo ID" });
  await sheet.getByRole("button", { name: "Accept" }).click();
  await expect(sheet.getByText("Accepted", { exact: true })).toBeVisible();
  await staff.keyboard.press("Escape");

  // 7. The request shows as Completed.
  await expect(staff.getByRole("heading", { name: /2026 tax documents/ })).toContainText("Completed");
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:e2e`
Expected: FAIL at step 4 or 5: the contact signs in and is sent to `/portal`, which does not exist yet.

---

## Task 2: Portal layout and request list

**Files:**
- Create: `app/portal/layout.tsx`, `app/portal/error.tsx`, `app/portal/progress.ts`, `app/portal/page.tsx`

- [ ] **Step 1: Add the layout and error boundary**

Create `app/portal/layout.tsx`. It reads no session, so it prerenders.

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/constants";

export default function PortalLayout({ children }: LayoutProps<"/portal">) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-14 items-center justify-between border-b px-4">
        <Link href="/portal" className="font-semibold">
          {APP_NAME}
        </Link>
        <form action="/auth/sign-out" method="post">
          <Button type="submit" variant="ghost" size="sm">
            Sign out
          </Button>
        </form>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4">{children}</main>
    </div>
  );
}
```

Create `app/portal/error.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function PortalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-start gap-4">
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="text-sm text-muted-foreground">Try again in a moment.</p>
      <Button onClick={() => retry()}>Try again</Button>
    </div>
  );
}
```

- [ ] **Step 2: Add the progress helper**

Create `app/portal/progress.ts`. Progress is required items that are `submitted` or `accepted`, divided by required items (spec section 9.3).

```ts
/** Percent of required items that are submitted or accepted. */
export function progressPercent(items: { required: boolean; status: string }[]): number {
  const required = items.filter((item) => item.required);
  if (required.length === 0) return 100;
  const done = required.filter((item) => item.status === "submitted" || item.status === "accepted").length;
  return Math.round((done / required.length) * 100);
}
```

- [ ] **Step 3: Add the request list**

Create `app/portal/page.tsx`. It filters by the user's own contact client ids and excludes drafts explicitly: a user who is also staff can see their whole firm's requests through the staff policy, and those do not belong in their portal. `requests` has no direct foreign key to `firms`, so the firm name comes through `clients(firms(name))`.

```tsx
import { Suspense } from "react";
import Link from "next/link";
import { RequestStatusBadge } from "@/components/status-badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { getContactClientIds } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { progressPercent } from "./progress";

export default function PortalPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Your requests</h1>
      <Suspense fallback={<Skeleton className="h-48" />}>
        <Requests />
      </Suspense>
    </>
  );
}

type Row = { id: string; title: string; status: string; dueDate: string; progress: number };

async function Requests() {
  const clientIds = await getContactClientIds();
  if (clientIds.length === 0) {
    return <p className="text-sm text-muted-foreground">You don&apos;t have any requests yet.</p>;
  }

  const supabase = await createClient();
  const { data: requests, error } = await supabase
    .from("requests")
    .select("id, title, status, due_date, firm_id, clients(firms(name)), request_items(required, status)")
    .in("client_id", clientIds)
    .neq("status", "draft")
    .order("due_date");
  if (error) throw error;

  const firms = new Map<string, { name: string; open: Row[]; past: Row[] }>();
  for (const request of requests) {
    const firm = firms.get(request.firm_id) ?? { name: request.clients?.firms?.name ?? "", open: [], past: [] };
    const row = {
      id: request.id,
      title: request.title,
      status: request.status,
      dueDate: request.due_date,
      progress: progressPercent(request.request_items),
    };
    (request.status === "open" ? firm.open : firm.past).push(row);
    firms.set(request.firm_id, firm);
  }
  const grouped = firms.size > 1;

  return [...firms.entries()].map(([firmId, firm]) => (
    <section key={firmId} className="flex flex-col gap-4">
      {grouped && <h2 className="text-lg font-semibold">{firm.name}</h2>}
      <RequestList title="Open requests" rows={firm.open} showProgress empty="Nothing to do right now." />
      {firm.past.length > 0 && <RequestList title="Past requests" rows={firm.past} />}
    </section>
  ));
}

function RequestList({
  title,
  rows,
  showProgress = false,
  empty,
}: {
  title: string;
  rows: Row[];
  showProgress?: boolean;
  empty?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      {rows.length === 0 && empty && <p className="text-sm text-muted-foreground">{empty}</p>}
      {rows.map((row) => (
        <Link key={row.id} href={`/portal/requests/${row.id}`}>
          <Card className="transition-colors hover:bg-muted/50">
            <CardHeader>
              <CardTitle>{row.title}</CardTitle>
              <CardDescription>Due {formatDate(row.dueDate)}</CardDescription>
              <CardAction>
                <RequestStatusBadge status={row.status} />
              </CardAction>
            </CardHeader>
            {showProgress && (
              <CardContent className="flex items-center gap-3">
                <Progress value={row.progress} aria-label="Progress" />
                <span className="text-sm text-muted-foreground">{row.progress}%</span>
              </CardContent>
            )}
          </Card>
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the test**

Run: `npm run test:e2e`
Expected: still FAIL, later: the contact sees "2026 tax documents" and opens it, and the test waits for the file input because the request page does not exist yet.

---

## Task 3: Request page, uploads, submit, and downloads

**Files:**
- Create: `app/portal/requests/[id]/actions.ts`, `app/portal/requests/[id]/item-card.tsx`, `app/portal/requests/[id]/page.tsx`, `app/api/files/[id]/route.ts`

- [ ] **Step 1: Add the portal actions**

Create `app/portal/requests/[id]/actions.ts`. `createUploadUrl` checks `can_write_document` explicitly before creating the signed URL, so safety does not depend on when Storage evaluates its insert policy for signed uploads. The contact is never trusted for the path: the action builds it from the item's firm and client.

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, invalid, notFound, type ActionResult } from "@/lib/errors";
import { storagePath } from "@/lib/files";
import { createClient } from "@/lib/supabase/server";
import { textAnswerSchema } from "@/lib/validation";

const filenameSchema = z.string().min(1).max(255, "File names must be 255 characters or fewer.");

function revalidateRequestPages() {
  revalidatePath("/portal/requests/[id]", "page");
  revalidatePath("/portal");
}

/**
 * Section 10.5 step 2. Checks can_write_document explicitly so safety does not
 * depend on when Storage evaluates its insert policy for signed uploads.
 */
export async function createUploadUrl(
  itemId: string,
  filename: string,
): Promise<ActionResult<{ path: string; token: string }>> {
  const name = filenameSchema.safeParse(filename);
  if (!name.success) return invalid(name.error);

  const supabase = await createClient();
  const { data: item } = await supabase
    .from("request_items")
    .select("firm_id, requests(client_id)")
    .eq("id", itemId)
    .maybeSingle();
  if (!item?.requests) return fail(notFound);

  const path = storagePath({ firmId: item.firm_id, clientId: item.requests.client_id, itemId }, name.data);
  const { data: allowed, error } = await supabase.rpc("can_write_document", { name: path });
  if (error) return fail(error);
  if (!allowed) return fail(notFound);

  const { data: signed, error: signError } = await supabase.storage.from("documents").createSignedUploadUrl(path);
  if (signError) return fail(signError);
  return { ok: true, data: { path: signed.path, token: signed.token } };
}

export async function registerFile(itemId: string, path: string, filename: string): Promise<ActionResult> {
  const name = filenameSchema.safeParse(filename);
  if (!name.success) return invalid(name.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("register_file", {
    item_id: itemId,
    storage_path: path,
    filename: name.data,
  });
  if (error) return fail(error);

  revalidateRequestPages();
  return { ok: true };
}

export async function removeFile(fileId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: path, error } = await supabase.rpc("remove_file", { file_id: fileId });
  if (error) return fail(error);

  const { error: storageError } = await supabase.storage.from("documents").remove([path]);
  if (storageError) {
    // ponytail: the object is orphaned when this delete fails after remove_file.
    // Upgrade path: a nightly cleanup of objects that have no item_files row.
    console.error("Storage delete failed after remove_file", storageError);
  }

  revalidateRequestPages();
  return { ok: true };
}

/** File items pass no answer; text items pass the answer. */
export async function submitItem(itemId: string, answer?: string): Promise<ActionResult> {
  let textAnswer: string | undefined;
  if (answer !== undefined) {
    const parsed = textAnswerSchema.safeParse(answer);
    if (!parsed.success) return invalid(parsed.error);
    textAnswer = parsed.data;
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_item", { item_id: itemId, text_answer: textAnswer });
  if (error) return fail(error);

  revalidateRequestPages();
  return { ok: true };
}
```

- [ ] **Step 2: Add the item card**

Create `app/portal/requests/[id]/item-card.tsx`. Notes:
- The browser-side type and size checks are for the user only; the bucket and the policies enforce the real limits.
- When the browser reports no type (common for HEIC and CSV), the file is re-wrapped with the type from its extension, because the bucket rejects anything outside its allowed list.
- Files upload one at a time through a promise queue; each shows "Waiting…", "Uploading…", or its error with a Retry button. A finished upload disappears from the queue and shows up in the file list after the page revalidates.
- The item is editable only while the request is `open` and the item is `requested` or `needs_changes`.

```tsx
"use client";

import { useActionState, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { ActionButton } from "@/components/action-button";
import { ItemStatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/errors";
import { ACCEPT_ATTRIBUTE, MAX_FILE_BYTES, uploadMimeType } from "@/lib/files";
import { createClient } from "@/lib/supabase/client";
import { createUploadUrl, registerFile, removeFile, submitItem } from "./actions";

export type PortalItem = {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  required: boolean;
  status: string;
  textAnswer: string | null;
  reviewNote: string | null;
  files: { id: string; filename: string; sizeBytes: number }[];
};

export function ItemCard({ item, requestOpen }: { item: PortalItem; requestOpen: boolean }) {
  // ponytail: optional items lock when a request completes. Upgrade path: allow
  // optional submissions on completed requests.
  const editable = requestOpen && (item.status === "requested" || item.status === "needs_changes");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{item.title}</CardTitle>
        <CardDescription>{item.required ? "Required" : "Optional"}</CardDescription>
        <CardAction>
          <ItemStatusBadge status={item.status} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {item.description && <p className="whitespace-pre-wrap text-sm">{item.description}</p>}
        {item.status === "needs_changes" && item.reviewNote && (
          <Alert variant="destructive">
            <AlertTitle>Changes requested</AlertTitle>
            <AlertDescription className="whitespace-pre-wrap">{item.reviewNote}</AlertDescription>
          </Alert>
        )}
        {item.kind === "file" ? (
          <FileItem item={item} editable={editable} />
        ) : (
          <TextItem item={item} editable={editable} />
        )}
      </CardContent>
    </Card>
  );
}

type Upload = { key: string; file: File; status: "pending" | "uploading" | "failed"; error?: string };

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Section 10.5: create a signed URL, upload straight to Storage, then register the file. */
async function uploadOne(itemId: string, file: File): Promise<string | null> {
  const type = uploadMimeType(file);
  if (!type) return "This file type is not accepted.";
  if (file.size > MAX_FILE_BYTES) return "Files must be 25 MB or smaller.";

  const created = await createUploadUrl(itemId, file.name);
  if (!created.ok) return created.error;
  const { path, token } = created.data!;

  const body = type === file.type ? file : new File([file], file.name, { type });
  const { error } = await createClient().storage.from("documents").uploadToSignedUrl(path, token, body, {
    contentType: type,
  });
  if (error) return "Upload failed. Check your connection and retry.";

  // ponytail: the object is orphaned if register_file fails after the upload.
  // Upgrade path: a nightly cleanup of objects that have no item_files row.
  const registered = await registerFile(itemId, path, file.name);
  return registered.ok ? null : registered.error;
}

function FileItem({ item, editable }: { item: PortalItem; editable: boolean }) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const queue = useRef<Promise<void>>(Promise.resolve());

  function update(key: string, patch: Partial<Upload> | null) {
    setUploads((current) =>
      patch === null ? current.filter((u) => u.key !== key) : current.map((u) => (u.key === key ? { ...u, ...patch } : u)),
    );
  }

  // One file at a time, in the order they were added.
  function enqueue(upload: Upload) {
    queue.current = queue.current.then(async () => {
      update(upload.key, { status: "uploading", error: undefined });
      const error = await uploadOne(item.id, upload.file);
      update(upload.key, error ? { status: "failed", error } : null);
    });
  }

  function addFiles(files: FileList | null) {
    const added = Array.from(files ?? []).map((file) => ({ key: crypto.randomUUID(), file, status: "pending" as const }));
    setUploads((current) => [...current, ...added]);
    added.forEach(enqueue);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  }

  const busy = uploads.some((u) => u.status !== "failed");

  return (
    <div className="flex flex-col gap-3">
      {item.files.length > 0 && (
        <ul className="flex flex-col gap-2">
          {item.files.map((file) => (
            <li key={file.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">
                {file.filename} <span className="text-muted-foreground">({formatSize(file.sizeBytes)})</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <a className="underline" href={`/api/files/${file.id}?download=1`}>
                  Download
                </a>
                {editable && (
                  <ActionButton variant="ghost" size="sm" action={() => removeFile(file.id)} success="File removed.">
                    Remove
                  </ActionButton>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {uploads.length > 0 && (
        <ul className="flex flex-col gap-2">
          {uploads.map((upload) => (
            <li key={upload.key} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{upload.file.name}</span>
              {upload.status === "failed" ? (
                <span className="flex shrink-0 items-center gap-2 text-destructive">
                  {upload.error}
                  <Button variant="outline" size="sm" onClick={() => enqueue(upload)}>
                    Retry
                  </Button>
                </span>
              ) : (
                <span className="shrink-0 text-muted-foreground">
                  {upload.status === "uploading" ? "Uploading…" : "Waiting…"}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <>
          <label
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`flex cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed p-6 text-center text-sm ${
              dragging ? "bg-muted" : ""
            }`}
          >
            <span className="font-medium">Choose files or drag them here</span>
            <span className="text-muted-foreground">PDF, images, Word, Excel, or CSV. Up to 25 MB each.</span>
            <input
              type="file"
              multiple
              accept={ACCEPT_ATTRIBUTE}
              className="sr-only"
              onChange={(event) => {
                addFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
          <ActionButton
            className="self-start"
            disabled={item.files.length === 0 || busy}
            action={() => submitItem(item.id)}
            success="Submitted. We'll let you know if anything else is needed."
          >
            Submit
          </ActionButton>
        </>
      )}
    </div>
  );
}

function TextItem({ item, editable }: { item: PortalItem; editable: boolean }) {
  const [, formAction, pending] = useActionState(async (_prev: ActionResult | null, formData: FormData) => {
    const result = await submitItem(item.id, String(formData.get("answer") ?? ""));
    if (result.ok) toast.success("Submitted. We'll let you know if anything else is needed.");
    else toast.error(result.error);
    return result;
  }, null);

  if (!editable) {
    return <p className="whitespace-pre-wrap text-sm">{item.textAnswer ?? "No answer."}</p>;
  }
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Textarea
        name="answer"
        aria-label={`Answer for ${item.title}`}
        defaultValue={item.textAnswer ?? ""}
        maxLength={5000}
        rows={4}
        required
      />
      <Button type="submit" className="self-start" disabled={pending}>
        Submit
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: Add the request page**

Create `app/portal/requests/[id]/page.tsx`:

```tsx
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RequestStatusBadge } from "@/components/status-badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { getContactClientIds } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { progressPercent } from "../../progress";
import { ItemCard } from "./item-card";

export default function PortalRequestPage({ params }: PageProps<"/portal/requests/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <PortalRequest params={params} />
    </Suspense>
  );
}

async function PortalRequest({ params }: Pick<PageProps<"/portal/requests/[id]">, "params">) {
  const { id } = await params;
  const clientIds = await getContactClientIds();
  const supabase = await createClient();
  const { data: request } = await supabase
    .from("requests")
    .select(
      `id, title, status, due_date, clients(firms(name)),
       request_items(id, position, title, description, kind, required, status, text_answer, review_note,
         item_files(id, filename, size_bytes, created_at))`,
    )
    .eq("id", id)
    .in("client_id", clientIds)
    .neq("status", "draft")
    .order("position", { referencedTable: "request_items" })
    .order("id", { referencedTable: "request_items" })
    .order("created_at", { referencedTable: "request_items.item_files" })
    .maybeSingle();
  if (!request) notFound();

  const progress = progressPercent(request.request_items);
  const open = request.status === "open";

  return (
    <>
      <div className="flex flex-col gap-2">
        <Link href="/portal" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← All requests
        </Link>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
          {request.title} <RequestStatusBadge status={request.status} />
        </h1>
        <p className="text-sm text-muted-foreground">
          From {request.clients?.firms?.name} · Due {formatDate(request.due_date)}
        </p>
        <div className="flex items-center gap-3">
          <Progress value={progress} aria-label="Progress" />
          <span className="text-sm text-muted-foreground">{progress}%</span>
        </div>
        {!open && <p className="text-sm text-muted-foreground">This request is closed. You can still view and download your files.</p>}
      </div>
      {request.request_items.map((item) => (
        <ItemCard
          key={item.id}
          requestOpen={open}
          item={{
            id: item.id,
            title: item.title,
            description: item.description,
            kind: item.kind,
            required: item.required,
            status: item.status,
            textAnswer: item.text_answer,
            reviewNote: item.review_note,
            files: item.item_files.map((f) => ({ id: f.id, filename: f.filename, sizeBytes: f.size_bytes })),
          }}
        />
      ))}
    </>
  );
}
```

- [ ] **Step 4: Add the download route**

Create `app/api/files/[id]/route.ts`. A file the caller cannot see is a 404, never a 403. With `?download=1` the signed URL carries the original filename; otherwise the browser opens the file.

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Redirects to a 60-second signed URL. RLS on item_files and storage.objects
 * decides access; anything the caller cannot see is a 404, never a 403.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/files/[id]">) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: file } = await supabase.from("item_files").select("storage_path, filename").eq("id", id).maybeSingle();
  if (!file) return new NextResponse("Not found", { status: 404 });

  const download = request.nextUrl.searchParams.get("download") === "1";
  const { data, error } = await supabase.storage
    .from("documents")
    .createSignedUrl(file.storage_path, 60, download ? { download: file.filename } : undefined);
  if (error) return new NextResponse("Not found", { status: 404 });

  return NextResponse.redirect(data.signedUrl);
}
```

- [ ] **Step 5: Run the test to make sure it passes**

Run: `npm run test:e2e`
Expected: PASS, `1 passed`. This is the complete spec section 14 test.

- [ ] **Step 6: Check the rest by hand**

Use two browser profiles (or one normal and one private window) with `npm run dev` running: staff in one, the contact in the other.
1. As staff, open an item the contact submitted, type "The scan is blurry." under "What needs to change?", and click "Needs changes". Expected: the item shows "Needs changes", the request badge shows "Open", and the dev server logs a `subject="Changes needed: …"` email.
2. As the contact, reload the request. Expected: a "Changes requested" alert with the note. Click "Remove" next to the file. Expected: toast "File removed." and "Submit" is disabled until a new file is uploaded.
3. As the contact, click "Download" next to a file. Expected: the original filename downloads. Staff "Open" opens it in a new tab.
4. Open `/app` as the contact. Expected: redirect to `/portal`. Open `/portal` as a staff user who is nobody's contact. Expected: "You don't have any requests yet."

- [ ] **Step 7: Verify and commit**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all succeed.

```bash
git add -A
git commit -m "feat: add client portal with direct uploads, submit, and downloads"
```
