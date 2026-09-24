# Client Portal Phase 3: Auth and Staff Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person can sign up with an emailed 6-digit code, create a firm, and land on the staff dashboard. The Playwright happy-path test starts here and covers that first step.

**Architecture:** Three Supabase clients: user-scoped server and browser clients (RLS applies) and a `server-only` service-role client used only by `ensureUser()` and the cron. `proxy.ts` refreshes the session and sends signed-out users to `/login`. `lib/auth.ts` is the data access layer that pages use to find the caller's role; it decides navigation only. With Cache Components, every session read happens inside `<Suspense>`.

**Tech Stack:** `@supabase/ssr` 0.12, `@supabase/supabase-js` 2.117, Next.js `proxy.ts`, shadcn Sidebar, Tabs, and Table, TanStack Table v9, Playwright 1.63 with Mailpit.

**Spec:** sections 6, 9.1, 9.2 (layout and dashboard), 9.4, 10.1, 13
**Depends on:** Phases 1 and 2; local Supabase running (`npx supabase start`)
**Index:** [2026-09-24-client-portal.md](2026-09-24-client-portal.md)

---

## Files

| File | Responsibility |
|---|---|
| `.env.example` | Documented environment variables |
| `lib/supabase/server.ts` | User-scoped client for Server Components, Actions, and Route Handlers |
| `lib/supabase/client.ts` | User-scoped browser client |
| `lib/supabase/admin.ts` | Service-role client and `ensureUser()` |
| `lib/auth.ts` | `getUser`, `getStaff`, `getContactClientIds`, `homePath`, `requireStaff`, `requireAdmin` |
| `proxy.ts` | Session refresh and signed-out redirects |
| `app/layout.tsx`, `app/page.tsx` | Root layout with the toaster; static landing page |
| `app/login/*` | Email then code sign-in; post-sign-in destination action |
| `app/auth/sign-out/route.ts` | Sign-out with a full page load |
| `app/onboarding/*` | Firm creation through `create_firm` |
| `components/data-table.tsx` | Generic DataTable on TanStack Table v9 |
| `app/app/layout.tsx`, `staff-shell.tsx`, `app-sidebar.tsx`, `error.tsx` | Staff layout and gate |
| `app/error.tsx` | Root error boundary, which also catches errors in segment layouts |
| `app/app/page.tsx`, `dashboard-tabs.tsx` | Dashboard with "Waiting on clients" and "Ready for review" |
| `playwright.config.ts`, `e2e/mailpit.ts`, `e2e/happy-path.spec.ts` | The end-to-end test and its Mailpit helper |

---

## Task 1: Supabase clients, auth helpers, and proxy

**Files:**
- Create: `.env.example`, `.env.local` (not committed), `lib/supabase/server.ts`, `lib/supabase/client.ts`, `lib/supabase/admin.ts`, `lib/auth.ts`, `proxy.ts`

- [ ] **Step 1: Install the Supabase libraries**

```bash
npm install @supabase/ssr @supabase/supabase-js
```

- [ ] **Step 2: Document the environment**

Create `.env.example`:

```bash
# Copy to .env.local. Local keys come from `npx supabase status`.
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
# Leave empty locally: emails are logged instead of sent.
RESEND_API_KEY=
EMAIL_FROM=notifications@example.com
CRON_SECRET=local-cron-secret
```

Then create your local copy and fill in the two keys from `npx supabase status` (`PUBLISHABLE_KEY` and `SECRET_KEY`):

```bash
cp .env.example .env.local
npx supabase status
```

Leave `RESEND_API_KEY` empty so emails are logged, which the end-to-end test relies on.

- [ ] **Step 3: Create the server client**

Create `lib/supabase/server.ts`:

```ts
import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";

/** User-scoped client for Server Components, Server Actions, and Route Handlers. RLS applies. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server Components cannot set cookies; proxy.ts refreshes the session.
          }
        },
      },
    },
  );
}
```

