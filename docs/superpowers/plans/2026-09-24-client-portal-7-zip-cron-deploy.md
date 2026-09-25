# Client Portal Phase 7: Zip Downloads, Daily Jobs, and Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff download a whole request as one zip; a daily cron sends client reminders and staff digests at most once per day; the README documents setup and deployment.

**Architecture:** The zip route streams files with `client-zip`: it signs every object once under RLS and fetches them one after another inside an async generator, so the archive is never held in memory. The cron route checks a bearer secret and hands the service-role client to `lib/daily-jobs.ts`. It works through the firms five at a time, each in its own try/catch: it builds the firm's reminders and digests, claims them in `notifications_sent` in one statement, and queues only the claims it won. The queue goes out in batches of 100 while the run continues.

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
| `integration/daily-jobs.test.ts`, `vitest.integration.config.mts` | The daily job against local Supabase, with emails captured |
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

Create `app/api/requests/[id]/zip/route.ts`. Access is checked twice over: `getStaff()` plus `.eq("firm_id", staff.firmId)` restricts it to members of the request's firm (contacts can read the request, so RLS alone is not enough here), and the signed URLs are created with the user-scoped client. Entry names come from `zipEntryNames()` (Phase 1): `{NN} {item title}/{filename}`, with suffixes for duplicates. A file that cannot be signed fails the request before streaming starts, instead of cutting the zip short, and the response is never cached.

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
    // Checked before streaming starts, so a missing object fails the request instead of cutting the zip short.
    signedUrls = data.map((entry) => {
      if (!entry.signedUrl) throw new Error(`Could not sign ${entry.path}: ${entry.error}`);
      return entry.signedUrl;
    });
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
      "Cache-Control": "private, no-store",
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
- Create: `lib/daily-jobs.ts`, `app/api/cron/daily/route.ts`, `vercel.json`, `integration/daily-jobs.test.ts`, `vitest.integration.config.mts`
- Modify: `package.json`

- [ ] **Step 1: Add the job logic**

Create `lib/daily-jobs.ts`. It follows spec section 11.2:
- Reminder candidates are `open` requests whose client is not archived and that have at least one `requested` or `needs_changes` item. `reminderDue()` (Phase 1) decides the day. The client's contacts come embedded in the same query.
- A firm's emails are all built first, so an error in a query or template cannot use up a claim. They are then claimed in one `upsert(…, { ignoreDuplicates: true })` on `unique (kind, target_id, sent_on)`, which is `insert … on conflict do nothing returning`. Only the returned rows were won; the rest were already claimed today. The run stops before any claim when `emailConfigError()` (Phase 1) reports unusable settings.
- A digest window starts at the member's previous claim, or 24 hours ago if there is none, so a missed day is covered by the next run. A claim records the run's own time, where the next window starts, so no submission falls between two windows. Members with nothing in the window get no digest and no claim.
- Every query error is thrown, and every read is paged, because PostgREST returns at most 1,000 rows (`max_rows`) without an error.
- Firms run five at a time, and emails go out in full batches while the run continues, so a run cut off at the 300-second limit loses little.
- Reminder reply-to is the request's creator while they are still a member; digests have none.

