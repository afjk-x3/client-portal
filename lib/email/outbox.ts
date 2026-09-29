import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { isOverdue, todayIn } from "@/lib/dates";
import { sendEmails, type EmailMessage } from "@/lib/email/send";
import {
  needsChangesEmail,
  reminderEmail,
  requestSentEmail,
  staffAddedEmail,
  staffDigestEmail,
  type DigestGroup,
  type EmailContent,
} from "@/lib/email/templates";
import { PAGE_SIZE, readAll } from "@/lib/supabase/read-all";

type Admin = SupabaseClient<Database>;
export type OutboxRow = Database["public"]["Functions"]["claim_due_emails"]["Returns"][number];
export type OutboxSummary = { sent: number; retrying: number; gaveUp: number; dropped: number };

type Firm = { id: string; name: string; time_zone: string };
type Member = { user_id: string; firm_id: string; email: string; full_name: string };
type Request = {
  id: string;
  title: string;
  due_date: string;
  message: string | null;
  status: string;
  clients: { archived_at: string | null; client_contacts: { email: string }[] } | null;
  request_items: { id: string; title: string; position: number; status: string; review_note: string | null }[];
};
type DigestItem = {
  id: string;
  title: string;
  unavailable_reason: string | null;
  request_id: string;
  submitted_at: string;
  requests: { title: string; clients: { name: string } };
};

async function list<Row>(query: PromiseLike<{ data: Row[] | null; error: { message: string } | null }>): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/** The items each digest row's window covers, keyed by row id; null when the window is empty. */
async function digestGroups(admin: Admin, rows: OutboxRow[]): Promise<Map<number, DigestGroup[] | null>> {
  const groups = new Map<number, DigestGroup[] | null>();
  const windows = Map.groupBy(
    rows.filter((row) => row.kind === "staff_digest"),
    (row) => `${row.firm_id}|${row.window_start}|${row.window_end}`,
  );
  for (const [key, windowRows] of windows) {
    const [firmId, start, end] = key.split("|");
    const items = await readAll((last?: { submitted_at: string | null; id: string }) => {
      const query = admin
        .from("request_items")
        .select("id, title, unavailable_reason, request_id, submitted_at, requests!inner(title, clients!inner(name))")
        .eq("firm_id", firmId)
        .gt("submitted_at", start)
        .lte("submitted_at", end)
        .order("submitted_at")
        .order("id")
        .limit(PAGE_SIZE);
      // After the previous page's last (submitted_at, id); items can share a timestamp.
      return last
        ? query.or(`submitted_at.gt."${last.submitted_at}",and(submitted_at.eq."${last.submitted_at}",id.gt.${last.id})`)
        : query;
    });
    if (items.length === 0) {
      for (const row of windowRows) groups.set(row.id, null);
      continue;
    }
    const byRequest = new Map<string, DigestGroup>();
    for (const item of items as DigestItem[]) {
      const group = byRequest.get(item.request_id) ?? {
        clientName: item.requests.clients.name,
        requestTitle: item.requests.title,
        requestId: item.request_id,
        items: [],
      };
      group.items.push({ title: item.title, unavailable: item.unavailable_reason !== null });
      byRequest.set(item.request_id, group);
    }
    for (const row of windowRows) groups.set(row.id, [...byRequest.values()]);
  }
  return groups;
}

/**
 * Rebuilds each claimed row's email from current data, per spec §5.3, so a
 * retried reminder lists today's open items. A row that no longer applies maps
 * to null and is deleted unsent.
 */
