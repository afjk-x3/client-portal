import { Suspense } from "react";
import { Pager } from "@/components/pager";
import { Skeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/auth";
import { isOverdue, todayIn } from "@/lib/dates";
import { listHref, parseRequestFilters, REQUEST_STATUS_FILTERS } from "@/lib/list-params";
import { createClient } from "@/lib/supabase/server";
import { RequestFiltersForm } from "./request-filters";
import { RequestsTable } from "./requests-table";

export default function RequestsPage({ searchParams }: PageProps<"/app/requests">) {
  return (
    <>
      <h1 className="text-2xl font-semibold">Requests</h1>
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Requests searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Requests({ searchParams }: Pick<PageProps<"/app/requests">, "searchParams">) {
  const filters = parseRequestFilters(await searchParams);
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_requests", {
    q: filters.q,
    statuses: [...REQUEST_STATUS_FILTERS[filters.status]],
    overdue_only: filters.overdue,
    page: filters.page,
  });
  if (error) throw error;

  const today = todayIn(staff.timeZone);
  const href = (page: number) =>
    listHref("/app/requests", {
      q: filters.q,
      status: filters.status === "active" ? null : filters.status,
      overdue: filters.overdue,
      page: page === 1 ? null : page,
    });

  return (
    <>
      <RequestFiltersForm filters={filters} />
      <RequestsTable
        rows={data.map((request) => ({
          id: request.id,
          title: request.title,
          status: request.status,
          dueDate: request.due_date,
          clientId: request.client_id,
          clientName: request.client_name,
          openItems: request.open_items,
          overdue: request.status === "open" && isOverdue(request.due_date, today),
        }))}
      />
      <Pager page={filters.page} shown={data.length} total={data[0]?.total ?? 0} href={href} />
    </>
  );
}