- [ ] **Step 4: Create the browser client**

Create `lib/supabase/client.ts`:

```ts
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";

/** User-scoped client for Client Components. RLS applies. */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
```

- [ ] **Step 5: Create the service-role client and `ensureUser`**

Create `lib/supabase/admin.ts`. `ensureUser` follows spec section 10.1: `createUser` with `email_confirm: true` sends no email; when the email already exists (`error.code === "email_exists"`), it looks the id up through the `admin_user_id_by_email` RPC, which only the service role may execute.

```ts
import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Service-role client. It bypasses RLS, so only two callers may use it:
 * the daily cron route and ensureUser() below.
 */
export function createAdminClient() {
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Returns the auth user id for an email, creating a confirmed user when none
 * exists. Sends no email. Callers must confirm the caller's role first.
 */
export async function ensureUser(email: string): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (data.user) return data.user.id;
  if (error?.code !== "email_exists") throw error ?? new Error("createUser returned no user");

  const { data: userId, error: lookupError } = await admin.rpc("admin_user_id_by_email", { email });
  if (lookupError || !userId) throw lookupError ?? new Error("admin_user_id_by_email found no user");
  return userId;
}
```

- [ ] **Step 6: Create the auth helpers**

Create `lib/auth.ts`. `cache()` dedupes the lookups within one request. `getContactClientIds()` reads the caller's own `client_contacts` rows (the policy added in Phase 2, Task 3). A failed query throws: read as "no membership", a database hiccup would send staff to onboarding instead of the error page (spec section 12).

```ts
import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Staff = {
  userId: string;
  email: string;
  firmId: string;
  role: "admin" | "staff";
  fullName: string;
};

/** The signed-in user, or null. Verifies the JWT. */
export const getUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data) return null;
  return { id: data.claims.sub, email: data.claims.email ?? "" };
});

/** The caller's staff membership, or null. A failed query throws, so it never reads as "not staff". */
export const getStaff = cache(async (): Promise<Staff | null> => {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("firm_members")
    .select("firm_id, role, full_name, email")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    userId: user.id,
    email: data.email,
    firmId: data.firm_id,
    role: data.role as Staff["role"],
    fullName: data.full_name,
  };
});

/** Ids of the clients the caller is a contact of. */
export const getContactClientIds = cache(async (): Promise<string[]> => {
  const user = await getUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.from("client_contacts").select("client_id").eq("user_id", user.id);
  if (error) throw error;
  return data.map((row) => row.client_id);
});

/** Where a signed-in user goes when no `next` path is given. */
export async function homePath(): Promise<string> {
  if (await getStaff()) return "/app";
  if ((await getContactClientIds()).length > 0) return "/portal";
  return "/onboarding";
}

/**
 * The caller's membership. Redirects everyone else to where they belong.
 * This decides navigation only; RLS is the security boundary.
 */
export async function requireStaff(): Promise<Staff> {
  const staff = await getStaff();
  if (staff) return staff;
  redirect((await getUser()) ? await homePath() : "/login");
}

export async function requireAdmin(): Promise<Staff> {
  const staff = await requireStaff();
  if (staff.role !== "admin") redirect("/app");
  return staff;
}
```

- [ ] **Step 7: Create the proxy**

Create `proxy.ts` in the repo root. It must call `getClaims()` right after creating the client, and it never redirects `/api/*`: API handlers check the session themselves, and the cron route uses a bearer secret. It redirects only page loads (`GET` and `HEAD`): a Server Action cannot follow a redirect to a page, so actions check the session themselves, and `requireStaff()` redirects.

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const SIGNED_IN_ONLY = ["/app", "/portal", "/onboarding"];

