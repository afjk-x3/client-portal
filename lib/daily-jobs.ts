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