```ts
import "server-only";
import type { PostgrestResponse, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { isOverdue, todayUtc } from "@/lib/dates";
import { EMAIL_BATCH_SIZE, emailConfigError, sendEmails, type EmailMessage } from "@/lib/email/send";
import { reminderEmail, staffDigestEmail, type DigestGroup } from "@/lib/email/templates";
import { reminderDue } from "@/lib/reminders";

type Admin = SupabaseClient<Database>;
type Firm = { id: string; name: string };
type Member = { user_id: string; email: string };
/** The emails to send if this run wins today's (kind, target) claim. */
type Notification = { kind: "reminder" | "staff_digest"; targetId: string; emails: EmailMessage[] };

export type DailySummary = {
  firms: number;
  failedFirms: number;
  reminders: number;
  digests: number;
  sent: number;
  failed: number;
};

// PostgREST cuts responses off at max_rows (1000 by default) without an error. A page larger
// than max_rows would come back short and end the read early.
const PAGE_SIZE = 1000;
const FIRM_CONCURRENCY = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Every row of a query, read a page at a time. The query must have a stable order. */
async function readAll<Row>(page: (from: number, to: number) => PromiseLike<PostgrestResponse<Row>>): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}

/** Open requests of active clients that have open items and a reminder day today. */
async function reminders(admin: Admin, firm: Firm, members: Member[], today: string): Promise<Notification[]> {
  const requests = await readAll((from, to) =>
    admin
      .from("requests")
      .select(
        "id, title, due_date, sent_at, created_by, clients!inner(archived_at, client_contacts(email)), request_items!inner(title, position)",
      )
      .eq("firm_id", firm.id)
      .eq("status", "open")
      .is("clients.archived_at", null)
      .in("request_items.status", ["requested", "needs_changes"])
      .order("id")
      .order("position", { referencedTable: "request_items" })
      .range(from, to),
  );

  return requests.flatMap((request): Notification[] => {
    const sentOn = request.sent_at ? todayUtc(new Date(request.sent_at)) : today;
    const contacts = request.clients.client_contacts;
    if (!reminderDue({ dueDate: request.due_date, sentOn, today }) || contacts.length === 0) return [];

    const content = reminderEmail({
      firmName: firm.name,
      title: request.title,
      dueDate: request.due_date,
      overdue: isOverdue(request.due_date, today),
      openItems: request.request_items.map((item) => item.title),
      requestId: request.id,
    });
    const replyTo = members.find((m) => m.user_id === request.created_by)?.email;
    return [
      {
        kind: "reminder",
        targetId: request.id,
        emails: contacts.map((contact) => ({ ...content, to: contact.email, fromName: firm.name, replyTo })),
      },
    ];
  });
}

/**
 * Each member's digest of the items submitted since their previous digest
 * claim, or in the last 24 hours if there is none, so a missed day is covered.
 * Members with nothing new get no digest.
 */
async function digests(admin: Admin, firm: Firm, members: Member[], today: string, now: Date): Promise<Notification[]> {
  const dayAgo = new Date(now.getTime() - DAY_MS).toISOString();
  const starts = await Promise.all(
    members.map(async (member) => {
      const { data, error } = await admin
        .from("notifications_sent")
        .select("created_at")
        .eq("kind", "staff_digest")
        .eq("target_id", member.user_id)
        .lt("sent_on", today)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.created_at ?? dayAgo;
    }),
  );

  // Members whose windows start together (usually all of them) share one query and one email.
  const windows = Map.groupBy(members, (_member, index) => starts[index]);
  const results = await Promise.all(
    [...windows].map(async ([start, windowMembers]) => {
      const items = await readAll((from, to) =>
        admin
          .from("request_items")
          .select("title, request_id, requests!inner(title, clients!inner(name))")
          .eq("firm_id", firm.id)
          .gt("submitted_at", start)
          .lte("submitted_at", now.toISOString())
          .order("submitted_at")
          .order("id")
          .range(from, to),
      );
      if (items.length === 0) return [];

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
      return windowMembers.map(
        (member): Notification => ({
          kind: "staff_digest",
          targetId: member.user_id,
          emails: [{ ...content, to: member.email, fromName: firm.name }],
        }),
      );
    }),
  );
  return results.flat();
}

/**
 * Claims today's (kind, target) rows in notifications_sent in one statement
 * and returns the notifications this run won, so each goes out at most once
 * per day. created_at is the run's time, where the next digest window starts.
 * ponytail: a failed send after a claim is not retried. Upgrade path: an outbox with retries.
 */
async function claim(admin: Admin, notifications: Notification[], today: string, now: Date): Promise<Notification[]> {
  if (notifications.length === 0) return [];
  const { data, error } = await admin
    .from("notifications_sent")
    .upsert(
      notifications.map((n) => ({ kind: n.kind, target_id: n.targetId, sent_on: today, created_at: now.toISOString() })),
      { onConflict: "kind,target_id,sent_on", ignoreDuplicates: true },
    )
    .select("kind, target_id");
  if (error) throw error;
  const won = new Set(data.map((row) => `${row.kind}:${row.target_id}`));
  return notifications.filter((n) => won.has(`${n.kind}:${n.targetId}`));
}

/** A firm's reminders and digests, built in full before they are claimed so an error cannot use up today's claims. */
async function claimFirm(admin: Admin, firm: Firm, today: string, now: Date): Promise<Notification[]> {
  const members = await readAll((from, to) =>
    admin.from("firm_members").select("user_id, email").eq("firm_id", firm.id).order("user_id").range(from, to),
  );
  const [due, digest] = await Promise.all([
    reminders(admin, firm, members, today),
    digests(admin, firm, members, today, now),
  ]);
  return claim(admin, [...due, ...digest], today, now);
}

/** Reminders and staff digests for every firm. Each firm is isolated in its own try/catch. */
export async function runDailyJobs(admin: Admin, now: Date = new Date()): Promise<DailySummary> {
  // Checked before any claim, so a missing key or sender cannot use up today's emails.
  const configError = emailConfigError();
  if (configError) throw new Error(`Daily jobs not run: ${configError}`);

  const today = todayUtc(now);
  const summary: DailySummary = { firms: 0, failedFirms: 0, reminders: 0, digests: 0, sent: 0, failed: 0 };
  const firms = await readAll((from, to) => admin.from("firms").select("id, name").order("id").range(from, to));

  // Full batches go out while firms are still processed, so a run cut short loses little.
  const queue: EmailMessage[] = [];
  const sends: Promise<void>[] = [];
  function send(emails: EmailMessage[]) {
    sends.push(
      sendEmails(emails).then((result) => {
        summary.sent += result.sent;
        summary.failed += result.failed;
      }),
    );
  }

  let next = 0;
  async function worker() {
    while (next < firms.length) {
      const firm = firms[next++];
      try {
        for (const notification of await claimFirm(admin, firm, today, now)) {
          if (notification.kind === "reminder") summary.reminders++;
          else summary.digests++;
          queue.push(...notification.emails);
        }
        summary.firms++;
      } catch (err) {
        summary.failedFirms++;
        console.error(`Daily jobs failed for firm ${firm.id}`, err);
      }
      while (queue.length >= EMAIL_BATCH_SIZE) send(queue.splice(0, EMAIL_BATCH_SIZE));
    }
  }
  await Promise.all(Array.from({ length: FIRM_CONCURRENCY }, worker));
  if (queue.length > 0) send(queue);
  await Promise.all(sends);
  return summary;
}
```