/** Refreshes the Supabase session and sends signed-out page loads to /login. Never redirects /api/*. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // Do not run code between createServerClient and getClaims().
  const { data } = await supabase.auth.getClaims();

  const { pathname, search } = request.nextUrl;
  const needsSession = SIGNED_IN_ONLY.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  // Only page loads. A Server Action (POST) cannot follow a redirect to a page;
  // it checks the session itself and redirects through requireStaff().
  const pageLoad = request.method === "GET" || request.method === "HEAD";
  if (!data && needsSession && pageLoad) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
```

- [ ] **Step 8: Verify**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json .env.example lib/supabase lib/auth.ts proxy.ts
git commit -m "feat: add Supabase clients, auth helpers, and session proxy"
```

---

## Task 2: Playwright and the first end-to-end step

**Files:**
- Create: `playwright.config.ts`, `e2e/mailpit.ts`, `e2e/happy-path.spec.ts`

This is the single end-to-end test from spec section 14. It grows phase by phase until it covers all seven steps.

- [ ] **Step 1: Install Playwright**

```bash
npm install -D @playwright/test
npx playwright install chromium
```

In `package.json`, add to `"scripts"`:

```json
"test:e2e": "playwright test"
```

- [ ] **Step 2: Add the config**

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

// Runs against local Supabase (`npx supabase start`) with RESEND_API_KEY unset,
// so app emails are logged and auth codes land in Mailpit.
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

- [ ] **Step 3: Add the Mailpit helper**

Create `e2e/mailpit.ts`. It reads the newest sign-in email for an address from the local Mailpit API.

```ts
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

/** Waits for the newest email to `to` and returns its 6-digit sign-in code. */
export async function readSignInCode(to: string): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const search = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    if (messages.length > 0) {
      const message = await fetch(`${MAILPIT_URL}/api/v1/message/${messages[0].ID}`);
      const { Text } = (await message.json()) as { Text: string };
      const code = Text.match(/\b(\d{6})\b/)?.[1];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`No sign-in code for ${to}`);
}
```

- [ ] **Step 4: Write the failing test**

Create `e2e/happy-path.spec.ts`. Use role-based locators: with Cache Components, pages you navigated away from stay in the DOM but hidden, and role locators skip hidden elements while label locators do not.

```ts
import { expect, test, type Page } from "@playwright/test";
import { readSignInCode } from "./mailpit";

const run = Date.now();
const staffEmail = `staff-${run}@example.com`;

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
});
```

- [ ] **Step 5: Run it to make sure it fails**

Run: `npm run test:e2e`
Expected: FAIL, waiting for `getByRole('textbox', { name: 'Email' })`, because `/login` does not exist yet.

---

## Task 3: Root layout, landing, sign-in, sign-out, and onboarding

**Files:**
- Modify: `app/layout.tsx`, `app/page.tsx`
- Delete: `public/file.svg`, `public/globe.svg`, `public/next.svg`, `public/vercel.svg`, `public/window.svg`
- Create: `app/login/actions.ts`, `app/login/login-form.tsx`, `app/login/page.tsx`, `app/auth/sign-out/route.ts`, `app/onboarding/actions.ts`, `app/onboarding/onboarding-form.tsx`, `app/onboarding/page.tsx`

- [ ] **Step 1: Update the root layout**

Replace `app/layout.tsx`. The only changes from the scaffold are the metadata and the Sonner `<Toaster />`; if `shadcn init` changed the font setup in this file, keep its font lines and apply just those two changes.

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { APP_NAME } from "@/lib/constants";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Collect documents and answers from your clients without the email back-and-forth.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster richColors />
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Replace the landing page and remove the scaffold images**

Replace `app/page.tsx`. It reads no session, so it stays fully static.

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/constants";

export default function LandingPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 p-6">
      <p className="text-sm font-medium text-muted-foreground">{APP_NAME}</p>
      <h1 className="text-4xl font-semibold tracking-tight">Stop chasing client documents by email.</h1>
      <p className="text-lg text-muted-foreground">
        Send each client a checklist. They upload files and answer questions from any phone, with no password.
        You review each item, and reminders go out on their own.
      </p>
      <div>
        <Button asChild size="lg">
          <Link href="/login">Get started</Link>
        </Button>
      </div>
    </main>
  );
}
```

