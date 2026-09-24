import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/auth";
import { isOverdue, todayUtc } from "@/lib/dates";
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
  const [waiting, ready] = await Promise.all([
    // Open requests with at least one open item; the inner join drops the rest.
    supabase
      .from("requests")
      .select("id, title, due_date, clients(name), request_items!inner(id)")
      .eq("firm_id", staff.firmId)
      .eq("status", "open")
      .in("request_items.status", ["requested", "needs_changes"])
      .order("due_date"),
    supabase
      .from("request_items")
      .select("id, title, submitted_at, request_id, requests(title, clients(name))")
      .eq("firm_id", staff.firmId)
      .eq("status", "submitted")
      .order("submitted_at"),
  ]);
  if (waiting.error) throw waiting.error;
  if (ready.error) throw ready.error;

  const today = todayUtc();
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
        client: item.requests?.clients?.name ?? "",
        request: item.requests?.title ?? "",
        item: item.title,
        submittedAt: item.submitted_at ?? "",
      }))}
    />
  );
}