- [ ] **Step 2: Add the route**

Create `app/api/cron/daily/route.ts`. It refuses every request, and logs why, when `CRON_SECRET` is unset, so a missing variable can never turn into `Bearer undefined` being accepted. The secret is compared in constant time. A run where any firm or email failed returns 500, so it shows as failed in the cron logs.

```ts
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runDailyJobs } from "@/lib/daily-jobs";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

// Equal-length digests, as timingSafeEqual requires.
const sha256 = (value: string) => createHash("sha256").update(value).digest();

/** Vercel Cron calls this once a day with Authorization: Bearer ${CRON_SECRET}. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron] CRON_SECRET is not set, so every call is refused");
    return new NextResponse("Unauthorized", { status: 401 });
  }
  if (!timingSafeEqual(sha256(request.headers.get("authorization") ?? ""), sha256(`Bearer ${secret}`))) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const summary = await runDailyJobs(createAdminClient());
  console.log(JSON.stringify({ job: "daily", ...summary }));
  // An error status marks the run as failed in Vercel's cron logs.
  const ok = summary.failedFirms === 0 && summary.failed === 0;
  return NextResponse.json(summary, { status: ok ? 200 : 500 });
}
```

- [ ] **Step 3: Add the schedule**

Create `vercel.json`:

```json
{
  "crons": [{ "path": "/api/cron/daily", "schedule": "0 13 * * *" }]
}
```

