// Runs the daily job's outbox against local Supabase, with sendEmails scripted instead of sent.
// runDailyJobs takes its own "now", but claims use the database's clock: a row is made due by
// setting send_after into the past, and the run's date (2031) keeps real reminder claims away.
import { createClient, type PostgrestError } from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { runDailyJobs } from "@/lib/daily-jobs";
import type { Database } from "@/lib/database.types";
import { deliver } from "@/lib/email/deliver";
import type { EmailMessage, EmailOutcome } from "@/lib/email/send";
import { readSignInCode } from "../e2e/mailpit";

vi.mock("server-only", () => ({}));
const capture = vi.hoisted(() => ({ sent: [] as EmailMessage[], script: [] as EmailOutcome[] }));
vi.mock("@/lib/email/send", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email/send")>()),
  sendEmails: async (messages: EmailMessage[]) => {
    capture.sent.push(...messages);
    const results = messages.map((): EmailOutcome => capture.script.shift() ?? { ok: true });
    return { sent: results.filter((o) => o.ok).length, failed: results.filter((o) => !o.ok).length, results };
  },
}));

process.loadEnvFile(".env.local");
const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false },
});

const now = new Date("2031-03-10T13:00:00.000Z");
const today = "2031-03-10";
const tag = Math.random().toString(36).slice(2, 8);
const users: Record<string, { id: string; email: string }> = {};
let firm = "";
let client = "";
let contact1 = "";
const requestIds: Record<string, string> = {};