```bash
git rm public/file.svg public/globe.svg public/next.svg public/vercel.svg public/window.svg
```

- [ ] **Step 3: Add the post-sign-in destination action**

Create `app/login/actions.ts`. The order follows spec section 9.1: a safe `next` path, else `/app` for staff, `/portal` for contacts, `/onboarding` for everyone else.

```ts
"use server";

import { homePath } from "@/lib/auth";
import { safeNextPath } from "@/lib/safe-next-path";

/** Where to go after a successful sign-in. */
export async function signInDestination(next: string | null): Promise<string> {
  return safeNextPath(next) ?? (await homePath());
}
```

- [ ] **Step 4: Add the sign-in form**

Create `app/login/login-form.tsx`. The code request and check run in the browser client, so Supabase's per-IP rate limits apply to the person signing in rather than to the server. `verifyOtp` with `type: "email"` accepts codes from both the magic-link and confirm-signup emails.

```tsx
"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { signInDestination } from "./actions";

export function LoginForm({ next }: { next: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function sendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = String(new FormData(event.currentTarget).get("email") ?? "").trim().toLowerCase();
    startTransition(async () => {
      const { error } = await createClient().auth.signInWithOtp({
        email: address,
        options: { shouldCreateUser: true },
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      setEmail(address);
      toast.success("Check your email for a 6-digit code.");
    });
  }

  function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email) return;
    const token = String(new FormData(event.currentTarget).get("code") ?? "").replace(/\s/g, "");
    startTransition(async () => {
      const { error } = await createClient().auth.verifyOtp({ email, token, type: "email" });
      if (error) {
        toast.error("That code is wrong or has expired. Try again or request a new code.");
        return;
      }
      router.replace(await signInDestination(next));
    });
  }

  if (!email) {
    return (
      <form onSubmit={sendCode} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send code"}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={verifyCode} className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        We sent a 6-digit code to <strong>{email}</strong>.
      </p>
      <div className="flex flex-col gap-2">
        <Label htmlFor="code">Code</Label>
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          autoFocus
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Checking…" : "Sign in"}
      </Button>
      <Button type="button" variant="ghost" onClick={() => setEmail(null)} disabled={pending}>
        Use a different email
      </Button>
    </form>
  );
}
```

- [ ] **Step 5: Add the sign-in page**

Create `app/login/page.tsx`. `searchParams` is request data, so it is read inside `<Suspense>`.

```tsx
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { APP_NAME } from "@/lib/constants";
import { LoginForm } from "./login-form";

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Sign in to {APP_NAME}</h1>
        <p className="text-sm text-muted-foreground">No password needed. We&apos;ll email you a code.</p>
      </div>
      <Suspense fallback={<Skeleton className="h-28" />}>
        <LoginFormWithNext searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function LoginFormWithNext({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { next } = await searchParams;
  return <LoginForm next={typeof next === "string" ? next : null} />;
}
```

- [ ] **Step 6: Add sign-out**

Create `app/auth/sign-out/route.ts`. Forms post here natively, so the browser does a full page load and no page kept mounted by Cache Components survives into the next user's session. It signs out this device only (`scope: "local"`), clears the session cookies itself when Auth cannot be reached, and redirects with a relative URL, so it works on any host.

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Signs this device out, then does a full page load of /login. A full load
 * (not a client navigation) drops every page React kept mounted for the
 * previous user. The redirect is relative, so it works on any host.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  const response = new NextResponse(null, { status: 303, headers: { Location: "/login" } });
  if (error) {
    // Auth could not be reached, so the client kept its session cookies. Clear them here.
    console.error("Sign-out failed", error);
    for (const { name } of request.cookies.getAll()) {
      if (name.startsWith("sb-")) response.cookies.delete(name);
    }
  }
  return response;
}
```

- [ ] **Step 7: Add onboarding**

Create `app/onboarding/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { fail, invalid, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { onboardingSchema } from "@/lib/validation";

export async function createFirm(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = onboardingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_firm", {
    name: parsed.data.firmName,
    full_name: parsed.data.fullName,
  });
  if (error) return fail(error, { P0001: "You already belong to a firm." });

  redirect("/app");
}
```

Create `app/onboarding/onboarding-form.tsx`. Forms call their Server Action through `useActionState` and report the result with a Sonner toast.

```tsx
"use client";