- [ ] **Step 4: Add the integration test**

The job's rules depend on real queries (embedded filters, paging, the claim upsert), so this test runs it against local Supabase. It creates two firms dated in 2031, runs the job with `sendEmails` captured, and deletes everything it created. Every run still visits every firm in the database.

Create `vitest.integration.config.mts`:

```ts
import { defineConfig } from "vitest/config";

// Needs local Supabase and .env.local; see README.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: { include: ["integration/**/*.test.ts"] },
});
```

Create `integration/daily-jobs.test.ts`:

```ts
// Runs the daily job against local Supabase, with sendEmails captured instead of sent.
// Dates are in 2031 so real claims are untouched; every run still visits every firm.
import { createClient, type PostgrestError } from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { runDailyJobs } from "@/lib/daily-jobs";
import type { Database } from "@/lib/database.types";
import type { EmailMessage } from "@/lib/email/send";

vi.mock("server-only", () => ({}));
const { outbox } = vi.hoisted(() => ({ outbox: [] as EmailMessage[] }));
vi.mock("@/lib/email/send", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email/send")>()),
  sendEmails: async (messages: EmailMessage[]) => {
    outbox.push(...messages);
    return { sent: messages.length, failed: 0 };
  },
}));

process.loadEnvFile(".env.local");
const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false },
});

const HOUR = 60 * 60 * 1000;
const start = new Date("2031-03-10T13:00:00.000Z");
const hoursFromStart = (hours: number) => new Date(start.getTime() + hours * HOUR);
const at = (hours: number) => hoursFromStart(hours).toISOString();
const day = (days: number) => at(days * 24).slice(0, 10);

const tag = Math.random().toString(36).slice(2, 8);
const users: Record<string, { id: string; email: string }> = {};
const requestIds: Record<string, string> = {};
let firm = "";
let bulkFirm = "";

async function rows<T>(query: PromiseLike<{ data: T; error: null } | { data: null; error: PostgrestError }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

const inbox = (name: string) => outbox.filter((m) => m.to === users[name].email);

beforeAll(async () => {
  for (const name of ["staffA", "staffB", "staffC", "former", "contact1", "contact2", "archivedContact", "bulkStaff", "bulkContact"]) {
    const email = `daily-${name}-${tag}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error) throw error;
    users[name] = { id: data.user.id, email };
  }
  [{ id: firm }, { id: bulkFirm }] = await rows(
    admin.from("firms").insert([{ name: `Daily ${tag}` }, { name: `Daily bulk ${tag}` }]).select("id"),
  );
  const member = (firmId: string, name: string, role: string) => ({
    firm_id: firmId,
    user_id: users[name].id,
    role,
    full_name: name,
    email: users[name].email,
  });
  await rows(
    admin
      .from("firm_members")
      .insert([member(firm, "staffA", "admin"), member(firm, "staffB", "staff"), member(bulkFirm, "bulkStaff", "admin")]),
  );
  const [{ id: client }, { id: archivedClient }, { id: bulkClient }] = await rows(
    admin
      .from("clients")
      .insert([
        { firm_id: firm, name: "Active" },
        { firm_id: firm, name: "Archived", archived_at: at(-100) },
        { firm_id: bulkFirm, name: "Bulk" },
      ])
      .select("id"),
  );
  const contact = (clientId: string, firmId: string, name: string) => ({
    client_id: clientId,
    firm_id: firmId,
    user_id: users[name].id,
    full_name: name,
    email: users[name].email,
  });
  await rows(
    admin
      .from("client_contacts")
      .insert([
        contact(client, firm, "contact1"),
        contact(client, firm, "contact2"),
        contact(archivedClient, firm, "archivedContact"),
        contact(bulkClient, bulkFirm, "bulkContact"),
      ]),
  );

  // Sent two days ago unless noted; only due7 and overdue3 have a reminder day on day 0.
  const requests = [
    { title: "due7", client_id: client, due_date: day(7) },
    { title: "due6", client_id: client, due_date: day(6) },
    { title: "archivedClient", client_id: archivedClient, due_date: day(7) },
    { title: "sentToday", client_id: client, due_date: day(7), sent_at: at(-1) },
    { title: "draft", client_id: client, due_date: day(7), sent_at: null, status: "draft" },
    { title: "overdue3", client_id: client, due_date: day(-3), created_by: users.former.id },
    { title: "noOpenItems", client_id: client, due_date: day(7) },
  ];
  const inserted = await rows(
    admin
      .from("requests")
      .insert(
        requests.map((r) => ({ firm_id: firm, status: "open", sent_at: at(-48), created_by: users.staffA.id, ...r })),
      )
      .select("id, title"),
  );
  for (const r of inserted) requestIds[r.title] = r.id;

  const item = (request: string, position: number, title: string, status: string, submittedAt: string | null = null) => ({
    request_id: requestIds[request],
    firm_id: firm,
    position,
    title,
    kind: "file",
    status,
    submitted_at: submittedAt,
  });
  await rows(
    admin
      .from("request_items")
      .insert([
        item("due7", 1, "Photo ID", "requested"),
        item("due7", 2, "W-2", "accepted", at(-60)),
        item("due7", 3, "Bank statement", "needs_changes", at(-50)),
        item("due6", 1, "Receipts", "submitted", at(-1)),
        item("due6", 2, "Old upload", "submitted", at(-30)),
        item("archivedClient", 1, "Open", "requested"),
        item("sentToday", 1, "Open", "requested"),
        item("draft", 1, "Open", "requested"),
        item("overdue3", 1, "Engagement letter", "requested"),
        item("noOpenItems", 1, "Done", "accepted", at(-60)),
      ]),
  );

  // More open requests and submitted items than PostgREST returns in one response (max_rows = 1000).
  const bulk = await rows(
    admin
      .from("requests")
      .insert(
        Array.from({ length: 1001 }, (_, i) => ({
          firm_id: bulkFirm,
          client_id: bulkClient,
          title: `Bulk ${i}`,
          due_date: day(7),
          status: "open",
          sent_at: at(-48),
        })),
      )
      .select("id"),
  );
  await rows(
    admin.from("request_items").insert(
      bulk.flatMap(({ id }, i) => [
        { request_id: id, firm_id: bulkFirm, position: 1, title: `Open ${i}`, kind: "file", status: "requested" },
        {
          request_id: id,
          firm_id: bulkFirm,
          position: 2,
          title: `Sent ${i}`,
          kind: "file",
          status: "submitted",
          submitted_at: at(-2),
        },
      ]),
    ),
  );
}, 120_000);