async function rows<T>(query: PromiseLike<{ data: T; error: null } | { data: null; error: PostgrestError }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/** Queues one held row directly, as an action or the daily job would leave one. */
async function seed(kind: "request_sent" | "reminder", extra: { request_id: string; reply_to_id?: string; failures?: number }) {
  const [row] = await rows(
    admin
      .from("email_outbox")
      .insert({
        firm_id: firm,
        kind,
        recipient: contact1,
        request_id: extra.request_id,
        reply_to_id: extra.reply_to_id ?? null,
        failures: extra.failures ?? 0,
        send_after: new Date(Date.now() - 60_000).toISOString(),
      })
      .select("id"),
  );
  return row.id;
}

async function queued(id: number) {
  const { data, error } = await admin.from("email_outbox").select("id, failures").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}
const freshCapture = () => {
  capture.sent.length = 0;
  capture.script.length = 0;
};

beforeAll(async () => {
  for (const name of ["staff", "contact1"]) {
    const email = `outbox-${name}-${tag}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error) throw error;
    users[name] = { id: data.user.id, email };
  }
  contact1 = users.contact1.email;

  const [{ id: createdFirm }] = await rows(
    admin.from("firms").insert({ name: `Outbox ${tag}`, time_zone: "UTC" }).select("id"),
  );
  firm = createdFirm;
  await rows(
    admin.from("firm_members").insert({
      firm_id: firm,
      user_id: users.staff.id,
      role: "admin",
      full_name: "staff",
      email: users.staff.email,
    }),
  );
  const [{ id: createdClient }] = await rows(
    admin.from("clients").insert({ firm_id: firm, name: "Client", archived_at: null }).select("id"),
  );
  client = createdClient;
  await rows(
    admin.from("client_contacts").insert({
      client_id: client,
      firm_id: firm,
      user_id: users.contact1.id,
      full_name: "contact1",
      email: contact1,
    }),
  );

  const request = (
    title: string,
    extra: { status: string; sent_at: string | null; due_date: string; created_by: string },
  ) => ({ firm_id: firm, client_id: client, title, ...extra });
  const inserted = await rows(
    admin
      .from("requests")
      .insert([
        // No reminder day at now (due in 10 days), so a run only sends what a test queued.
        request("Open", { status: "open", sent_at: "2031-03-08T13:00:00.000Z", due_date: "2031-03-20", created_by: users.staff.id }),
        request("Held", { status: "open", sent_at: "2031-03-08T13:00:00.000Z", due_date: "2031-03-20", created_by: users.staff.id }),
        request("Archived", { status: "archived", sent_at: "2031-03-08T13:00:00.000Z", due_date: "2031-03-20", created_by: users.staff.id }),
        request("Draft", { status: "draft", sent_at: null, due_date: "2031-03-20", created_by: users.staff.id }),
      ])
      .select("id, title"),
  );
  for (const r of inserted) requestIds[r.title] = r.id;
  await rows(
    admin.from("request_items").insert(
      inserted.map((r) => ({ request_id: r.id, firm_id: firm, position: 1, title: "Open item", kind: "file", status: "requested" })),
    ),
  );

  // Block other firms' reminder claims for this run's date, so their requests cannot add rows.
  const others = await rows(admin.from("requests").select("id").neq("firm_id", firm));
  if (others.length > 0) {
    await rows(
      admin
        .from("notifications_sent")
        .upsert(
          others.map((r) => ({ kind: "reminder", target_id: r.id, sent_on: today })),
          { onConflict: "kind,target_id,sent_on", ignoreDuplicates: true },
        ),
    );
  }

  // Any outbox left from browser tests would be claimed with ours.
  await rows(admin.from("email_outbox").delete().gte("id", 0));
}, 120_000);

afterAll(async () => {
  const claimTargets = [...Object.values(requestIds), users.staff.id, users.contact1.id];
  await rows(admin.from("notifications_sent").delete().in("target_id", claimTargets));
  await rows(admin.from("email_outbox").delete().eq("firm_id", firm));
  await rows(admin.from("clients").delete().eq("firm_id", firm));
  await rows(admin.from("firms").delete().eq("id", firm));
  for (const { id } of Object.values(users)) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw error;
  }
}, 120_000);

it("sends a waiting reminder for an open request and deletes the row", async () => {
  freshCapture();
  const id = await seed("reminder", { request_id: requestIds.Open, reply_to_id: users.staff.id });

  const summary = await runDailyJobs(admin, now);

  expect(summary.outboxFailed).toBe(false);
  expect(summary.outbox).toEqual({ sent: 1, retrying: 0, gaveUp: 0, dropped: 0 });
  expect(await queued(id)).toBeNull();
  const [mail] = capture.sent;
  expect(mail.subject).toContain("Reminder: Open is due");
  expect(mail.replyTo).toBe(users.staff.email);
}, 120_000);

it("keeps a retryable failure with one failure and logs it as retrying", async () => {
  freshCapture();
  const id = await seed("reminder", { request_id: requestIds.Open, reply_to_id: users.staff.id });
  capture.script.push({ ok: false, reason: "daily sending limit reached", retry: true });

  const summary = await runDailyJobs(admin, now);

  expect(summary.outbox).toEqual({ sent: 0, retrying: 1, gaveUp: 0, dropped: 0 });
  expect(await queued(id)).toEqual({ id, failures: 1 });
  const events = await rows(
    admin
      .from("request_events")
      .select("detail, actor_id")
      .eq("request_id", requestIds.Open)
      .eq("kind", "email_failed")
      .order("id"),
  );
  expect(events).toHaveLength(1);
  expect(events[0].detail).toMatchObject({
    email: "reminder",
    to: contact1,
    reason: "daily sending limit reached",
    outcome: "retrying",
  });
  expect(events[0].actor_id).toBeNull();
}, 120_000);

it("gives up on the fourth failure and logs it", async () => {
  freshCapture();
  // Continues the row the previous test left waiting with one failure.
  const [{ id }] = await rows(
    admin.from("email_outbox").select("id").eq("request_id", requestIds.Open).eq("kind", "reminder"),
  );

  for (let attempt = 2; attempt <= 4; attempt++) {
    await rows(admin.from("email_outbox").update({ send_after: new Date(Date.now() - 1000).toISOString() }).eq("id", id).select("id"));
    capture.script.push({ ok: false, reason: "daily sending limit reached", retry: true });
    const summary = await runDailyJobs(admin, now);
    expect(summary.outbox[attempt === 4 ? "gaveUp" : "retrying"]).toBe(1);
  }

  expect(await queued(id)).toBeNull();
  const events = await rows(
    admin.from("request_events").select("detail").eq("request_id", requestIds.Open).eq("kind", "email_failed").order("id"),
  );
  expect(events).toHaveLength(4);
  expect(events[3].detail).toMatchObject({ outcome: "gave_up", reason: "daily sending limit reached" });
}, 120_000);

it("sends a never-attempted request email with the request's current title and message", async () => {
  freshCapture();
  const id = await seed("request_sent", { request_id: requestIds.Held });
  await rows(
    admin
      .from("requests")
      .update({ title: "Renamed while waiting", message: "Bring the good scans." })
      .eq("id", requestIds.Held)
      .select("id"),
  );

  const summary = await runDailyJobs(admin, now);

  expect(summary.outbox).toEqual({ sent: 1, retrying: 0, gaveUp: 0, dropped: 0 });
  expect(await queued(id)).toBeNull();
  const [mail] = capture.sent;
  expect(mail.subject).toContain("Renamed while waiting");
  expect(mail.text).toContain("Bring the good scans.");
}, 120_000);

it("drops queued emails whose request no longer applies", async () => {
  freshCapture();
  const archived = await seed("request_sent", { request_id: requestIds.Archived });
  const draft = await seed("request_sent", { request_id: requestIds.Draft });

  const summary = await runDailyJobs(admin, now);

  expect(summary.outbox).toEqual({ sent: 0, retrying: 0, gaveUp: 0, dropped: 2 });
  expect(await queued(archived)).toBeNull();
  expect(await queued(draft)).toBeNull();
  expect(capture.sent).toHaveLength(0);
}, 120_000);

it("sends exactly one reminder when a retrying row already waits for the contact", async () => {
  freshCapture();
  // Due in 7 days: the run's reminder day, so the job claims it and replaces the waiting row.
  const [{ id: due }] = await rows(
    admin
      .from("requests")
      .insert({
        firm_id: firm,
        client_id: client,
        title: "Due soon",
        status: "open",
        sent_at: "2031-03-08T13:00:00.000Z",
        due_date: "2031-03-17",
        created_by: users.staff.id,
      })
      .select("id"),
  );
  requestIds.Due = due;
  await rows(
    admin.from("request_items").insert({ request_id: due, firm_id: firm, position: 1, title: "Open item", kind: "file", status: "requested" }),
  );
  const id = await seed("reminder", { request_id: due, failures: 1 });

  const summary = await runDailyJobs(admin, now);

  expect(summary.reminders).toBe(1);
  expect(summary.outbox).toEqual({ sent: 1, retrying: 0, gaveUp: 0, dropped: 0 });
  expect(await queued(id)).toBeNull();
  expect(capture.sent.filter((m) => m.subject.startsWith("Reminder:"))).toHaveLength(1);
}, 120_000);

it("returns disjoint rows to two claims at once", async () => {
  const ids = await Promise.all([
    seed("request_sent", { request_id: requestIds.Open }),
    seed("request_sent", { request_id: requestIds.Archived }),
    seed("request_sent", { request_id: requestIds.Draft }),
  ]);

  const [first, second] = await Promise.all([
    admin.rpc("claim_due_emails", { max_rows: 1000 }),
    admin.rpc("claim_due_emails", { max_rows: 1000 }),
  ]);
  if (first.error) throw first.error;
  if (second.error) throw second.error;

  const a = first.data.map((row) => row.id);
  const b = second.data.map((row) => row.id);
  expect(a.filter((id) => b.includes(id))).toHaveLength(0);
  expect(a.length + b.length).toBeGreaterThanOrEqual(1);
  expect(a.length + b.length).toBeLessThanOrEqual(ids.length);
}, 120_000);

it("records an action's send through the signed-in staff member's own session", async () => {
  freshCapture();
  // The action's after() runs with the user-scoped client, so deliver() must be able to
  // execute record_email_result through that session, not only through the service role.
  // Sign in exactly as the app does: a 6-digit code, read from Mailpit.
  const staff = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error: otpError } = await staff.auth.signInWithOtp({ email: users.staff.email });
  if (otpError) throw otpError;
  const code = await readSignInCode(users.staff.email);
  const { error: verifyError } = await staff.auth.verifyOtp({ email: users.staff.email, token: code, type: "email" });
  if (verifyError) throw verifyError;

  // What sendRequest leaves behind: one held row per contact, queued before the change.
  const { data: held, error: queueError } = await staff.rpc("queue_request_emails", {
    kind: "request_sent",
    request_id: requestIds.Draft,
  });
  if (queueError) throw queueError;
  expect(held).toHaveLength(1);

  await deliver(staff, [
    {
      emailId: held[0].email_id,
      to: held[0].recipient,
      fromName: "Outbox",
      subject: "Draft request",
      html: "<p>Draft request</p>",
      text: "Draft request",
    },
  ]);

  expect(capture.sent).toHaveLength(1);
  expect(await queued(held[0].email_id)).toBeNull();
}, 120_000);
