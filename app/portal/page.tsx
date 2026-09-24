import { Suspense } from "react";
import Link from "next/link";
import { RequestStatusBadge } from "@/components/status-badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { getContactClientIds } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { progressPercent } from "./progress";

export default function PortalPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Your requests</h1>
      <Suspense fallback={<Skeleton className="h-48" />}>
        <Requests />
      </Suspense>
    </>
  );
}

type Row = { id: string; title: string; status: string; dueDate: string; progress: number };

async function Requests() {
  const clientIds = await getContactClientIds();
  if (clientIds.length === 0) {
    return <p className="text-sm text-muted-foreground">You don&apos;t have any requests yet.</p>;
  }

  const supabase = await createClient();
  const { data: requests, error } = await supabase
    .from("requests")
    .select("id, title, status, due_date, firm_id, clients(firms(name)), request_items(required, status)")
    .in("client_id", clientIds)
    .neq("status", "draft")
    .order("due_date");
  if (error) throw error;

  const firms = new Map<string, { name: string; open: Row[]; past: Row[] }>();
  for (const request of requests) {
    const firm = firms.get(request.firm_id) ?? { name: request.clients?.firms?.name ?? "", open: [], past: [] };
    const row = {
      id: request.id,
      title: request.title,
      status: request.status,
      dueDate: request.due_date,
      progress: progressPercent(request.request_items),
    };
    (request.status === "open" ? firm.open : firm.past).push(row);
    firms.set(request.firm_id, firm);
  }
  const grouped = firms.size > 1;

  return [...firms.entries()].map(([firmId, firm]) => (
    <section key={firmId} className="flex flex-col gap-4">
      {grouped && <h2 className="text-lg font-semibold">{firm.name}</h2>}
      <RequestList title="Open requests" rows={firm.open} showProgress empty="Nothing to do right now." />
      {firm.past.length > 0 && <RequestList title="Past requests" rows={firm.past} />}
    </section>
  ));
}

function RequestList({
  title,
  rows,
  showProgress = false,
  empty,
}: {
  title: string;
  rows: Row[];
  showProgress?: boolean;
  empty?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      {rows.length === 0 && empty && <p className="text-sm text-muted-foreground">{empty}</p>}
      {rows.map((row) => (
        <Link key={row.id} href={`/portal/requests/${row.id}`}>
          <Card className="transition-colors hover:bg-muted/50">
            <CardHeader>
              <CardTitle>{row.title}</CardTitle>
              <CardDescription>Due {formatDate(row.dueDate)}</CardDescription>
              <CardAction>
                <RequestStatusBadge status={row.status} />
              </CardAction>
            </CardHeader>
            {showProgress && (
              <CardContent className="flex items-center gap-3">
                <Progress value={row.progress} aria-label="Progress" />
                <span className="text-sm text-muted-foreground">{row.progress}%</span>
              </CardContent>
            )}
          </Card>
        </Link>
      ))}
    </div>
  );
}