afterAll(async () => {
  for (const firmId of [firm, bulkFirm].filter(Boolean)) {
    await admin.from("clients").delete().eq("firm_id", firmId);
    await admin.from("firms").delete().eq("id", firmId);
  }
  for (const { id } of Object.values(users)) await admin.auth.admin.deleteUser(id);
  await admin.from("notifications_sent").delete().gte("sent_on", "2031-01-01");
}, 120_000);

it("sends each due reminder and digest once, past PostgREST's row limit", async () => {
  expect((await runDailyJobs(admin, start)).failedFirms).toBe(0);

  const reminders = inbox("contact1");
  expect(reminders).toHaveLength(2);
  const due7 = reminders.find((m) => m.subject.startsWith("Reminder: due7 is due"))!;
  expect(due7.replyTo).toBe(users.staffA.email);
  expect(due7.text).toContain("Photo ID");
  expect(due7.text).toContain("Bank statement");
  expect(due7.text).not.toContain("W-2");
  const overdue = reminders.find((m) => m.subject.startsWith("Reminder: overdue3 was due"))!;
  expect(overdue.replyTo).toBeUndefined(); // the creator is not a member
  expect(inbox("contact2")).toHaveLength(2);
  expect(inbox("archivedContact")).toHaveLength(0);

  for (const name of ["staffA", "staffB"]) {
    const [digest, ...others] = inbox(name);
    expect(others).toHaveLength(0);
    expect(digest.text).toContain("Receipts");
    expect(digest.text).not.toContain("Old upload"); // no earlier digest, so the window is 24 hours
  }

  expect(inbox("bulkContact")).toHaveLength(1001);
  expect(inbox("bulkStaff").map((m) => m.subject)).toEqual([`1001 items submitted at Daily bulk ${tag}`]);

  const claims = await rows(
    admin
      .from("notifications_sent")
      .select("created_at")
      .eq("sent_on", day(0))
      .in("target_id", [requestIds.due7, requestIds.overdue3, users.staffA.id, users.staffB.id]),
  );
  expect(claims.map((c) => Date.parse(c.created_at))).toEqual(Array(4).fill(start.getTime()));

  outbox.length = 0;
  expect((await runDailyJobs(admin, start)).failedFirms).toBe(0);
  expect(outbox.filter((m) => m.to.endsWith(`-${tag}@example.com`))).toHaveLength(0);
}, 120_000);

