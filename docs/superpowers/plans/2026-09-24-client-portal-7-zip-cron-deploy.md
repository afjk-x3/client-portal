# Client Portal Phase 7: Zip Downloads, Daily Jobs, and Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff download a whole request as one zip; a daily cron sends client reminders and staff digests at most once per day; the README documents setup and deployment.

**Architecture:** The zip route streams files with `client-zip`: it signs every object once under RLS and fetches them one after another inside an async generator, so the archive is never held in memory. The cron route checks a bearer secret and hands the service-role client to `lib/daily-jobs.ts`, which processes each firm in its own try/catch, claims each email in `notifications_sent` before queueing it, and sends the queue in batches.

**Tech Stack:** `client-zip` 2, Vercel Cron, Resend batch API, service-role Supabase client.

**Spec:** sections 10.8, 11, 16, 18
**Depends on:** Phase 6
**Index:** [2026-09-24-client-portal.md](2026-09-24-client-portal.md)

---

## Files

| File | Responsibility |
|---|---|
| `app/api/requests/[id]/zip/route.ts` | Streams a request's files as a zip (staff of the firm only) |
| `lib/daily-jobs.ts` | Reminders and staff digests for every firm |
| `app/api/cron/daily/route.ts` | Bearer-secret check, runs the jobs, logs a JSON summary |
| `vercel.json` | Cron schedule |
| `README.md` | Setup, tests, environment, deployment |

---

## Task 1: Zip download

**Files:**
- Create: `app/api/requests/[id]/zip/route.ts`

- [ ] **Step 1: Install client-zip**

```bash
npm install client-zip
```

- [ ] **Step 2: Add the route**

Create `app/api/requests/[id]/zip/route.ts`. Access is checked twice over: `getStaff()` plus `.eq("firm_id", staff.firmId)` restricts it to members of the request's firm (contacts can read the request, so RLS alone is not enough here), and the signed URLs are created with the user-scoped client. Entry names come from `zipEntryNames()` (Phase 1): `{NN} {item title}/{filename}`, with suffixes for duplicates.

```ts
import { NextResponse } from "next/server";
import { downloadZip } from "client-zip";
import { getStaff } from "@/lib/auth";
import { zipEntryNames } from "@/lib/files";
import { createClient } from "@/lib/supabase/server";

// ponytail: zip size is limited by the 300-second function duration.
// Upgrade path: download files individually, or build zips in a background job.
export const maxDuration = 300;

/** Streams every file of a request as one zip. Staff of the request's firm only. */
export async function GET(_request: Request, ctx: RouteContext<"/api/requests/[id]/zip">) {
  const { id } = await ctx.params;
  const staff = await getStaff();
  if (!staff) return new NextResponse("Not found", { status: 404 });

  const supabase = await createClient();
  const { data: request } = await supabase
    .from("requests")
    .select("title, request_items(position, title, item_files(storage_path, filename, created_at))")
    .eq("id", id)
    .eq("firm_id", staff.firmId)
    .order("position", { referencedTable: "request_items" })
    .order("id", { referencedTable: "request_items" })
    .order("created_at", { referencedTable: "request_items.item_files" })
    .maybeSingle();
  if (!request) return new NextResponse("Not found", { status: 404 });

  const files = request.request_items.flatMap((item, index) =>
    item.item_files.map((file) => ({ ...file, itemNumber: index + 1, itemTitle: item.title })),
  );
  const names = zipEntryNames(files);

  let signedUrls: string[] = [];
  if (files.length > 0) {
    const { data, error } = await supabase.storage.from("documents").createSignedUrls(
      files.map((file) => file.storage_path),
      maxDuration,
    );
    if (error) throw error;
    signedUrls = data.map((entry) => entry.signedUrl ?? "");
  }

  async function* entries() {
    for (const [index, file] of files.entries()) {
      const response = await fetch(signedUrls[index]);
      if (!response.ok || !response.body) throw new Error(`Could not fetch ${file.storage_path}`);
      yield { name: names[index], input: response, lastModified: new Date(file.created_at) };
    }
  }

  const zipName = `${request.title.replace(/[^A-Za-z0-9 ._-]/g, "_").trim() || "request"}.zip`;
  return new Response(downloadZip(entries()).body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipName}"`,
    },
  });
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

