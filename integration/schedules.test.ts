// Runs the daily job against local Supabase with sendEmails captured: a due
// schedule sends its requests once, and a second run the same day sends no more.
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { runDailyJobs } from "@/lib/daily-jobs";
import type { Database } from "@/lib/database.types";
import type { EmailMessage, EmailOutcome } from "@/lib/email/send";

vi.mock("server-only", () => ({}));
const { outbox } = vi.hoisted(() => ({ outbox: [] as EmailMessage[] }));
vi.mock("@/lib/email/send", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email/send")>()),
  sendEmails: async (messages: EmailMessage[]) => {
    outbox.push(...messages);
    const results = messages.map((): EmailOutcome => ({ ok: true }));
    return { sent: messages.length, failed: 0, results };
  },
}));

process.loadEnvFile(".env.local");
const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false },
});

const start = new Date("2031-05-11T13:00:00.000Z");
const tag = Math.random().toString(36).slice(2, 8);
let firm = "";
let contactEmail = "";

async function rows<T>(query: PromiseLike<{ data: T; error: null } | { data: null; error: Error }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

beforeAll(async () => {
  // Schedules left by e2e runs are due in this test's 2031 date too.
  await rows(admin.from("schedules").delete().not("id", "is", null));
  const { data: staff, error: staffError } = await admin.auth.admin.createUser({
    email: `sched-staff-${tag}@example.com`,
    email_confirm: true,
  });
  if (staffError) throw staffError;
  const { data: contact, error: contactError } = await admin.auth.admin.createUser({
    email: `sched-contact-${tag}@example.com`,
    email_confirm: true,
  });
  if (contactError) throw contactError;
  contactEmail = contact.user.email!;

  [{ id: firm }] = await rows(
    admin.from("firms").insert({ name: `Schedules ${tag}`, time_zone: "UTC" }).select("id"),
  );
  await rows(
    admin.from("firm_members").insert({
      firm_id: firm,
      user_id: staff.user.id,
      role: "admin",
      full_name: "Schedule staff",
      email: staff.user.email!,
    }),
  );
  const [{ id: client }] = await rows(admin.from("clients").insert({ firm_id: firm, name: "Monthly" }).select("id"));
  await rows(
    admin.from("client_contacts").insert({
      client_id: client,
      firm_id: firm,
      user_id: contact.user.id,
      full_name: "Contact",
      email: contactEmail,
    }),
  );
  const [{ id: template }] = await rows(
    admin.from("templates").insert({ firm_id: firm, name: "Monthly bookkeeping" }).select("id"),
  );
  await rows(
    admin
      .from("template_items")
      .insert({ template_id: template, firm_id: firm, position: 1, title: "Bank statements", kind: "file" }),
  );
  const [{ id: schedule }] = await rows(
    admin
      .from("schedules")
      .insert({
        firm_id: firm,
        template_id: template,
        title: "Monthly bookkeeping",
        every_months: 1,
        day_of_month: 11,
        next_send_on: "2031-05-11",
        due_after_days: 14,
        created_by: staff.user.id,
        paused: false,
      })
      .select("id"),
  );
  await rows(admin.from("schedule_clients").insert({ schedule_id: schedule, client_id: client, firm_id: firm }));
}, 120_000);

afterAll(async () => {
  // templates.firm_id is NO ACTION, so templates must go before the firm.
  await rows(admin.from("template_items").delete().eq("firm_id", firm));
  await rows(admin.from("templates").delete().eq("firm_id", firm));
  await rows(admin.from("clients").delete().eq("firm_id", firm));
  await rows(admin.from("firms").delete().eq("id", firm));
  const { data: users } = await admin.auth.admin.listUsers();
  for (const user of users?.users ?? []) {
    if (user.email?.includes(`-${tag}@example.com`)) await admin.auth.admin.deleteUser(user.id);
  }
});

it("sends a due schedule once a day", async () => {
  const first = await runDailyJobs(admin, start);
  expect(first.failedFirms).toBe(0);
  expect(first.scheduled).toBe(1);

  const emails = outbox.filter((m) => m.to === contactEmail);
  expect(emails).toHaveLength(1);
  expect(emails[0].subject).toContain("needs documents from you");

  const waiting = await rows(
    admin.from("email_outbox").select("id").eq("firm_id", firm).eq("kind", "request_sent"),
  );
  expect(waiting).toHaveLength(0);

  outbox.length = 0;
  const second = await runDailyJobs(admin, start);
  expect(second.failedFirms).toBe(0);
  expect(second.scheduled).toBe(0);
  expect(outbox.filter((m) => m.to === contactEmail)).toHaveLength(0);
}, 120_000);