import { useActionState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LIMITS } from "@/lib/constants";
import type { ActionResult } from "@/lib/errors";
import { createFirm } from "./actions";

export function OnboardingForm() {
  const [, formAction, pending] = useActionState(async (prev: ActionResult | null, formData: FormData) => {
    const result = await createFirm(prev, formData);
    if (!result.ok) toast.error(result.error);
    return result;
  }, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="firmName">Firm name</Label>
        <Input id="firmName" name="firmName" maxLength={LIMITS.firmName} required autoFocus />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="fullName">Your full name</Label>
        <Input id="fullName" name="fullName" maxLength={LIMITS.name} autoComplete="name" required />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create firm"}
      </Button>
    </form>
  );
}
```

Create `app/onboarding/page.tsx`. A user who is already staff goes straight to `/app`.

```tsx
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { getStaff } from "@/lib/auth";
import { OnboardingForm } from "./onboarding-form";

export default function OnboardingPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Set up your firm</h1>
        <p className="text-sm text-muted-foreground">We&apos;ll add a starter checklist you can edit.</p>
      </div>
      <Suspense fallback={<Skeleton className="h-40" />}>
        <Onboarding />
      </Suspense>
    </main>
  );
}

async function Onboarding() {
  if (await getStaff()) redirect("/app");
  return <OnboardingForm />;
}
```

- [ ] **Step 8: Run the test**

Run: `npm run test:e2e`
Expected: still FAIL, but later: sign-in and firm creation work, and the test now waits for the `Dashboard` heading because `/app` does not exist yet.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add landing page, code sign-in, sign-out, and onboarding"
```

---

## Task 4: Staff shell and dashboard

**Files:**
- Create: `components/data-table.tsx`, `app/app/layout.tsx`, `app/app/staff-shell.tsx`, `app/app/app-sidebar.tsx`, `app/app/error.tsx`, `app/error.tsx`, `app/app/page.tsx`, `app/app/dashboard-tabs.tsx`

- [ ] **Step 1: Add the DataTable**

Create `components/data-table.tsx`. Callers sort in SQL and filter the array they pass in, so the table registers no optional features.

```tsx
"use client";

import { tableFeatures, useTable, type ColumnDef, type RowData } from "@tanstack/react-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const features = tableFeatures({});

export type DataTableColumn<TData extends RowData> = ColumnDef<typeof features, TData>;

/** Renders rows in the order given; callers sort and filter the data. */
export function DataTable<TData extends RowData>({
  columns,
  data,
  emptyMessage,
}: {
  columns: DataTableColumn<TData>[];
  data: TData[];
  emptyMessage: string;
}) {
  const table = useTable({ features, columns, data });
  const rows = table.getRowModel().rows;

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length > 0 ? (
            rows.map((row) => (
              <TableRow key={row.id}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 2: Add the staff layout**

Create `app/app/layout.tsx`. The whole shell sits in one `<Suspense>` boundary because it reads the session.

```tsx
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { StaffShell } from "./staff-shell";

export default function StaffLayout({ children }: LayoutProps<"/app">) {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-96" />}>
      <StaffShell>{children}</StaffShell>
    </Suspense>
  );
}
```

Create `app/app/staff-shell.tsx`. `requireStaff()` sends contacts to `/portal` and everyone else to `/onboarding` (spec section 9.2). In development, Next may log `Could not validate instant … NEXT_REDIRECT` when a contact opens `/app`; that is its instant-navigation checker noticing this redirect, not a failure.

```tsx
import type { ReactNode } from "react";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppSidebar } from "./app-sidebar";

