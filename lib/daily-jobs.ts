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

    // Built before the claim, so a configuration error does not use up today's reminder.
    const content = reminderEmail({
      firmName: firm.name,
      title: request.title,
      dueDate: request.due_date,
      overdue: isOverdue(request.due_date, today),
      openItems: request.request_items.map((item) => item.title),
      requestId: request.id,
    });
    if (!(await claim(admin, "reminder", request.id, today))) continue;
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
    if (!(await claim(admin, "staff_digest", member.user_id, today))) continue;
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