it("starts a digest window at the previous digest, or 24 hours back for a new member", async () => {
  await rows(
    admin
      .from("firm_members")
      .insert({ firm_id: firm, user_id: users.staffC.id, role: "staff", full_name: "staffC", email: users.staffC.email }),
  );
  await rows(
    admin.from("request_items").insert([
      { request_id: requestIds.due6, firm_id: firm, position: 3, title: "Just after", kind: "file", status: "submitted", submitted_at: at(0.5) },
      { request_id: requestIds.due6, firm_id: firm, position: 4, title: "Missed day", kind: "text", status: "submitted", submitted_at: at(26) },
    ]),
  );
  outbox.length = 0;

  // No run on day 1: the day 2 run covers it.
  expect((await runDailyJobs(admin, hoursFromStart(48))).failedFirms).toBe(0);
  for (const name of ["staffA", "staffB"]) {
    const [digest] = inbox(name);
    expect(digest.text).toContain("Just after");
    expect(digest.text).toContain("Missed day");
    expect(digest.text).not.toContain("Receipts");
  }
  const [newMember] = inbox("staffC");
  expect(newMember.text).toContain("Missed day");
  expect(newMember.text).not.toContain("Just after");
}, 120_000);

it("claims nothing when emails cannot be built or sent", async () => {
  const dueDay = hoursFromStart(7 * 24); // due7 and the bulk requests are due that day
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.NEXT_PUBLIC_SITE_URL;
  try {
    expect((await runDailyJobs(admin, dueDay)).failedFirms).toBeGreaterThanOrEqual(2);
  } finally {
    process.env.NEXT_PUBLIC_SITE_URL = siteUrl;
  }

  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("RESEND_API_KEY", "");
  try {
    await expect(runDailyJobs(admin, dueDay)).rejects.toThrow("RESEND_API_KEY is not set");
  } finally {
    vi.unstubAllEnvs();
  }

  outbox.length = 0;
  expect((await runDailyJobs(admin, dueDay)).failedFirms).toBe(0);
  expect(inbox("contact1").map((m) => m.subject)).toContainEqual(expect.stringMatching(/^Reminder: due7 is due/));
}, 120_000);
```

In `package.json`, add this script after `test:db`:

```json
    "test:integration": "vitest run --config vitest.integration.config.mts",