/** Sends non-staff away, then renders the sidebar layout. */
export async function StaffShell({ children }: { children: ReactNode }) {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data: firm } = await supabase.from("firms").select("name").eq("id", staff.firmId).single();

  return (
    <SidebarProvider>
      <AppSidebar firmName={firm?.name ?? ""} userName={staff.fullName} />
      <SidebarInset>
        <header className="flex h-12 items-center border-b px-4">
          <SidebarTrigger />
        </header>
        <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
```

Create `app/app/app-sidebar.tsx`. On phones the sidebar is a Sheet, so each link also closes it; otherwise it would stay open over the page you navigated to. The current page's link has `aria-current="page"`.

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, LayoutDashboard, LogOut, Settings, Users } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const NAV = [
  { href: "/app", label: "Dashboard", icon: LayoutDashboard },
  { href: "/app/clients", label: "Clients", icon: Users },
  { href: "/app/templates", label: "Templates", icon: FileText },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

export function AppSidebar({ firmName, userName }: { firmName: string; userName: string }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();

  return (
    <Sidebar>
      <SidebarHeader>
        <p className="truncate px-2 py-1 font-semibold">{firmName}</p>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map(({ href, label, icon: Icon }) => {
                const active = href === "/app" ? pathname === href : pathname.startsWith(href);
                return (
                  <SidebarMenuItem key={href}>
                    <SidebarMenuButton asChild isActive={active}>
                      <Link
                        href={href}
                        aria-current={active ? "page" : undefined}
                        onClick={() => setOpenMobile(false)}
                      >
                        <Icon />
                        <span>{label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <p className="truncate px-2 text-sm text-muted-foreground">{userName}</p>
        <form action="/auth/sign-out" method="post">
          <SidebarMenuButton type="submit">
            <LogOut />
            <span>Sign out</span>
          </SidebarMenuButton>
        </form>
      </SidebarFooter>
    </Sidebar>
  );
}
```

Create `app/app/error.tsx`. In Next.js 16.3 error boundaries receive `retry`, not `reset`.

```tsx
"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function StaffError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-start gap-4">
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="text-sm text-muted-foreground">Try again. If it keeps happening, contact support.</p>
      <Button onClick={() => retry()}>Try again</Button>
    </div>
  );
}
```

Create `app/error.tsx`. An error boundary does not catch errors thrown by its own segment's layout, so an error in the staff shell (rendered by `app/app/layout.tsx`) reaches this root boundary instead of `app/app/error.tsx`.

```tsx
"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Catches what no nested boundary does, including errors thrown by a
 * segment's own layout, such as the staff shell in app/app/layout.tsx.
 */
export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col items-start gap-4 p-6">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">Try again. If it keeps happening, contact support.</p>
      <Button onClick={() => retry()}>Try again</Button>
    </main>
  );
}
```

- [ ] **Step 3: Add the dashboard**

Create `app/app/page.tsx`. Staff queries always add `.eq("firm_id", staff.firmId)`: a user who is also a contact at another firm can see that firm's requests through the contact policy, and they do not belong on this dashboard. The `!inner` embed with `.in("request_items.status", …)` returns only open items and drops requests that have none. "Ready for review" leaves out archived requests the same way.

```tsx
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/auth";
import { isOverdue, todayUtc } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { DashboardTabs } from "./dashboard-tabs";

export default function DashboardPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Dashboard />
      </Suspense>
    </>
  );
}

async function Dashboard() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const [waiting, ready] = await Promise.all([
    // Open requests with at least one open item; the inner join drops the rest.
    supabase
      .from("requests")
      .select("id, title, due_date, clients(name), request_items!inner(id)")
      .eq("firm_id", staff.firmId)
      .eq("status", "open")
      .in("request_items.status", ["requested", "needs_changes"])
      .order("due_date"),
    // Submitted items of open and completed requests; archived requests are closed.
    supabase
      .from("request_items")
      .select("id, title, submitted_at, request_id, requests!inner(title, clients(name))")
      .eq("firm_id", staff.firmId)
      .eq("status", "submitted")
      .neq("requests.status", "archived")
      .order("submitted_at"),
  ]);
  if (waiting.error) throw waiting.error;
  if (ready.error) throw ready.error;

  const today = todayUtc();
  return (
    <DashboardTabs
      waiting={waiting.data.map((request) => ({
        requestId: request.id,
        client: request.clients?.name ?? "",
        title: request.title,
        dueDate: request.due_date,
        openItems: request.request_items.length,
        overdue: isOverdue(request.due_date, today),
      }))}
      ready={ready.data.map((item) => ({
        requestId: item.request_id,
        client: item.requests.clients?.name ?? "",
        request: item.requests.title,
        item: item.title,
        submittedAt: item.submitted_at ?? "",
      }))}
    />
  );
}
```

Create `app/app/dashboard-tabs.tsx`:

```tsx
"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { formatDate, formatDateTime } from "@/lib/dates";

type WaitingRow = {
  requestId: string;
  client: string;
  title: string;
  dueDate: string;
  openItems: number;
  overdue: boolean;
};

type ReadyRow = {
  requestId: string;
  client: string;
  request: string;
  item: string;
  submittedAt: string;
};

const waitingColumns: DataTableColumn<WaitingRow>[] = [
  { accessorKey: "client", header: "Client" },
  {
    id: "title",
    header: "Request",
    cell: ({ row }) => (
      <Link className="font-medium underline-offset-4 hover:underline" href={`/app/requests/${row.original.requestId}`}>
        {row.original.title}
      </Link>
    ),
  },
  {
    id: "due",
    header: "Due",
    cell: ({ row }) => (
      <span className="flex items-center gap-2">
        {formatDate(row.original.dueDate)}
        {row.original.overdue && <Badge variant="destructive">Overdue</Badge>}
      </span>
    ),
  },
  { accessorKey: "openItems", header: "Open items" },
];

const readyColumns: DataTableColumn<ReadyRow>[] = [
  { accessorKey: "client", header: "Client" },
  {
    id: "request",
    header: "Request",
    cell: ({ row }) => (
      <Link className="font-medium underline-offset-4 hover:underline" href={`/app/requests/${row.original.requestId}`}>
        {row.original.request}
      </Link>
    ),
  },
  { accessorKey: "item", header: "Item" },
  { id: "submitted", header: "Submitted", cell: ({ row }) => formatDateTime(row.original.submittedAt) },
];

export function DashboardTabs({ waiting, ready }: { waiting: WaitingRow[]; ready: ReadyRow[] }) {
  return (
    <Tabs defaultValue="waiting">
      <TabsList>
        <TabsTrigger value="waiting">Waiting on clients ({waiting.length})</TabsTrigger>
        <TabsTrigger value="ready">Ready for review ({ready.length})</TabsTrigger>
      </TabsList>
      <TabsContent value="waiting">
        <DataTable columns={waitingColumns} data={waiting} emptyMessage="No client is holding up a request." />
      </TabsContent>
      <TabsContent value="ready">
        <DataTable columns={readyColumns} data={ready} emptyMessage="Nothing to review." />
      </TabsContent>
    </Tabs>
  );
}
```

- [ ] **Step 4: Run the test to make sure it passes**

Run: `npm run test:e2e`
Expected: PASS, `1 passed`.

- [ ] **Step 5: Verify the rest**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all succeed. In the build's route table, `/app`, `/login`, and `/onboarding` show as `◐ (Partial Prerender)` and `/` as `○ (Static)`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add staff shell, sidebar, and dashboard"
```