Then by hand, with `npm run dev` running: sign in as the staff user created by the last end-to-end run (its address, `staff-<timestamp>@example.com`, is in Mailpit at http://127.0.0.1:54324), open its request (it has one file), and click "Download all (.zip)".

Run: `unzip -l ~/Downloads/2026\ tax\ documents.zip` (adjust the path to where the browser saved it)
Expected: one entry, `01 Photo ID/passport.pdf`.

As that request's contact, open `/api/requests/<request id>/zip`. Expected: 404.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json "app/api/requests/[id]/zip/route.ts"
git commit -m "feat: stream a request's files as one zip"
```

---

## Task 2: Daily reminders and staff digest

**Files:**
- Create: `lib/daily-jobs.ts`, `app/api/cron/daily/route.ts`, `vercel.json`

- [ ] **Step 1: Add the job logic**

Create `lib/daily-jobs.ts`. It follows spec section 11.2:
- Reminder candidates are `open` requests whose client is not archived and that have at least one `requested` or `needs_changes` item. `reminderDue()` (Phase 1) decides the day.
- Each email is claimed first with an `upsert(…, { ignoreDuplicates: true })` on `unique (kind, target_id, sent_on)`, which is `insert … on conflict do nothing returning id`. No returned row means the claim was already made today.
- A digest window starts at the member's previous claim, or 24 hours ago if there is none, so a missed day is covered by the next run. Members with nothing in the window are skipped without a claim.
- Reminder reply-to is the request's creator while they are still a member; digests have none.

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { isOverdue, todayUtc } from "@/lib/dates";
import { sendEmails, type EmailMessage } from "@/lib/email/send";
import { reminderEmail, staffDigestEmail, type DigestGroup } from "@/lib/email/templates";
import { reminderDue } from "@/lib/reminders";

type Admin = SupabaseClient<Database>;
type Firm = { id: string; name: string };

export type DailySummary = {
  firms: number;
  failedFirms: number;
  reminders: number;
  digests: number;
  sent: number;
  failed: number;
};

/**
 * Claims (kind, target, today) in notifications_sent. Returns false when the
 * claim already exists, so each email goes out at most once per day.
 * ponytail: a failed send after a claim is not retried. Upgrade path: an outbox with retries.
 */
async function claim(admin: Admin, kind: "reminder" | "staff_digest", targetId: string, today: string) {
  const { data, error } = await admin
    .from("notifications_sent")
    .upsert({ kind, target_id: targetId, sent_on: today }, { onConflict: "kind,target_id,sent_on", ignoreDuplicates: true })
    .select("id");
  if (error) throw error;
  return data.length > 0;
}

async function queueReminders(admin: Admin, firm: Firm, today: string, out: EmailMessage[]) {
  const [{ data: requests, error }, { data: contacts }, { data: members }] = await Promise.all([
    admin
      .from("requests")
      .select("id, title, due_date, sent_at, created_by, client_id, clients!inner(archived_at), request_items!inner(title, position)")
      .eq("firm_id", firm.id)
      .eq("status", "open")
      .is("clients.archived_at", null)
      .in("request_items.status", ["requested", "needs_changes"])
      .order("position", { referencedTable: "request_items" }),
    admin.from("client_contacts").select("client_id, email").eq("firm_id", firm.id),
    admin.from("firm_members").select("user_id, email").eq("firm_id", firm.id),
  ]);
  if (error) throw error;

  let count = 0;
  for (const request of requests) {
    const sentOn = request.sent_at ? todayUtc(new Date(request.sent_at)) : today;
    if (!reminderDue({ dueDate: request.due_date, sentOn, today })) continue;
    if (!(await claim(admin, "reminder", request.id, today))) continue;

    const content = reminderEmail({
      firmName: firm.name,
      title: request.title,
      dueDate: request.due_date,
      overdue: isOverdue(request.due_date, today),
      openItems: request.request_items.map((item) => item.title),
      requestId: request.id,
    });
    const replyTo = members?.find((m) => m.user_id === request.created_by)?.email;
    for (const contact of contacts ?? []) {
      if (contact.client_id === request.client_id) {
        out.push({ ...content, to: contact.email, fromName: firm.name, replyTo });
      }
    }
    count++;
  }
  return count;
}

async function queueDigests(admin: Admin, firm: Firm, today: string, now: Date, out: EmailMessage[]) {
  const { data: members, error } = await admin.from("firm_members").select("user_id, email").eq("firm_id", firm.id);
  if (error) throw error;

  let count = 0;
  for (const member of members) {
    // The window starts at the previous digest claim, so a missed day is covered.
    const { data: last } = await admin
      .from("notifications_sent")
      .select("created_at")
      .eq("kind", "staff_digest")
      .eq("target_id", member.user_id)
      .lt("sent_on", today)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const since = last?.created_at ?? new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const { data: items, error: itemsError } = await admin
      .from("request_items")
      .select("title, request_id, requests!inner(title, clients!inner(name))")
      .eq("firm_id", firm.id)
      .gt("submitted_at", since)
      .lte("submitted_at", now.toISOString())
      .order("submitted_at");
    if (itemsError) throw itemsError;
    if (items.length === 0) continue;
    if (!(await claim(admin, "staff_digest", member.user_id, today))) continue;

    const groups = new Map<string, DigestGroup>();
    for (const item of items) {
      const group = groups.get(item.request_id) ?? {
        clientName: item.requests.clients.name,
        requestTitle: item.requests.title,
        requestId: item.request_id,
        items: [],
      };
      group.items.push(item.title);
      groups.set(item.request_id, group);
    }
    const content = staffDigestEmail({ firmName: firm.name, groups: [...groups.values()] });
    out.push({ ...content, to: member.email, fromName: firm.name });
    count++;
  }
  return count;
}

/** Reminders and staff digests for every firm. Each firm is isolated in its own try/catch. */
export async function runDailyJobs(admin: Admin, now: Date = new Date()): Promise<DailySummary> {
  const today = todayUtc(now);
  const summary: DailySummary = { firms: 0, failedFirms: 0, reminders: 0, digests: 0, sent: 0, failed: 0 };
  const { data: firms, error } = await admin.from("firms").select("id, name");
  if (error) throw error;

  const emails: EmailMessage[] = [];
  for (const firm of firms) {
    try {
      summary.reminders += await queueReminders(admin, firm, today, emails);
      summary.digests += await queueDigests(admin, firm, today, now, emails);
      summary.firms++;
    } catch (err) {
      summary.failedFirms++;
      console.error(`Daily jobs failed for firm ${firm.id}`, err);
    }
  }

  const result = await sendEmails(emails);
  summary.sent = result.sent;
  summary.failed = result.failed;
  return summary;
}
```

- [ ] **Step 2: Add the route**

Create `app/api/cron/daily/route.ts`. It refuses every request when `CRON_SECRET` is unset, so a missing variable can never turn into `Bearer undefined` being accepted.

```ts
import { NextResponse, type NextRequest } from "next/server";
import { runDailyJobs } from "@/lib/daily-jobs";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

/** Vercel Cron calls this once a day with Authorization: Bearer ${CRON_SECRET}. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const summary = await runDailyJobs(createAdminClient());
  console.log(JSON.stringify({ job: "daily", ...summary }));
  return NextResponse.json(summary);
}
```

- [ ] **Step 3: Add the schedule**

Create `vercel.json`:

```json
{
  "crons": [{ "path": "/api/cron/daily", "schedule": "0 13 * * *" }]
}
```

- [ ] **Step 4: Verify the route**

Run the end-to-end test first so there is a fresh submitted item: `npm run test:e2e`. Then start `npm run dev` in another terminal and run:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/cron/daily
```

Expected: `401`.

```bash
curl -s -H "Authorization: Bearer local-cron-secret" http://localhost:3000/api/cron/daily
```

Expected: JSON such as `{"firms":1,"failedFirms":0,"reminders":0,"digests":1,"sent":1,"failed":0}`. `digests` is at least 1 (the end-to-end test's submission) and `failedFirms` and `failed` are 0. The dev server prints the digest, `subject="1 item submitted at Ledger & Co"`, and one line such as `{"job":"daily",…}`.

- [ ] **Step 5: Verify a reminder**

Reopen the newest request's items and make it due in exactly 7 days, sent 2 days ago (`db query` runs one statement per call):

```bash
npx supabase db query --local "update public.request_items set status = 'requested' where request_id = (select id from public.requests order by created_at desc limit 1)"
npx supabase db query --local "update public.requests set due_date = current_date + 7, sent_at = now() - interval '2 days' where id = (select id from public.requests order by created_at desc limit 1)"
curl -s -H "Authorization: Bearer local-cron-secret" http://localhost:3000/api/cron/daily
```

Expected: `"reminders":1` and `"digests":0`. The dev server prints `subject="Reminder: 2026 tax documents is due …"` listing "Photo ID".

Run the same `curl` again.
Expected: `"reminders":0,"digests":0,"sent":0`. Today's claims hold, so nothing is sent twice.

- [ ] **Step 6: Commit**

```bash
git add lib/daily-jobs.ts app/api/cron/daily/route.ts vercel.json
git commit -m "feat: add daily reminders and staff digest cron"
```

---

## Task 3: README and final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the README**

Replace `README.md`:

````markdown
# Client Portal

Firms send clients a checklist of documents and questions. Clients sign in with a 6-digit code sent by email, upload files or answer each item, and submit it. Staff accept each item or return it with a note. Daily reminders chase open items, and a daily digest tells staff what arrived.

Design: [`docs/superpowers/specs/2026-09-24-client-portal-design.md`](docs/superpowers/specs/2026-09-24-client-portal-design.md)

## Stack

Next.js 16 (App Router, Cache Components), Supabase (Postgres with RLS, Auth, Storage), Tailwind CSS v4 with shadcn/ui, Resend, and Vercel Cron.

## Local development

Requires Node.js 22 or later and Docker.

```bash
npm install
npx supabase start          # Postgres, Auth, Storage, and Mailpit
cp .env.example .env.local  # then paste the keys printed by `npx supabase status`
npm run dev
```

Sign-in codes arrive in Mailpit at http://127.0.0.1:54324. While `RESEND_API_KEY` is empty, app emails are printed to the terminal instead of sent.

## Tests

| Command | Runs |
|---|---|
| `npm test` | Vitest unit tests |
| `npm run test:db` | pgTAP tests for tenant isolation, RPCs, and storage (local Supabase) |
| `npm run test:e2e` | The Playwright happy path (starts `npm run dev`) |
| `npm run typecheck` | Route type generation and `tsc` |
| `npm run lint` | ESLint |

After changing a migration, run `npx supabase db reset` and then `npm run db:types`.

## Environment variables

| Name | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key (or the legacy anon key) |
| `SUPABASE_SECRET_KEY` | Secret key (or the legacy service-role key). Server only. |
| `NEXT_PUBLIC_SITE_URL` | Base URL for links in emails |
| `RESEND_API_KEY` | Resend API key. Empty in development. |
| `EMAIL_FROM` | Sender address on a domain verified in Resend |
| `CRON_SECRET` | Bearer token that Vercel Cron sends to `/api/cron/daily` |

## Deploying

1. Create a Supabase project, then link it and apply the migrations:

   ```bash
   npx supabase link --project-ref your-project-ref
   npx supabase db push
   ```

2. In the Supabase dashboard, under Authentication:
   - Set the email OTP length to 6.
   - Replace the "Magic Link" and "Confirm signup" email templates with `supabase/templates/sign-in-code.html`. It shows `{{ .Token }}` and no link.
   - Configure custom SMTP with Resend.
   - Set the Site URL to the production domain.
3. In Resend, verify the domain of `EMAIL_FROM`.
4. In Vercel, set every variable above (use a long random `CRON_SECRET`) and deploy. `vercel.json` schedules `/api/cron/daily` at 13:00 UTC. On the Hobby plan it runs once at some point within that hour.

Before charging customers, move to paid plans: Vercel Hobby is for non-commercial use only, and Supabase pauses inactive free projects.
````

- [ ] **Step 2: Check the ceilings are marked**

Run: `grep -rn "ponytail:" app lib supabase/migrations`
Expected: 8 lines covering the 7 ceilings in spec section 18 (UTC dates, one firm per staff user, orphaned objects after a failed register and after a failed delete, zip duration, at-most-once scheduled emails, optional items locking, declared MIME types without virus scanning).

- [ ] **Step 3: Run every check**

```bash
npx supabase db reset
npm run test:db
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```

Expected: pgTAP `Files=10, Tests=130, Result: PASS`; Vitest `Tests  31 passed (31)`; typecheck, lint, and build succeed; Playwright `1 passed`.

Optionally run `npx supabase db advisors --local`. It reports only `multiple_permissive_policies` warnings: the staff and contact read rules are separate policies on purpose, one per actor, to match spec section 8.2.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add setup, testing, and deployment guide"
```
