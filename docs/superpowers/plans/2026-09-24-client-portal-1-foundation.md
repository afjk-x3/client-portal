# Client Portal Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Next.js 16 app with shadcn/ui and the pure library modules every later phase uses (UTC dates, reminder schedule, safe redirect paths, file helpers, validation, errors, email templates and sender), all unit-tested.

**Architecture:** `create-next-app` scaffolds the repo root. Pure modules live in `lib/` with no server-only imports, so Vitest can load them directly. The email sender is the only server-only module in this phase.

**Tech Stack:** Next.js 16.3.6, React 19, TypeScript strict, Tailwind CSS v4, shadcn/ui (Radix base), TanStack Table v9, zod 4, Resend 6, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-09-24-client-portal-design.md` (sections 3, 7.1, 11.1, 14, 18)
**Index:** [2026-09-24-client-portal.md](2026-09-24-client-portal.md)

---

## Files

| File | Responsibility |
|---|---|
| `next.config.ts` | Enables Cache Components |
| `vitest.config.mts` | Vitest with the `@/` alias from `tsconfig.json` |
| `lib/constants.ts` | `APP_NAME` and the item and file limits |
| `lib/dates.ts` | UTC date helpers and date-picker conversions |
| `lib/reminders.ts` | `reminderDue()` |
| `lib/safe-next-path.ts` | `safeNextPath()` for post-sign-in redirects |
| `lib/files.ts` | Allowed MIME types, `sanitizeFilename()`, `storagePath()`, `uploadMimeType()`, `zipEntryNames()` |
| `lib/errors.ts` | `ActionResult`, `errorMessage()`, `fail()`, `invalid()` |
| `lib/validation.ts` | zod schemas shared by forms and Server Actions |
| `lib/email/templates.ts` | The five email templates, HTML-escaped |
| `lib/email/send.ts` | Resend wrapper with log mode and batching |
| `lib/*.test.ts`, `lib/email/templates.test.ts` | Unit tests |

---

## Task 1: Scaffold the Next.js app

**Files:**
- Create: the `create-next-app` scaffold in the repo root
- Modify: `next.config.ts`, `package.json`, `.gitignore`

- [ ] **Step 1: Scaffold into the repo root**

The repo already holds `docs/` and `.gitattributes`; `create-next-app` accepts both.

```bash
npx create-next-app@16.3.6 . --yes --ts --tailwind --eslint --app --import-alias "@/*" --use-npm
```

Expected: ends with `Success! Created client-portal at …`. It also writes `AGENTS.md` and `CLAUDE.md` with Next.js agent rules; keep them.

- [ ] **Step 2: Use Node 22 types**

Vitest 5 needs `@types/node` 22 or later; the scaffold installs 20.

```bash
npm install -D @types/node@^22
```

- [ ] **Step 3: Enable Cache Components**

Replace `next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
};

export default nextConfig;
```

- [ ] **Step 4: Add the typecheck script**

In `package.json`, add to `"scripts"`:

```json
"typecheck": "next typegen && tsc --noEmit"
```

`next typegen` writes the global route types (`PageProps`, `LayoutProps`, `RouteContext`) that `tsc` needs.

- [ ] **Step 5: Ignore test output and allow `.env.example`**

In `.gitignore`, change the `# testing` block to:

```gitignore
# testing
/coverage
/test-results/
/playwright-report/
```

and add `!.env.example` directly below the `.env*` line.

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm run build`
Expected: `✓ Types generated successfully`; the build output includes `- Cache Components enabled` and ends with the route table showing `○ /`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js 16 app with Cache Components"
```

---

## Task 2: Add shadcn/ui and TanStack Table

**Files:**
- Create: `components.json`, `lib/utils.ts`, `components/ui/*`, `hooks/use-mobile.ts` (all generated)
- Modify: `app/globals.css`, `package.json` (generated)

The shadcn CLI downloads components from `ui.shadcn.com`, so this step needs network access to that host. The rest of the plan uses the Radix flavor of the components (`asChild`, Radix `Select`, and so on), so pass `--base radix`.

- [ ] **Step 1: Initialize shadcn/ui**

```bash
npx shadcn@latest init --base radix --preset nova --yes
```

Expected: creates `components.json` and `lib/utils.ts` (the `cn()` helper) and rewrites `app/globals.css` with the theme tokens. Accept any default the CLI still asks about.

- [ ] **Step 2: Add the components the app uses**

```bash
npx shadcn@latest add button input label textarea select checkbox switch card table badge alert progress tabs dialog alert-dialog sheet popover calendar sidebar sonner skeleton separator --yes
```

Expected: files under `components/ui/` for each name, plus the sidebar's dependencies (`tooltip`, `hooks/use-mobile.ts`). The CLI installs `radix-ui`, `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css`, `next-themes` (used by the Sonner toaster), and `react-day-picker` (used by the Calendar).

- [ ] **Step 3: Install TanStack Table for DataTable**

```bash
npm install @tanstack/react-table
```

This installs v9. Its API is `useTable({ features, columns, data })` with `table.FlexRender`; older `useReactTable` examples do not apply.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: add shadcn/ui components and TanStack Table"
```

---

## Task 3: Vitest, UTC dates, and `reminderDue`

**Files:**
- Create: `vitest.config.mts`, `lib/dates.ts`, `lib/reminders.ts`
- Test: `lib/reminders.test.ts`

- [ ] **Step 1: Install Vitest and add the config**

```bash
npm install -D vitest
```

Create `vitest.config.mts` (the `.mts` extension avoids Vite's CommonJS warning):

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: { include: ["lib/**/*.test.ts"] },
});
```

In `package.json`, add to `"scripts"`:

```json
"test": "vitest run"
```

- [ ] **Step 2: Write the failing test**

Create `lib/reminders.test.ts`. The cases are the ones in spec section 14 (`d` = 8, 7, 1, 0, −1, −3, −6, and `sentOn = today`):

```ts
import { describe, expect, it } from "vitest";
import { reminderDue } from "@/lib/reminders";

