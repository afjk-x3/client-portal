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
let aucklandFirm = "";

async function rows<T>(query: PromiseLike<{ data: T; error: null } | { data: null; error: PostgrestError }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

const inbox = (name: string) => outbox.filter((m) => m.to === users[name].email);

beforeAll(async () => {
  for (const name of [
    "staffA",
    "staffB",
    "staffC",
    "former",
    "contact1",
    "contact2",
    "archivedContact",
    "bulkStaff",
    "bulkContact",
    "aucklandContact",
  ]) {
    const email = `daily-${name}-${tag}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error) throw error;
    users[name] = { id: data.user.id, email };
  }
  [{ id: firm }, { id: bulkFirm }, { id: aucklandFirm }] = await rows(
    admin
      .from("firms")
      .insert([
        { name: `Daily ${tag}`, time_zone: "UTC" },
        { name: `Daily bulk ${tag}`, time_zone: "UTC" },
        { name: `Daily Auckland ${tag}`, time_zone: "Pacific/Auckland" },
      ])
      .select("id"),
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
  const [{ id: client }, { id: archivedClient }, { id: bulkClient }, { id: aucklandClient }] = await rows(
    admin
      .from("clients")
      .insert([
        { firm_id: firm, name: "Active", archived_at: null },
        { firm_id: firm, name: "Archived", archived_at: at(-100) },
        { firm_id: bulkFirm, name: "Bulk", archived_at: null },
        { firm_id: aucklandFirm, name: "Auckland", archived_at: null },
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
        contact(aucklandClient, aucklandFirm, "aucklandContact"),
      ]),
  );

  // At the first run (13:00 UTC on March 10) it is already March 11 in Auckland,
  // so a request due March 18 is 7 days out there, and 8 in UTC.
  const [{ id: aucklandRequest }] = await rows(
    admin
      .from("requests")
      .insert({ firm_id: aucklandFirm, client_id: aucklandClient, title: "auckland7", due_date: day(8), status: "open", sent_at: at(-48) })
      .select("id"),
  );
  requestIds.auckland7 = aucklandRequest;
  await rows(
    admin
      .from("request_items")
      .insert({ request_id: aucklandRequest, firm_id: aucklandFirm, position: 1, title: "Passport", kind: "file", status: "requested" }),
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
  for (const firmId of [firm, bulkFirm, aucklandFirm].filter(Boolean)) {
    await rows(admin.from("clients").delete().eq("firm_id", firmId));
    await rows(admin.from("firms").delete().eq("id", firmId));
  }
  for (const { id } of Object.values(users)) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw error;
  }
  await rows(admin.from("notifications_sent").delete().gte("sent_on", "2031-01-01"));
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

  // Reminder days and claims follow each firm's own calendar.
  expect(inbox("aucklandContact").map((m) => m.subject)).toEqual([expect.stringMatching(/^Reminder: auckland7 is due/)]);
  const [aucklandClaim] = await rows(
    admin.from("notifications_sent").select("sent_on").eq("target_id", requestIds.auckland7),
  );
  expect(aucklandClaim.sent_on).toBe(day(1));

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
  // staffC is new; staffB leaves and rejoins after the day 0 digest, which then no longer counts.
  await rows(admin.from("firm_members").delete().eq("user_id", users.staffB.id));
  await rows(
    admin
      .from("firm_members")
      .insert({ firm_id: firm, user_id: users.staffC.id, role: "staff", full_name: "staffC", email: users.staffC.email }),
  );
  await rows(
    admin.from("firm_members").insert({
      firm_id: firm,
      user_id: users.staffB.id,
      role: "staff",
      full_name: "staffB",
      email: users.staffB.email,
      created_at: at(1),
    }),
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
  const [digest] = inbox("staffA");
  expect(digest.text).toContain("Just after");
  expect(digest.text).toContain("Missed day");
  expect(digest.text).not.toContain("Receipts");
  for (const name of ["staffB", "staffC"]) {
    const [fresh] = inbox(name);
    expect(fresh.text).toContain("Missed day");
    expect(fresh.text).not.toContain("Just after");
  }
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
  vi.stubEnv("SMTP_HOST", "");
  try {
    await expect(runDailyJobs(admin, dueDay)).rejects.toThrow("RESEND_API_KEY or SMTP_HOST is not set");
  } finally {
    vi.unstubAllEnvs();
  }

  outbox.length = 0;
  expect((await runDailyJobs(admin, dueDay)).failedFirms).toBe(0);
  expect(inbox("contact1").map((m) => m.subject)).toContainEqual(expect.stringMatching(/^Reminder: due7 is due/));
}, 120_000);
