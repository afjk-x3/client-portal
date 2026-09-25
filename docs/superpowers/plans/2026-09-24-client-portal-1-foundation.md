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
| `lib/constants.ts` | `APP_NAME`, item and file counts, and the text `LIMITS` shared by schemas and forms |
| `lib/dates.ts` | UTC date helpers and date-picker conversions |
| `lib/reminders.ts` | `reminderDue()` |
| `lib/safe-next-path.ts` | `safeNextPath()` for post-sign-in redirects |
| `lib/files.ts` | Allowed MIME types, `sanitizeFilename()`, `storagePath()`, `uploadMimeType()`, `zipEntryNames()` |
| `lib/errors.ts` | `ActionResult`, `errorMessage()`, `fail()`, `invalid()` |
| `lib/validation.ts` | zod schemas shared by forms and Server Actions |
| `lib/email/templates.ts` | The five email templates, HTML-escaped |
| `lib/email/send.ts` | Resend wrapper with log mode and batching |
| `lib/*.test.ts`, `lib/email/*.test.ts` | Unit tests |

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

Create `lib/safe-next-path.test.ts`. Besides the spec's rules (must start with `/`, must not start with `//`), it rejects backslashes and control characters, because browsers turn `/\evil.example` and `/<tab>/evil.example` into `//evil.example`, and it resolves `.` and `..` segments, which could otherwise turn `/..//evil.example` into `//evil.example`:

```ts
import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/safe-next-path";

describe("safeNextPath", () => {
  it.each(["/app", "/portal/requests/123?tab=files", "/app/clients#contacts"])("accepts %s", (path) => {
    expect(safeNextPath(path)).toBe(path);
  });

  it("resolves dot segments", () => {
    expect(safeNextPath("/app/./clients/../templates")).toBe("/app/templates");
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
    "/.//evil.example",
    "/..//evil.example",
    "/%2e%2e//evil.example",
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
const BASE = "http://next.invalid";

/**
 * Returns `next` as a safe relative path for a post-sign-in redirect,
 * otherwise null. Rejects protocol-relative URLs ("//host", "/\host") and
 * control characters, which browsers strip before resolving a URL, then
 * resolves "." and ".." segments so "/..//host" cannot become "//host".
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return null;
  const url = new URL(next, BASE);
  if (url.origin !== BASE || url.pathname.startsWith("//")) return null;
  return url.pathname + url.search + url.hash;
}
```

- [ ] **Step 4: Run the test to make sure it passes**