const today = "2027-03-10";
const sentOn = "2027-03-01";

function dueIn(days: number): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe("reminderDue", () => {
  it.each([
    [8, false],
    [7, true],
    [1, false],
    [0, true],
    [-1, false],
    [-3, true],
    [-6, true],
  ])("due in %i days -> %s", (days, expected) => {
    expect(reminderDue({ dueDate: dueIn(days), sentOn, today })).toBe(expected);
  });

  it("never reminds on the day the request was sent", () => {
    expect(reminderDue({ dueDate: dueIn(7), sentOn: today, today })).toBe(false);
  });

  it("counts days across month boundaries", () => {
    expect(reminderDue({ dueDate: "2027-03-07", sentOn, today: "2027-02-28" })).toBe(true);
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `npm test`
Expected: FAIL, because `@/lib/reminders` cannot be resolved.

- [ ] **Step 4: Write the date helpers**

Create `lib/dates.ts`. `toDateString()` and `fromDateString()` use the browser's local calendar day on purpose: a date picked at midnight local time must not shift to the previous day in time zones ahead of UTC.

```ts
// ponytail: dates, due dates, and "overdue" use UTC. Upgrade path: add
// firms.timezone and compute "today" per firm.

const DAY_MS = 86_400_000;

/** Today's date in UTC as YYYY-MM-DD. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; both are YYYY-MM-DD. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export function isOverdue(dueDate: string, today: string = todayUtc()): boolean {
  return dueDate < today;
}

/** "Mar 5, 2027" for a YYYY-MM-DD date. */
export function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "Mar 5, 2027, 2:30 PM UTC" for a timestamp. */
export function formatDateTime(timestamp: string): string {
  const formatted = new Date(timestamp).toLocaleString("en-US", {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  });
  return `${formatted} UTC`;
}

/** YYYY-MM-DD for a date picked in the browser (local calendar day). */
export function toDateString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A local Date for a YYYY-MM-DD string, for date pickers. */
export function fromDateString(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}
```

- [ ] **Step 5: Write `reminderDue`**

Create `lib/reminders.ts`:

```ts
import { daysBetween } from "@/lib/dates";

/**
 * Whether an open request gets a reminder today. All dates are YYYY-MM-DD
 * in UTC. Reminders go out 7 days before the due date, on the due date, and
 * every 3 days after it, but never on the day the request was sent.
 */
export function reminderDue({
  dueDate,
  sentOn,
  today,
}: {
  dueDate: string;
  sentOn: string;
  today: string;
}): boolean {
  if (sentOn === today) return false;
  const d = daysBetween(today, dueDate);
  return d === 7 || d === 0 || (d < 0 && -d % 3 === 0);
}
```

- [ ] **Step 6: Run the test to make sure it passes**

Run: `npm test`
Expected: PASS, `Tests  9 passed (9)`.

- [ ] **Step 7: Commit**

```bash
git add vitest.config.mts package.json package-lock.json lib/dates.ts lib/reminders.ts lib/reminders.test.ts
git commit -m "feat: add UTC date helpers and reminder schedule"
```

---

## Task 4: `safeNextPath`

**Files:**
- Create: `lib/safe-next-path.ts`
- Test: `lib/safe-next-path.test.ts`

`safeNextPath` lives in its own module rather than `lib/auth.ts` because `lib/auth.ts` imports `server-only`, which throws when Vitest imports it.

- [ ] **Step 1: Write the failing test**

Create `lib/safe-next-path.test.ts`. Besides the spec's rules (must start with `/`, must not start with `//`), it rejects backslashes and control characters, because browsers turn `/\evil.example` and `/<tab>/evil.example` into `//evil.example`:

```ts
import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/safe-next-path";

describe("safeNextPath", () => {
  it.each(["/app", "/portal/requests/123?tab=files", "/app/clients#contacts"])("accepts %s", (path) => {
    expect(safeNextPath(path)).toBe(path);
  });

  it.each([
    null,
    undefined,
    "",
    "app",
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "/app\n",
  ])("rejects %j", (path) => {
    expect(safeNextPath(path)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- lib/safe-next-path.test.ts`
Expected: FAIL, because `@/lib/safe-next-path` cannot be resolved.

- [ ] **Step 3: Implement**

Create `lib/safe-next-path.ts`:

```ts
/**
 * Returns `next` when it is a safe relative path for a post-sign-in redirect,
 * otherwise null. Rejects protocol-relative URLs ("//host", "/\host") and
 * control characters, which browsers strip before resolving a URL.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return null;
  return next;
}
```

- [ ] **Step 4: Run the test to make sure it passes**

Run: `npm test -- lib/safe-next-path.test.ts`
Expected: PASS, `Tests  12 passed (12)`.

- [ ] **Step 5: Commit**

```bash
git add lib/safe-next-path.ts lib/safe-next-path.test.ts
git commit -m "feat: add safeNextPath for post-sign-in redirects"
```

---

## Task 5: File helpers

**Files:**
- Create: `lib/files.ts`
- Test: `lib/files.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/files.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sanitizeFilename, storagePath, uploadMimeType, zipEntryNames } from "@/lib/files";

describe("sanitizeFilename", () => {
  it("keeps safe characters", () => {
    expect(sanitizeFilename("W-2_2026.final.pdf")).toBe("W-2_2026.final.pdf");
  });

  it("replaces everything outside [A-Za-z0-9._-]", () => {
    expect(sanitizeFilename("my tax/return (1)é.pdf")).toBe("my_tax_return__1__.pdf");
  });

  it("truncates to 100 characters", () => {
    expect(sanitizeFilename(`${"a".repeat(150)}.pdf`)).toHaveLength(100);
  });

  it("never returns an empty name", () => {
    expect(sanitizeFilename("")).toBe("file");
  });
});

describe("storagePath", () => {
  it("builds {firm}/{client}/{item}/{uuid}-{safe name}", () => {
    expect(storagePath({ firmId: "f", clientId: "c", itemId: "i" }, "a b.pdf", "u")).toBe("f/c/i/u-a_b.pdf");
  });
});

describe("uploadMimeType", () => {
  it("uses an allowed declared type", () => {
    expect(uploadMimeType({ name: "scan.pdf", type: "application/pdf" })).toBe("application/pdf");
  });

  it("falls back to the extension when the type is empty", () => {
    expect(uploadMimeType({ name: "IMG_0001.HEIC", type: "" })).toBe("image/heic");
  });

  it("rejects other types", () => {
    expect(uploadMimeType({ name: "run.exe", type: "application/x-msdownload" })).toBeNull();
  });
});

describe("zipEntryNames", () => {
  it("numbers folders and suffixes duplicate names", () => {
    expect(
      zipEntryNames([
        { itemNumber: 1, itemTitle: "Photo ID", filename: "scan.pdf" },
        { itemNumber: 1, itemTitle: "Photo ID", filename: "scan.pdf" },
        { itemNumber: 12, itemTitle: "W-2 / 1099", filename: "a:b.pdf" },
      ]),
    ).toEqual(["01 Photo ID/scan.pdf", "01 Photo ID/scan (2).pdf", "12 W-2 _ 1099/a_b.pdf"]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- lib/files.test.ts`
Expected: FAIL, because `@/lib/files` cannot be resolved.

- [ ] **Step 3: Implement**

Create `lib/files.ts`. `ALLOWED_MIME_TYPES` must stay identical to `allowed_mime_types` on the `documents` bucket (Phase 2, Task 2).

```ts
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  csv: "text/csv",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

// ponytail: the MIME type is the declared type only, and files are not
// virus-scanned. Upgrade path: add a scanning step before register_file.

/** Must match allowed_mime_types on the documents bucket. */
export const ALLOWED_MIME_TYPES: readonly string[] = [...new Set(Object.values(MIME_BY_EXTENSION))];

/** Value for <input type="file" accept>. */
export const ACCEPT_ATTRIBUTE = Object.keys(MIME_BY_EXTENSION)
  .map((extension) => `.${extension}`)
  .join(",");

/**
 * The declared MIME type to upload a file with, or null when the type is not
 * allowed. Falls back to the extension because browsers often report an empty
 * type (HEIC, CSV on some systems).
 */
export function uploadMimeType(file: { name: string; type: string }): string | null {
  if (ALLOWED_MIME_TYPES.includes(file.type)) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? null;
}

/** Replaces every character outside [A-Za-z0-9._-] with "_" and keeps 100 characters. */
export function sanitizeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 100) || "file";
}

/** {firm_id}/{client_id}/{item_id}/{random uuid}-{safe name} */
export function storagePath(
  ids: { firmId: string; clientId: string; itemId: string },
  filename: string,
  id: string = crypto.randomUUID(),
): string {
  return `${ids.firmId}/${ids.clientId}/${ids.itemId}/${id}-${sanitizeFilename(filename)}`;
}

function zipSafe(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 100) || "untitled";
}

/**
 * Zip entry names "{NN} {item title}/{filename}". Names are sanitized, and
 * duplicates within a folder get " (2)", " (3)", ... before the extension.
 */
export function zipEntryNames(
  entries: { itemNumber: number; itemTitle: string; filename: string }[],
): string[] {
  const used = new Set<string>();
  return entries.map(({ itemNumber, itemTitle, filename }) => {
    const folder = `${String(itemNumber).padStart(2, "0")} ${zipSafe(itemTitle)}`;
    const base = zipSafe(filename);
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const extension = dot > 0 ? base.slice(dot) : "";
    let name = `${folder}/${base}`;
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      name = `${folder}/${stem} (${n})${extension}`;
    }
    used.add(name.toLowerCase());
    return name;
  });
}
```

- [ ] **Step 4: Run the test to make sure it passes**

Run: `npm test -- lib/files.test.ts`
Expected: PASS, `Tests  9 passed (9)`.

- [ ] **Step 5: Commit**

```bash
git add lib/files.ts lib/files.test.ts
git commit -m "feat: add file name, storage path, MIME, and zip name helpers"
```

---

## Task 6: Constants, errors, and validation schemas

**Files:**
- Create: `lib/constants.ts`, `lib/errors.ts`, `lib/validation.ts`

These are declarative; the Server Actions that use them are covered by the end-to-end test.

- [ ] **Step 1: Install zod**

```bash
npm install zod
```

- [ ] **Step 2: Create `lib/constants.ts`**

```ts
export const APP_NAME = "Client Portal";

export const MAX_ITEMS_PER_REQUEST = 100;
export const MAX_FILES_PER_ITEM = 20;
```

- [ ] **Step 3: Create `lib/errors.ts`**

Every Server Action returns `ActionResult`. RPCs raise `not_allowed` or `invalid_state` (spec section 8.3); `errorMessage()` maps those and common SQLSTATE codes to text and logs anything unexpected. `staleState` and `notFound` are the error shapes for guarded updates that matched no row.

```ts
import type { z } from "zod";

/** What every Server Action returns. */
export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

type SupabaseError = { message: string; code?: string } | null | undefined;

const MESSAGES: Record<string, string> = {
  not_allowed: "That isn't available to you. It may have been removed.",
  invalid_state: "This has changed since the page loaded. Refresh and try again.",
};

/**
 * User-facing text for a Supabase error. RPCs raise `not_allowed` or
 * `invalid_state`; Postgres errors arrive as SQLSTATE codes. `overrides`
 * maps a SQLSTATE code to a message for one call site.
 */
export function errorMessage(error: SupabaseError, overrides: Record<string, string> = {}): string {
  if (error?.code && overrides[error.code]) return overrides[error.code];
  if (error && MESSAGES[error.message]) return MESSAGES[error.message];
  if (error?.code === "42501" || error?.code === "23503") return MESSAGES.not_allowed;
  if (error?.code === "23505") return "That already exists.";
  if (error?.code === "23514") return "A value is empty or too long.";
  console.error("Unexpected Supabase error", error);
  return "Something went wrong. Try again.";
}

export function fail(error: SupabaseError, overrides?: Record<string, string>): { ok: false; error: string } {
  return { ok: false, error: errorMessage(error, overrides) };
}

/** A failed guarded update: no row matched the expected state. */
export const staleState = { message: "invalid_state" };
/** No row visible to the caller. */
export const notFound = { message: "not_allowed" };

export function invalid(error: z.ZodError): { ok: false; error: string } {
  return { ok: false, error: error.issues[0]?.message ?? "Check the form and try again." };
}
```

- [ ] **Step 4: Create `lib/validation.ts`**

The limits match the database check constraints in Phase 2 (spec section 7.1). Forms reuse the same numbers as `maxLength`.

```ts
import { z } from "zod";
import { MAX_ITEMS_PER_REQUEST } from "@/lib/constants";

// Limits match the check constraints in supabase/migrations.
const text = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be ${max} characters or fewer.`);

export const firmNameSchema = text("Firm name", 120);
export const personNameSchema = text("Name", 200);
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address."));
export const reviewNoteSchema = text("Note", 1000);
export const textAnswerSchema = text("Answer", 5000);
export const dueDateSchema = z.iso.date("Pick a due date.");

export const onboardingSchema = z.object({
  firmName: firmNameSchema,
  fullName: personNameSchema,
});

export const clientSchema = z.object({
  name: text("Client name", 200),
  kind: z.enum(["individual", "business"]),
  // "none" because a select option cannot have an empty value.
  ownerId: z.union([z.literal("none"), z.uuid()]).transform((v) => (v === "none" ? null : v)),
});

export const contactSchema = z.object({
  fullName: personNameSchema,
  email: emailSchema,
});

export const staffSchema = z.object({
  fullName: personNameSchema,
  email: emailSchema,
  role: z.enum(["admin", "staff"]),
});

export const itemSchema = z.object({
  title: text("Item title", 200),
  description: z
    .string()
    .trim()
    .max(2000, "Descriptions must be 2,000 characters or fewer.")
    .transform((v) => v || null),
  kind: z.enum(["file", "text"]),
  required: z.boolean(),
});

export const itemsSchema = z
  .array(itemSchema)
  .max(MAX_ITEMS_PER_REQUEST, `A request can have at most ${MAX_ITEMS_PER_REQUEST} items.`);

export const draftSchema = z.object({
  requestId: z.uuid().optional(),
  clientId: z.uuid(),
  title: text("Title", 200),
  dueDate: dueDateSchema,
  items: itemsSchema,
});

export const requestDetailsSchema = z.object({
  title: text("Title", 200),
  dueDate: dueDateSchema,
});

export const templateSchema = z.object({
  templateId: z.uuid(),
  name: text("Template name", 200),
  items: itemsSchema,
});

export type ItemInput = z.input<typeof itemSchema>;
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json lib/constants.ts lib/errors.ts lib/validation.ts
git commit -m "feat: add constants, action results, and validation schemas"
```

---

## Task 7: Email templates and sender

**Files:**
- Create: `lib/email/templates.ts`, `lib/email/send.ts`
- Test: `lib/email/templates.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/email/templates.test.ts`. It checks the rule from spec section 13: every value a user typed is HTML-escaped, and links are absolute app URLs.

```ts
import { describe, expect, it } from "vitest";
import { requestSentEmail } from "@/lib/email/templates";

describe("email templates", () => {
  it("escapes every value a user typed", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://portal.example";
    const email = requestSentEmail({
      firmName: "Smith & <Co>",
      title: '<script>alert("x")</script>',
      dueDate: "2027-04-15",
      itemCount: 2,
      requestId: "r1",
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(email.html).toContain("Smith &amp; &lt;Co&gt;");
    expect(email.html).toContain('href="https://portal.example/portal/requests/r1"');
    expect(email.text).toContain("due Apr 15, 2027");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- lib/email`
Expected: FAIL, because `@/lib/email/templates` cannot be resolved.

- [ ] **Step 3: Write the templates**

Create `lib/email/templates.ts`. Each template returns `{ subject, html, text }`; subjects drop line breaks so user text cannot inject headers.

```ts
import { APP_NAME } from "@/lib/constants";
import { formatDate } from "@/lib/dates";

export type EmailContent = { subject: string; html: string; text: string };

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Absolute link to an app page. Emails never link to auth tokens. */
export function siteUrl(path: string): string {
  return new URL(path, process.env.NEXT_PUBLIC_SITE_URL).toString();
}

function subjectLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

/** Wraps already-escaped HTML paragraphs and one link. */
function html(paragraphs: string[], link: { href: string; label: string }): string {
  const body = paragraphs.map((p) => `<p>${p}</p>`).join("");
  return (
    `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111">` +
    `${body}<p><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></p></div>`
  );
}

function list(values: string[]): string {
  return `<ul>${values.map((v) => `<li>${escapeHtml(v)}</li>`).join("")}</ul>`;
}

export function staffAddedEmail(input: { firmName: string; adminName: string }): EmailContent {
  const link = siteUrl("/login");
  return {
    subject: subjectLine(`You've been added to ${input.firmName}`),
    html: html(
      [
        `${escapeHtml(input.adminName)} added you to <strong>${escapeHtml(input.firmName)}</strong> on ${APP_NAME}.`,
        "Sign in with your email address. We'll send you a 6-digit code.",
      ],
      { href: link, label: "Sign in" },
    ),
    text: `${input.adminName} added you to ${input.firmName} on ${APP_NAME}.\n\nSign in with your email address: ${link}`,
  };
}

export function requestSentEmail(input: {
  firmName: string;
  title: string;
  dueDate: string;
  itemCount: number;
  requestId: string;
}): EmailContent {
  const link = siteUrl(`/portal/requests/${input.requestId}`);
  const due = formatDate(input.dueDate);
  const items = input.itemCount === 1 ? "1 item" : `${input.itemCount} items`;
  return {
    subject: subjectLine(`${input.firmName} needs documents from you: ${input.title}`),
    html: html(
      [
        `${escapeHtml(input.firmName)} sent you a request: <strong>${escapeHtml(input.title)}</strong>.`,
        `It has ${items} and is due ${escapeHtml(due)}.`,
      ],
      { href: link, label: "Open the request" },
    ),
    text: `${input.firmName} sent you a request: ${input.title}.\nIt has ${items} and is due ${due}.\n\nOpen the request: ${link}`,
  };
}

export function needsChangesEmail(input: {
  firmName: string;
  itemTitle: string;
  note: string;
  requestId: string;
}): EmailContent {
  const link = siteUrl(`/portal/requests/${input.requestId}`);
  return {
    subject: subjectLine(`Changes needed: ${input.itemTitle}`),
    html: html(
      [
        `${escapeHtml(input.firmName)} asked for changes to <strong>${escapeHtml(input.itemTitle)}</strong>:`,
        escapeHtml(input.note),
      ],
      { href: link, label: "Open the request" },
    ),
    text: `${input.firmName} asked for changes to ${input.itemTitle}:\n\n${input.note}\n\nOpen the request: ${link}`,
  };
}

export function reminderEmail(input: {
  firmName: string;
  title: string;
  dueDate: string;
  overdue: boolean;
  openItems: string[];
  requestId: string;
}): EmailContent {
  const link = siteUrl(`/portal/requests/${input.requestId}`);
  const due = formatDate(input.dueDate);
  const when = input.overdue ? `was due ${due}` : `is due ${due}`;
  return {
    subject: subjectLine(`Reminder: ${input.title} ${when}`),
    html: html(
      [
        `${escapeHtml(input.firmName)} is still waiting on these items for <strong>${escapeHtml(input.title)}</strong>, which ${escapeHtml(when)}:`,
        list(input.openItems),
      ],
      { href: link, label: "Open the request" },
    ),
    text:
      `${input.firmName} is still waiting on these items for ${input.title}, which ${when}:\n\n` +
      input.openItems.map((item) => `- ${item}`).join("\n") +
      `\n\nOpen the request: ${link}`,
  };
}

export type DigestGroup = {
  clientName: string;
  requestTitle: string;
  requestId: string;
  items: string[];
};

export function staffDigestEmail(input: { firmName: string; groups: DigestGroup[] }): EmailContent {
  const count = input.groups.reduce((sum, group) => sum + group.items.length, 0);
  const noun = count === 1 ? "item" : "items";
  const dashboard = siteUrl("/app");
  return {
    subject: subjectLine(`${count} ${noun} submitted at ${input.firmName}`),
    html: html(
      [
        `Clients submitted ${count} ${noun} since the last digest:`,
        ...input.groups.map(
          (group) =>
            `<a href="${escapeHtml(siteUrl(`/app/requests/${group.requestId}`))}">` +
            `${escapeHtml(group.clientName)}: ${escapeHtml(group.requestTitle)}</a>${list(group.items)}`,
        ),
      ],
      { href: dashboard, label: "Open the dashboard" },
    ),
    text:
      `Clients submitted ${count} ${noun} since the last digest:\n\n` +
      input.groups
        .map(
          (group) =>
            `${group.clientName}: ${group.requestTitle}\n${siteUrl(`/app/requests/${group.requestId}`)}\n` +
            group.items.map((item) => `- ${item}`).join("\n"),
        )
        .join("\n\n") +
      `\n\nOpen the dashboard: ${dashboard}`,
  };
}
```

- [ ] **Step 4: Run the test to make sure it passes**

Run: `npm test -- lib/email`
Expected: PASS, `Tests  1 passed (1)`.

- [ ] **Step 5: Write the sender**

```bash
npm install resend server-only
```

Create `lib/email/send.ts`. Without `RESEND_API_KEY` it logs each message instead of sending (development and tests). With a key it sends batches of at most 100 through `resend.batch.send`, pausing between batches to stay under Resend's default rate limit. It never throws.

```ts
import "server-only";
import { Resend } from "resend";
import { APP_NAME } from "@/lib/constants";
import type { EmailContent } from "@/lib/email/templates";

export type EmailMessage = EmailContent & {
  to: string;
  /** Shown as "{fromName} via Client Portal". */
  fromName: string;
  replyTo?: string;
};

const BATCH_SIZE = 100; // Resend's per-call maximum
const PAUSE_MS = 600; // stay under Resend's default 2 requests per second

function fromHeader(fromName: string): string {
  const name = `${fromName} via ${APP_NAME}`.replace(/["<>\r\n]/g, "");
  return `"${name}" <${process.env.EMAIL_FROM}>`;
}

/**
 * Sends emails in batches. Failures are logged and counted, never thrown.
 * Without RESEND_API_KEY (development, tests) each email is logged instead.
 */
export async function sendEmails(messages: EmailMessage[]): Promise<{ sent: number; failed: number }> {
  if (messages.length === 0) return { sent: 0, failed: 0 };

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    for (const m of messages) {
      console.log(`[email] to=${m.to} subject=${JSON.stringify(m.subject)}\n${m.text}`);
    }
    return { sent: messages.length, failed: 0 };
  }

  const resend = new Resend(apiKey);
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
    const batch = messages.slice(i, i + BATCH_SIZE);
    try {
      const { error } = await resend.batch.send(
        batch.map((m) => ({
          from: fromHeader(m.fromName),
          to: m.to,
          subject: m.subject,
          html: m.html,
          text: m.text,
          replyTo: m.replyTo,
        })),
      );
      if (error) throw error;
      sent += batch.length;
    } catch (error) {
      failed += batch.length;
      console.error("[email] batch failed", error);
    }
  }
  return { sent, failed };
}
```

- [ ] **Step 6: Verify the whole phase**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: `Test Files  4 passed (4)`, `Tests  31 passed (31)`; typecheck, lint, and build succeed.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json lib/email
git commit -m "feat: add email templates and Resend sender with log mode"
```