```

Run: `npm run test:integration`
Expected: PASS, `Tests  3 passed (3)`.

- [ ] **Step 5: Verify the route**

Run the end-to-end test first so there is a fresh submitted item: `npm run test:e2e`. Then start `npm run dev` in another terminal and run:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/cron/daily
```

Expected: `401`.

```bash
curl -s -H "Authorization: Bearer local-cron-secret" http://localhost:3000/api/cron/daily
```

Expected: JSON such as `{"firms":1,"failedFirms":0,"reminders":0,"digests":1,"sent":1,"failed":0}`. `digests` is at least 1 (the end-to-end test's submission) and `failedFirms` and `failed` are 0. The dev server prints the digest, `subject="1 item submitted at Ledger & Co"`, and one line such as `{"job":"daily",…}`.

- [ ] **Step 6: Verify a reminder**

Reopen the newest request's items and make it due in exactly 7 days, sent 2 days ago (`db query` runs one statement per call):

```bash
npx supabase db query --local "update public.request_items set status = 'requested' where request_id = (select id from public.requests order by created_at desc limit 1)"
npx supabase db query --local "update public.requests set due_date = current_date + 7, sent_at = now() - interval '2 days' where id = (select id from public.requests order by created_at desc limit 1)"
curl -s -H "Authorization: Bearer local-cron-secret" http://localhost:3000/api/cron/daily
```

Expected: `"reminders":1` and `"digests":0`. The dev server prints `subject="Reminder: 2026 tax documents is due …"` listing "Photo ID".

Run the same `curl` again.
Expected: `"reminders":0,"digests":0,"sent":0`. Today's claims hold, so nothing is sent twice.

- [ ] **Step 7: Commit**

```bash
git add lib/daily-jobs.ts app/api/cron/daily/route.ts vercel.json integration/daily-jobs.test.ts vitest.integration.config.mts package.json
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
| `npm run test:integration` | The daily reminder and digest job against local Supabase (reads `.env.local`) |
| `npm run test:e2e` | The Playwright end-to-end tests (starts `npm run dev`; run `npx playwright install chromium` once first) |
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
   - Keep "Confirm email" on (the default). With it off, anyone could sign up with a password for someone else's address and get a session.
   - Replace the "Magic Link" and "Confirm signup" email templates with `supabase/templates/sign-in-code.html`, and set both subjects to "Your sign-in code". The template shows `{{ .Token }}` and no link.
   - Configure custom SMTP with Resend.
   - Under Rate Limits, raise the email sending limit to your expected peak. Sign-in codes for every firm share this one limit, and the default is low. If sign-in emails are abused, turn on CAPTCHA protection (the sign-in form then needs a CAPTCHA widget).
   - Set the Site URL to the production domain.
3. In Resend, verify the domain of `EMAIL_FROM`. Resend's free plan sends at most 100 emails a day, counting SMTP, so a busy reminder run can use up the quota that sign-in codes need. Use a paid plan, or a separate Resend account for Supabase's SMTP.
4. In Vercel, set every variable above (use a long random `CRON_SECRET`), set the function region to the one nearest your Supabase project, and deploy. `vercel.json` schedules `/api/cron/daily` at 13:00 UTC. On the Hobby plan it runs once at some point within that hour. A run where any firm or email fails returns an error status, so it shows as failed in the cron logs.

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
npm run test:integration
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```

Expected: pgTAP `Files=15, Tests=198, Result: PASS`; Vitest `Tests  47 passed (47)`, then `Tests  3 passed (3)` for the integration test; typecheck, lint, and build succeed; Playwright `1 passed`.

Optionally run `npx supabase db advisors --local`. It reports only `multiple_permissive_policies` warnings: the staff and contact read rules are separate policies on purpose, one per actor, to match spec section 8.2.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add setup, testing, and deployment guide"
```