export async function renderQueued(admin: Admin, rows: OutboxRow[], now: Date): Promise<(EmailMessage | null)[]> {
  if (rows.length === 0) return [];

  const requestIds = [...new Set(rows.flatMap((row) => (row.request_id ? [row.request_id] : [])))];
  const replyIds = [...new Set(rows.flatMap((row) => (row.reply_to_id ? [row.reply_to_id] : [])))];
  const staffRows = rows.filter((row) => row.kind === "staff_added" || row.kind === "staff_digest");
  const staffEmails = [...new Set(staffRows.map((row) => row.recipient))];

  const [firms, requests, replyTos, staffMembers, groups] = await Promise.all([
    list<Firm>(admin.from("firms").select("id, name, time_zone").in("id", [...new Set(rows.map((r) => r.firm_id))])),
    requestIds.length > 0
      ? list<Request>(
          admin
            .from("requests")
            .select(
              "id, title, due_date, message, status, clients(archived_at, client_contacts(email)), request_items(id, title, position, status, review_note)",
            )
            .in("id", requestIds)
            .order("position", { referencedTable: "request_items" }),
        )
      : Promise.resolve([] as Request[]),
    replyIds.length > 0
      ? list<Member>(admin.from("firm_members").select("user_id, firm_id, email, full_name").in("user_id", replyIds))
      : Promise.resolve([] as Member[]),
    staffEmails.length > 0
      ? list<Member>(admin.from("firm_members").select("user_id, firm_id, email, full_name").in("email", staffEmails))
      : Promise.resolve([] as Member[]),
    digestGroups(admin, rows),
  ]);

  const firmsById = new Map(firms.map((firm) => [firm.id, firm]));
  const requestsById = new Map(requests.map((request) => [request.id, request]));
  const replyTosById = new Map(replyTos.map((member) => [`${member.user_id}:${member.firm_id}`, member]));
  const staffMembersById = new Map(staffMembers.map((member) => [`${member.email}:${member.firm_id}`, member]));

  return rows.map((row): EmailMessage | null => {
    const firm = firmsById.get(row.firm_id);
    const replyTo = row.reply_to_id ? replyTosById.get(`${row.reply_to_id}:${row.firm_id}`) : undefined;
    if (!firm) return null;

    let content: EmailContent;
    if (row.kind === "staff_added" || row.kind === "staff_digest") {
      if (!staffMembersById.has(`${row.recipient}:${row.firm_id}`)) return null;
      if (row.kind === "staff_added") {
        content = staffAddedEmail({ firmName: firm.name, adminName: replyTo?.full_name ?? "An admin" });
      } else {
        const window = groups.get(row.id);
        if (!window) return null;
        content = staffDigestEmail({ firmName: firm.name, groups: window });
      }
    } else {
      const request = row.request_id ? requestsById.get(row.request_id) : undefined;
      if (!request || request.status !== "open") return null;
      if (!request.clients?.client_contacts.some((contact) => contact.email === row.recipient)) return null;

      if (row.kind === "request_sent") {
        content = requestSentEmail({
          firmName: firm.name,
          title: request.title,
          dueDate: request.due_date,
          itemCount: request.request_items.length,
          requestId: row.request_id!,
          message: request.message,
        });
      } else if (row.kind === "needs_changes") {
        const item = request.request_items.find((candidate) => candidate.id === row.item_id);
        if (!item || item.status !== "needs_changes") return null;
        content = needsChangesEmail({
          firmName: firm.name,
          itemTitle: item.title,
          note: item.review_note ?? "",
          requestId: row.request_id!,
        });
      } else {
        if (request.clients.archived_at !== null) return null;
        const openItems = request.request_items.filter(
          (item) => item.status === "requested" || item.status === "needs_changes",
        );
        if (openItems.length === 0) return null;
        content = reminderEmail({
          firmName: firm.name,
          title: request.title,
          dueDate: request.due_date,
          overdue: isOverdue(request.due_date, todayIn(firm.time_zone, now)),
          openItems: openItems.map((item) => item.title),
          requestId: row.request_id!,
        });
      }
    }

    return { ...content, to: row.recipient, fromName: firm.name, ...(replyTo ? { replyTo: replyTo.email } : {}) };
  });
}

/**
 * Claims due rows oldest first, rebuilds and sends them, and records each
 * outcome, repeating until nothing is due (spec §5.2). A database error
 * throws: the run stops sending and the claimed rows keep their lease.
 */
export async function sendDueEmails(admin: Admin, now: Date): Promise<OutboxSummary> {
  const summary: OutboxSummary = { sent: 0, retrying: 0, gaveUp: 0, dropped: 0 };
  for (;;) {
    const { data: claimed, error } = await admin.rpc("claim_due_emails", { max_rows: 100 });
    if (error) throw error;
    if (!claimed?.length) break;

    const rendered = await renderQueued(admin, claimed, now);
    const dropIds = claimed.filter((_, index) => rendered[index] === null).map((row) => row.id);
    if (dropIds.length > 0) {
      const { error: dropError } = await admin.from("email_outbox").delete().in("id", dropIds);
      if (dropError) throw dropError;
      summary.dropped += dropIds.length;
    }

    const messages = claimed.flatMap((row, index) => (rendered[index] ? [{ message: rendered[index]!, row }] : []));
    if (messages.length === 0) continue;
    const { results } = await sendEmails(messages.map((entry) => entry.message));
    for (const [index, outcome] of results.entries()) {
      const { row } = messages[index];
      const { error: recordError } = outcome.ok
        ? await admin.rpc("record_email_result", { email_id: row.id })
        : await admin.rpc("record_email_result", { email_id: row.id, reason: outcome.reason, retry: outcome.retry });
      if (recordError) throw recordError;
      // record keeps a retryable row only while its claimed failure count is under the fourth.
      if (outcome.ok) summary.sent++;
      else if (outcome.retry && row.failures < 3) summary.retrying++;
      else summary.gaveUp++;
    }
  }
  return summary;
}
