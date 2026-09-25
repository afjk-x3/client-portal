import "server-only";
import type { PostgrestResponse, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { isOverdue, todayIn } from "@/lib/dates";
import { EMAIL_BATCH_SIZE, emailConfigError, sendEmails, type EmailMessage } from "@/lib/email/send";
import { reminderEmail, staffDigestEmail, type DigestGroup } from "@/lib/email/templates";
import { reminderDue } from "@/lib/reminders";

type Admin = SupabaseClient<Database>;
type Firm = { id: string; name: string; time_zone: string };
type Member = { user_id: string; email: string; created_at: string };
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
// than max_rows would come back short and end the read early (see the README).
const PAGE_SIZE = 1000;
const FIRM_CONCURRENCY = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const NIL_UUID = "00000000-0000-0000-0000-000000000000"; // sorts before every generated id

/**
 * Every row of a query, a page at a time. Each page starts after the previous
 * page's last row (keyset paging), so rows that change during the read cannot
 * shift others into a second page or out of both. Callers type `last` with the
 * key columns they page by.
 */
async function readAll<Row>(page: (last: Row | undefined) => PromiseLike<PostgrestResponse<Row>>): Promise<Row[]> {
  const rows: Row[] = [];
  for (;;) {
    const { data, error } = await page(rows.at(-1));
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}

/** Open requests of active clients that have open items and a reminder day today. */
async function reminders(admin: Admin, firm: Firm, members: Member[], today: string): Promise<Notification[]> {
  const requests = await readAll((last?: { id: string }) =>
    admin
      .from("requests")
      .select(
        "id, title, due_date, sent_at, created_by, clients!inner(archived_at, client_contacts(email)), request_items!inner(title, position)",
      )
      .eq("firm_id", firm.id)
      .eq("status", "open")
      .is("clients.archived_at", null)
      .in("request_items.status", ["requested", "needs_changes"])
      .gt("id", last?.id ?? NIL_UUID)
      .order("id")
      .order("position", { referencedTable: "request_items" })
      .limit(PAGE_SIZE),
  );

  return requests.flatMap((request): Notification[] => {
    const sentOn = request.sent_at ? todayIn(firm.time_zone, new Date(request.sent_at)) : today;
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
 * Only claims made since the member joined count, so someone who changes firms
 * starts fresh. Members with nothing new get no digest.
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
        .gt("created_at", member.created_at)
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
      const items = await readAll((last?: { id: string; submitted_at: string | null }) => {
        const query = admin
          .from("request_items")
          .select("id, title, request_id, submitted_at, requests!inner(title, clients!inner(name))")
          .eq("firm_id", firm.id)
          .gt("submitted_at", start)
          .lte("submitted_at", now.toISOString())
          .order("submitted_at")
          .order("id")
          .limit(PAGE_SIZE);
        // After the previous page's last (submitted_at, id); items can share a timestamp.
        return last
          ? query.or(`submitted_at.gt."${last.submitted_at}",and(submitted_at.eq."${last.submitted_at}",id.gt.${last.id})`)
          : query;
      });
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
 * ponytail: sendEmails tries a failed send up to 3 times within the run. An email
 * that still fails, or never starts because the run hits its 300-second limit, is
 * lost after its claim. Upgrade path: an outbox that the next run sends again.
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

/**
 * A firm's reminders and digests, built in full before they are claimed so an
 * error cannot use up today's claims. "Today" is the date in the firm's time zone.
 */
async function claimFirm(admin: Admin, firm: Firm, now: Date): Promise<Notification[]> {
  const today = todayIn(firm.time_zone, now);
  const members = await readAll((last?: { user_id: string }) =>
    admin
      .from("firm_members")
      .select("user_id, email, created_at")
      .eq("firm_id", firm.id)
      .gt("user_id", last?.user_id ?? NIL_UUID)
      .order("user_id")
      .limit(PAGE_SIZE),
  );
  const [due, digest] = await Promise.all([
    reminders(admin, firm, members, today),
    digests(admin, firm, members, today, now),
  ]);
  return claim(admin, [...due, ...digest], today, now);
}

/**
 * Reminders and staff digests for every firm. Each firm is isolated in its own try/catch.
 * ponytail: the job runs once a day at 01:00 UTC (vercel.json), 9 am in UTC+8, so
 * firms in other time zones get their emails at other local hours. Upgrade path:
 * run hourly (Vercel Pro) and send at a set local hour per firm.
 */
export async function runDailyJobs(admin: Admin, now: Date = new Date()): Promise<DailySummary> {
  // Checked before any claim, so a missing key or sender cannot use up today's emails.
  const configError = emailConfigError();
  if (configError) throw new Error(`Daily jobs not run: ${configError}`);

  const summary: DailySummary = { firms: 0, failedFirms: 0, reminders: 0, digests: 0, sent: 0, failed: 0 };
  const firms = await readAll((last?: { id: string }) =>
    admin.from("firms").select("id, name, time_zone").gt("id", last?.id ?? NIL_UUID).order("id").limit(PAGE_SIZE),
  );

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
        for (const notification of await claimFirm(admin, firm, now)) {
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
