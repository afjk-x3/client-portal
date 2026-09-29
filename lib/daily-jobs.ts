import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { todayIn } from "@/lib/dates";
import { emailConfigError } from "@/lib/email/send";
import { sendDueEmails, type OutboxSummary } from "@/lib/email/outbox";
import { reminderDue } from "@/lib/reminders";
import { NIL_UUID, PAGE_SIZE, readAll } from "@/lib/supabase/read-all";

type Admin = SupabaseClient<Database>;
type Firm = { id: string; name: string; time_zone: string };
type Member = { user_id: string; email: string; created_at: string };
/** One outbox row to queue if this run wins today's (kind, target) claim. */
type Queued = Omit<Database["public"]["Tables"]["email_outbox"]["Insert"], "send_after" | "failures">;
/** The emails to queue if this run wins today's (kind, target) claim. */
type Notification = { kind: "reminder" | "staff_digest"; targetId: string; rows: Queued[] };

export type DailySummary = {
  firms: number;
  failedFirms: number;
  reminders: number;
  digests: number;
  outbox: OutboxSummary;
  outboxFailed: boolean;
};

const FIRM_CONCURRENCY = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Open requests of active clients that have open items and a reminder day today. */
async function reminders(admin: Admin, firm: Firm, today: string): Promise<Notification[]> {
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

    return [
      {
        kind: "reminder",
        targetId: request.id,
        rows: contacts.map((contact) => ({
          firm_id: firm.id,
          kind: "reminder",
          recipient: contact.email,
          request_id: request.id,
          reply_to_id: request.created_by ?? null,
        })),
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

  // Members whose windows start together (usually all of them) share one query.
  const windows = Map.groupBy(members, (_member, index) => starts[index]);
  const results = await Promise.all(
    [...windows].map(async ([start, windowMembers]) => {
      const items = await readAll((last?: { id: string; submitted_at: string | null }) => {
        const query = admin
          .from("request_items")
          .select("id, submitted_at")
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

      return windowMembers.map(
        (member): Notification => ({
          kind: "staff_digest",
          targetId: member.user_id,
          rows: [
            {
              firm_id: firm.id,
              kind: "staff_digest",
              recipient: member.email,
              window_start: start,
              window_end: now.toISOString(),
            },
          ],
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
 * A firm's reminders and digests, decided before they are claimed so an error
 * cannot use up today's claims. The won notifications are queued in the outbox,
 * due at once; a queueing error fails the firm, as a read error does.
 * "Today" is the date in the firm's time zone.
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
    reminders(admin, firm, today),
    digests(admin, firm, members, today, now),
  ]);
  const won = await claim(admin, [...due, ...digest], today, now);
  const rows = won
    .flatMap((notification) => notification.rows)
    .map((row) => ({ ...row, failures: 0, send_after: new Date().toISOString() }));
  if (rows.length > 0) {
    // Replaces a reminder still waiting, so it goes out once with the new send time.
    const { error } = await admin
      .from("email_outbox")
      .upsert(rows, { onConflict: "kind,recipient,request_id,item_id,window_end" });
    if (error) throw error;
  }
  return won;
}

/**
 * Reminders and staff digests for every firm, then the outbox's due emails.
 * Each firm is isolated in its own try/catch; an outbox failure fails the run.
 * ponytail: the job runs once a day at 01:00 UTC (vercel.json), 9 am in UTC+8, so
 * firms in other time zones get their emails at other local hours. Upgrade path:
 * run hourly (Vercel Pro) and send at a set local hour per firm.
 */
export async function runDailyJobs(admin: Admin, now: Date = new Date()): Promise<DailySummary> {
  // Checked before any claim, so a missing key or sender cannot use up today's emails.
  const configError = emailConfigError();
  if (configError) throw new Error(`Daily jobs not run: ${configError}`);

  const summary: DailySummary = {
    firms: 0,
    failedFirms: 0,
    reminders: 0,
    digests: 0,
    outbox: { sent: 0, retrying: 0, gaveUp: 0, dropped: 0 },
    outboxFailed: false,
  };
  const firms = await readAll((last?: { id: string }) =>
    admin.from("firms").select("id, name, time_zone").gt("id", last?.id ?? NIL_UUID).order("id").limit(PAGE_SIZE),
  );

  let next = 0;
  async function worker() {
    while (next < firms.length) {
      const firm = firms[next++];
      try {
        for (const notification of await claimFirm(admin, firm, now)) {
          if (notification.kind === "reminder") summary.reminders++;
          else summary.digests++;
        }
        summary.firms++;
      } catch (err) {
        summary.failedFirms++;
        console.error(`Daily jobs failed for firm ${firm.id}`, err);
      }
    }
  }
  await Promise.all(Array.from({ length: FIRM_CONCURRENCY }, worker));

  try {
    summary.outbox = await sendDueEmails(admin, now);
  } catch (err) {
    summary.outboxFailed = true;
    console.error("The outbox failed", err);
  }
  return summary;
}
