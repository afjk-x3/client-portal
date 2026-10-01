import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/auth";
import { formatDateTime, isOverdue, todayIn } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { DashboardTabs } from "./dashboard-tabs";

export default function DashboardPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Dashboard />
      </Suspense>
    </>
  );
}

async function Dashboard() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const [waiting, ready, unread] = await Promise.all([
    // Open requests with at least one open item; the inner join drops the rest.
    supabase
      .from("requests")
      .select("id, title, due_date, clients(name), request_items!inner(id)")
      .eq("firm_id", staff.firmId)
      .eq("status", "open")
      .in("request_items.status", ["requested", "needs_changes"])
      .order("due_date"),
    // Submitted items of open and completed requests; archived requests are closed.
    supabase
      .from("request_items")
      .select("id, title, submitted_at, unavailable_reason, request_id, requests!inner(title, clients(name))")
      .eq("firm_id", staff.firmId)
      .eq("status", "submitted")
      .neq("requests.status", "archived")
      .order("submitted_at"),
    // Unread client messages, newest first; the tab keeps one row per item.
    supabase
      .from("item_messages")
      .select("item_id, request_id, body, created_at, request_items!inner(title)")
      .eq("firm_id", staff.firmId)
      .eq("by_staff", false)
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }),
  ]);
  if (waiting.error) throw waiting.error;
  if (ready.error) throw ready.error;
  if (unread.error) throw unread.error;

  // Only open and completed requests take part; there is no request embed on
  // item_messages, so the requests come from one filtered query.
  const requestIds = [...new Set(unread.data.map((row) => row.request_id))];
  const requestsById = new Map<string, { title: string; client: string }>();
  if (requestIds.length > 0) {
    const { data, error } = await supabase
      .from("requests")
      .select("id, title, clients(name)")
      .in("id", requestIds)
      .in("status", ["open", "completed"]);
    if (error) throw error;
    for (const request of data) {
      requestsById.set(request.id, { title: request.title, client: request.clients?.name ?? "" });
    }
  }
  const seenItems = new Set<string>();
  const messages: {
    requestId: string;
    itemId: string;
    client: string;
    request: string;
    item: string;
    latest: string;
    at: string;
  }[] = [];
  for (const row of unread.data) {
    const request = requestsById.get(row.request_id);
    if (!request || seenItems.has(row.item_id)) continue;
    seenItems.add(row.item_id);
    messages.push({
      requestId: row.request_id,
      itemId: row.item_id,
      client: request.client,
      request: request.title,
      item: row.request_items.title,
      latest: row.body.slice(0, 100),
      at: formatDateTime(row.created_at, staff.timeZone),
    });
  }

  const today = todayIn(staff.timeZone);
  return (
    <DashboardTabs
      waiting={waiting.data.map((request) => ({
        requestId: request.id,
        client: request.clients?.name ?? "",
        title: request.title,
        dueDate: request.due_date,
        openItems: request.request_items.length,
        overdue: isOverdue(request.due_date, today),
      }))}
      ready={ready.data.map((item) => ({
        requestId: item.request_id,
        client: item.requests.clients?.name ?? "",
        request: item.requests.title,
        item: item.title,
        unavailable: item.unavailable_reason !== null,
        submitted: item.submitted_at ? formatDateTime(item.submitted_at, staff.timeZone) : "",
      }))}
      messages={messages}
    />
  );
}