Run: `npm test -- lib/safe-next-path.test.ts`
Expected: PASS, `Tests  16 passed (16)`.

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

  it("keeps at most 100 characters without losing the extension", () => {
    const safe = sanitizeFilename(`${"a".repeat(150)}.pdf`);
    expect(safe).toHaveLength(100);
    expect(safe.endsWith(".pdf")).toBe(true);
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

  it.each(["x.constructor", "x.__proto__", "pdf", ".pdf"])("rejects %j", (name) => {
    expect(uploadMimeType({ name, type: "" })).toBeNull();
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

  it("keeps the extension of long names and never uses . or ..", () => {
    const [long, dots] = zipEntryNames([
      { itemNumber: 1, itemTitle: "Statements", filename: `${"s".repeat(120)}.pdf` },
      { itemNumber: 1, itemTitle: "Statements", filename: ".." },
    ]);
    expect(long).toBe(`01 Statements/${"s".repeat(96)}.pdf`);
    expect(dots).toBe("01 Statements/untitled");
  });

  it("avoids names Windows cannot create", () => {
    expect(
      zipEntryNames([
        { itemNumber: 7, itemTitle: "Anything else we should know.", filename: "notes." },
        { itemNumber: 7, itemTitle: "Anything else we should know.", filename: "CON.pdf" },
        { itemNumber: 7, itemTitle: "Anything else we should know.", filename: `${"s".repeat(99)} tail` },
      ]),
    ).toEqual([
      "07 Anything else we should know/notes",
      "07 Anything else we should know/_CON.pdf",
      `07 Anything else we should know/${"s".repeat(99)}`,
    ]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- lib/files.test.ts`
Expected: FAIL, because `@/lib/files` cannot be resolved.

- [ ] **Step 3: Implement**

Create `lib/files.ts`. `ALLOWED_MIME_TYPES` must stay identical to `allowed_mime_types` on the `documents` bucket (Phase 2, Task 2). Truncation shortens the name before the extension so the extension survives, and extension lookups use `Object.hasOwn` so names like `x.constructor` are not mistaken for an allowed type.

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

/** Must match allowed_mime_types on the documents bucket and the extensions in register_file. */
export const ALLOWED_MIME_TYPES: readonly string[] = [...new Set(Object.values(MIME_BY_EXTENSION))];

/** Value for <input type="file" accept>. */
export const ACCEPT_ATTRIBUTE = Object.keys(MIME_BY_EXTENSION)
  .map((extension) => `.${extension}`)
  .join(",");

/** Splits "name.ext" into ["name", ".ext"]. A leading dot does not start an extension. */
function splitExtension(name: string): [string, string] {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
}

/** Keeps at most `max` characters, shortening the stem so the extension survives. */
function truncate(name: string, max: number): string {
  const chars = Array.from(name);
  if (chars.length <= max) return name;
  const [stem, extension] = splitExtension(name);
  const extensionLength = Array.from(extension).length;
  if (extensionLength >= max) return chars.slice(0, max).join("");
  return Array.from(stem).slice(0, max - extensionLength).join("") + extension;
}

/**
 * The declared MIME type to upload a file with, or null when the type is not
 * allowed. Falls back to the extension because browsers often report an empty
 * type (HEIC, CSV on some systems).
 */
export function uploadMimeType(file: { name: string; type: string }): string | null {
  if (ALLOWED_MIME_TYPES.includes(file.type)) return file.type;
  const extension = splitExtension(file.name)[1].slice(1).toLowerCase();
  return Object.hasOwn(MIME_BY_EXTENSION, extension) ? MIME_BY_EXTENSION[extension] : null;
}

/** Replaces every character outside [A-Za-z0-9._-] with "_" and keeps 100 characters, extension included. */
export function sanitizeFilename(name: string): string {
  return truncate(name.replace(/[^A-Za-z0-9._-]/g, "_"), 100) || "file";
}

/** {firm_id}/{client_id}/{item_id}/{random uuid}-{safe name} */
export function storagePath(
  ids: { firmId: string; clientId: string; itemId: string },
  filename: string,
  id: string = crypto.randomUUID(),
): string {
  return `${ids.firmId}/${ids.clientId}/${ids.itemId}/${id}-${sanitizeFilename(filename)}`;
}

// Device names Windows reserves, alone or before an extension.
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

function zipSafe(name: string): string {
  // Windows drops trailing dots and spaces, and extractors skip "." and "..".
  const safe = truncate(name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim(), 100).replace(/[. ]+$/, "");
  if (safe === "") return "untitled";
  return WINDOWS_RESERVED.test(safe) ? `_${safe}` : safe;
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
    const [stem, extension] = splitExtension(base);
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
Expected: PASS, `Tests  15 passed (15)`.

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

/**
 * Text limits in characters. The database check constraints in
 * supabase/migrations use the same numbers; forms use them as maxLength.
 */
export const LIMITS = {
  firmName: 120,
  name: 200,
  description: 2000,
  textAnswer: 5000,
  reviewNote: 1000,
  filename: 255,
} as const;
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
  if (error?.code && Object.hasOwn(overrides, error.code)) return overrides[error.code];
  if (error && Object.hasOwn(MESSAGES, error.message)) return MESSAGES[error.message];
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

The limits come from `LIMITS` in `lib/constants.ts`, which matches the database check constraints in Phase 2 (spec section 7.1). Forms use the same `LIMITS` values as `maxLength`.

```ts
import { z } from "zod";
import { LIMITS, MAX_ITEMS_PER_REQUEST } from "@/lib/constants";

const text = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be ${max.toLocaleString("en-US")} characters or fewer.`);

export const firmNameSchema = text("Firm name", LIMITS.firmName);
export const personNameSchema = text("Name", LIMITS.name);
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address."));
export const reviewNoteSchema = text("Note", LIMITS.reviewNote);
export const textAnswerSchema = text("Answer", LIMITS.textAnswer);
export const filenameSchema = text("File name", LIMITS.filename);
export const dueDateSchema = z.iso.date("Pick a due date.");
export const roleSchema = z.enum(["admin", "staff"]);

const idSchema = z.uuid();

/** True for a well-formed id. Actions and pages treat anything else as not found. */
export function isId(value: unknown): value is string {
  return idSchema.safeParse(value).success;
}

export const onboardingSchema = z.object({
  firmName: firmNameSchema,
  fullName: personNameSchema,
});

export const clientSchema = z.object({
  name: text("Client name", LIMITS.name),
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
  role: roleSchema,
});

export const itemSchema = z.object({
  title: text("Item title", LIMITS.name),
  description: z
    .string()
    .trim()
    .max(LIMITS.description, "Descriptions must be 2,000 characters or fewer.")
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
  title: text("Title", LIMITS.name),
  dueDate: dueDateSchema,
  items: itemsSchema,
});

export const requestDetailsSchema = z.object({
  title: text("Title", LIMITS.name),
  dueDate: dueDateSchema,
});

export const templateSchema = z.object({
  templateId: z.uuid(),
  name: text("Template name", LIMITS.name),
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
- Test: `lib/email/templates.test.ts`, `lib/email/send.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/email/templates.test.ts`. It checks the rule from spec section 13 for all five templates: every value a user typed is HTML-escaped, subjects stay on one line, lists are never nested in paragraphs, and links are absolute app URLs.

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  needsChangesEmail,
  reminderEmail,
  requestSentEmail,
  staffAddedEmail,
  staffDigestEmail,
} from "@/lib/email/templates";

// Every value a user can type, with markup, quotes, and a header-injection attempt.
const evil = `<img src=x onerror="alert(1)">&'\r\nBcc: victim@evil.example`;
const escaped = "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;";

const templates = {
  staffAdded: () => staffAddedEmail({ firmName: evil, adminName: evil }),
  requestSent: () =>
    requestSentEmail({ firmName: evil, title: evil, dueDate: "2027-04-15", itemCount: 2, requestId: "r1" }),
  needsChanges: () => needsChangesEmail({ firmName: evil, itemTitle: evil, note: evil, requestId: "r1" }),
  reminder: () =>
    reminderEmail({
      firmName: evil,
      title: evil,
      dueDate: "2027-04-15",
      overdue: true,
      openItems: [evil],
      requestId: "r1",
    }),
  staffDigest: () =>
    staffDigestEmail({
      firmName: evil,
      groups: [{ clientName: evil, requestTitle: evil, requestId: "r1", items: [evil] }],
    }),
};

describe("email templates", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://portal.example");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(Object.entries(templates))("%s escapes user text and keeps the subject on one line", (_name, build) => {
    const email = build();
    expect(email.html).not.toContain("<img");
    expect(email.html).toContain(escaped);
    expect(email.html).not.toMatch(/<p><ul>|<\/ul><\/p>/);
    expect(email.subject).not.toMatch(/[\r\n]/);
  });

  it("links to the request page and formats the due date", () => {
    const email = requestSentEmail({ firmName: "Smith & Co", title: "2026 taxes", dueDate: "2027-04-15", itemCount: 2, requestId: "r1" });
    expect(email.html).toContain('href="https://portal.example/portal/requests/r1"');
    expect(email.text).toContain("due Apr 15, 2027");
  });

  it("fails clearly when the site URL is missing", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    expect(() => staffAddedEmail({ firmName: "A", adminName: "B" })).toThrow("NEXT_PUBLIC_SITE_URL is not set");
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
  const base = process.env.NEXT_PUBLIC_SITE_URL;
  if (!base) throw new Error("NEXT_PUBLIC_SITE_URL is not set");
  return new URL(path, base).toString();
}

function subjectLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

/** Wraps already-escaped HTML blocks and one link. Lists are not wrapped in <p>. */
function html(blocks: string[], link: { href: string; label: string }): string {
  const body = blocks.map((block) => (block.startsWith("<ul>") ? block : `<p>${block}</p>`)).join("");
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
        escapeHtml(input.note).replace(/\r?\n/g, "<br>"),
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
        ...input.groups.flatMap((group) => [
          `<a href="${escapeHtml(siteUrl(`/app/requests/${group.requestId}`))}">` +
            `${escapeHtml(group.clientName)}: ${escapeHtml(group.requestTitle)}</a>`,
          list(group.items),
        ]),
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
Expected: PASS, `Tests  7 passed (7)`.

- [ ] **Step 5: Write the sender's failing test**

```bash
npm install resend server-only
```

Create `lib/email/send.test.ts`. It mocks Resend and checks the settings verdict, batches of 100 with rejected addresses counted, one retry after a rate limit, and the spacing between calls from concurrent callers. Fake timers keep it fast.

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emailConfigError, sendEmails, type EmailMessage } from "@/lib/email/send";

vi.mock("server-only", () => ({}));
const { batchSend } = vi.hoisted(() => ({ batchSend: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class {
    batch = { send: batchSend };
  },
}));

const message = (to: string): EmailMessage => ({ subject: "S", html: "<p>H</p>", text: "H", to, fromName: "Ledger & Co" });
const accepted = (errors: { index: number; message: string }[] = []) => ({ data: { data: [], errors }, error: null });

beforeEach(() => {
  vi.useFakeTimers();
  batchSend.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("emailConfigError", () => {
  it("allows log mode outside production only", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("VERCEL_ENV", "");
    expect(emailConfigError()).toBeNull();
    vi.stubEnv("VERCEL_ENV", "production");
    expect(emailConfigError()).toBe("RESEND_API_KEY is not set");
  });

  it("needs a sender address with a key", () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "");
    expect(emailConfigError()).toBe("EMAIL_FROM is not set");
    vi.stubEnv("EMAIL_FROM", "Portal <notify@example.com>");
    expect(emailConfigError()).toBeNull();
  });
});

describe("sendEmails", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "Portal <notify@example.com>");
  });

  it("sends batches of 100 and counts rejected addresses", async () => {
    batchSend.mockResolvedValue(accepted([{ index: 1, message: "Invalid `to` field" }]));
    const result = sendEmails(Array.from({ length: 150 }, (_, i) => message(`c${i}@example.com`)));
    await vi.runAllTimersAsync();

    expect(await result).toEqual({ sent: 148, failed: 2 });
    expect(batchSend.mock.calls.map(([payload]) => payload.length)).toEqual([100, 50]);
    expect(batchSend.mock.calls[0][0][0].from).toBe('"Ledger & Co via Client Portal" <notify@example.com>');
    expect(batchSend.mock.calls[0][1]).toEqual({ batchValidation: "permissive" });
  });

  it("retries a rate-limited batch once", async () => {
    batchSend
      .mockResolvedValueOnce({ data: null, error: { name: "rate_limit_exceeded", statusCode: 429, message: "Too many requests" } })
      .mockResolvedValueOnce(accepted());
    const result = sendEmails([message("c@example.com")]);
    await vi.runAllTimersAsync();

    expect(await result).toEqual({ sent: 1, failed: 0 });
    expect(batchSend).toHaveBeenCalledTimes(2);
  });

  it("counts a batch Resend refuses as failed, without throwing", async () => {
    batchSend.mockResolvedValue({ data: null, error: { name: "validation_error", statusCode: 422, message: "Bad" } });
    const result = sendEmails([message("a@example.com"), message("b@example.com")]);
    await vi.runAllTimersAsync();

    expect(await result).toEqual({ sent: 0, failed: 2 });
    expect(batchSend).toHaveBeenCalledTimes(1);
  });

  it("spaces calls 600 ms apart, even across concurrent callers", async () => {
    const started: number[] = [];
    batchSend.mockImplementation(async () => {
      started.push(Date.now());
      return accepted();
    });
    const results = Promise.all([sendEmails([message("a@example.com")]), sendEmails([message("b@example.com")])]);
    await vi.runAllTimersAsync();
    await results;

    expect(started).toHaveLength(2);
    expect(started[1] - started[0]).toBeGreaterThanOrEqual(600);
  });
});
```

- [ ] **Step 6: Run it to make sure it fails**

Run: `npm test -- lib/email/send.test.ts`
Expected: FAIL, because `@/lib/email/send` cannot be resolved.

- [ ] **Step 7: Write the sender**

Create `lib/email/send.ts`. Without `RESEND_API_KEY` it logs each message instead of sending (development and tests), except in a Vercel production deployment, where a missing key is reported as a failure. `emailConfigError()` gives that verdict up front, so the daily job (Phase 7) can stop before it claims anything. With a key it sends batches of at most 100 through `resend.batch.send` in permissive mode, so one rejected address never drops the rest of the batch. Calls are spaced 600 ms apart across the whole process, so concurrent callers also stay under Resend's default rate limit, and a batch refused for the rate limit is retried once, a second later. `EMAIL_FROM` may be a bare address or `Name <address>`. It never throws.

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

export const EMAIL_BATCH_SIZE = 100; // Resend's per-call maximum
const PAUSE_MS = 600; // stay under Resend's default 2 requests per second

let nextCallAt = 0;

/** Waits for this process's next Resend slot, so concurrent callers stay under the rate limit too. */
async function waitForSlot() {
  const now = Date.now();
  const at = Math.max(now, nextCallAt);
  nextCallAt = at + PAUSE_MS;
  if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now));
}

/** The sender address from EMAIL_FROM, given as "addr" or "Name <addr>". */
function senderAddress(): string | null {
  const value = process.env.EMAIL_FROM?.trim();
  if (!value) return null;
  return value.match(/<([^<>\s]+@[^<>\s]+)>/)?.[1] ?? value;
}

function fromHeader(fromName: string, address: string): string {
  const name = `${fromName} via ${APP_NAME}`.replace(/["<>\r\n]/g, "");
  return `"${name}" <${address}>`;
}

/**
 * Why emails cannot be sent, or null. Without RESEND_API_KEY emails are logged
 * instead (development, tests), except in a Vercel production deployment.
 */
export function emailConfigError(): string | null {
  if (!process.env.RESEND_API_KEY) {
    return process.env.VERCEL_ENV === "production" ? "RESEND_API_KEY is not set" : null;
  }
  return senderAddress() ? null : "EMAIL_FROM is not set";
}

/** Sends emails in batches. Failures are logged and counted, never thrown. */
export async function sendEmails(messages: EmailMessage[]): Promise<{ sent: number; failed: number }> {
  if (messages.length === 0) return { sent: 0, failed: 0 };

  const configError = emailConfigError();
  if (configError) {
    console.error(`[email] ${configError}; ${messages.length} emails not sent`);
    return { sent: 0, failed: messages.length };
  }

  const apiKey = process.env.RESEND_API_KEY;
  const address = senderAddress();
  if (!apiKey || !address) {
    for (const m of messages) {
      console.log(`[email] to=${m.to} subject=${JSON.stringify(m.subject)}\n${m.text}`);
    }
    return { sent: messages.length, failed: 0 };
  }

  const resend = new Resend(apiKey);
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < messages.length; i += EMAIL_BATCH_SIZE) {
    await waitForSlot();
    const batch = messages.slice(i, i + EMAIL_BATCH_SIZE);
    const payload = batch.map((m) => ({
      from: fromHeader(m.fromName, address),
      to: m.to,
      subject: m.subject,
      html: m.html,
      text: m.text,
      replyTo: m.replyTo,
    }));
    // Permissive: Resend sends the valid messages even if one is rejected.
    const sendBatch = () => resend.batch.send(payload, { batchValidation: "permissive" });
    try {
      let result = await sendBatch();
      if (result.error?.name === "rate_limit_exceeded") {
        // Another instance can share the limit, which Resend counts per second.
        await new Promise((resolve) => setTimeout(resolve, 1000));
        result = await sendBatch();
      }
      const { data, error } = result;
      if (error) throw error;
      for (const rejected of data.errors) {
        console.error("[email] rejected", batch[rejected.index]?.to, rejected.message);
      }
      failed += data.errors.length;
      sent += batch.length - data.errors.length;
    } catch (error) {
      failed += batch.length;
      console.error("[email] batch failed", error);
    }
  }
  return { sent, failed };
}
```

- [ ] **Step 8: Run the tests to make sure they pass**

Run: `npm test -- lib/email`
Expected: PASS, `Tests  13 passed (13)`.

- [ ] **Step 9: Verify the whole phase**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: `Test Files  5 passed (5)`, `Tests  53 passed (53)`; typecheck, lint, and build succeed.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json lib/email
git commit -m "feat: add email templates and Resend sender with log mode"
```
