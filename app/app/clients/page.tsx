import { Suspense } from "react";
import { Plus } from "lucide-react";
import { Pager } from "@/components/pager";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/auth";
import { listHref, parseClientFilters } from "@/lib/list-params";
import { createClient } from "@/lib/supabase/server";
import { addClient } from "./actions";
import { ClientFiltersForm } from "./client-filters";
import { ClientFormDialog } from "./client-form-dialog";
import { ClientsTable } from "./clients-table";

export default function ClientsPage({ searchParams }: PageProps<"/app/clients">) {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <Clients searchParams={searchParams} />
    </Suspense>
  );
}

async function Clients({ searchParams }: Pick<PageProps<"/app/clients">, "searchParams">) {
  const filters = parseClientFilters(await searchParams);
  const staff = await requireStaff();
  const supabase = await createClient();
  const [clients, members] = await Promise.all([
    supabase.rpc("list_clients", {
      q: filters.q,
      owner: filters.owner ?? undefined,
      kind: filters.kind ?? undefined,
      include_archived: filters.archived,
      page: filters.page,
    }),
    supabase.from("firm_members").select("user_id, full_name").eq("firm_id", staff.firmId).order("full_name"),
  ]);
  if (clients.error) throw clients.error;
  if (members.error) throw members.error;

  const memberList = members.data.map((m) => ({ userId: m.user_id, fullName: m.full_name }));
  const ownerName = new Map(memberList.map((m) => [m.userId, m.fullName]));
  const href = (page: number) =>
    listHref("/app/clients", {
      q: filters.q,
      owner: filters.owner,
      kind: filters.kind,
      archived: filters.archived,
      page: page === 1 ? null : page,
    });

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Clients</h1>
        <ClientFormDialog
          title="New client"
          members={memberList}
          action={addClient}
          openAfterSave
          trigger={
            <Button>
              <Plus />
              New client
            </Button>
          }
        />
      </div>
      <ClientFiltersForm filters={filters} members={memberList} />
      <ClientsTable
        clients={clients.data.map((c) => ({
          id: c.id,
          name: c.name,
          kind: c.kind,
          owner: (c.owner_id && ownerName.get(c.owner_id)) || "",
          archived: c.archived,
        }))}
      />
      <Pager page={filters.page} shown={clients.data.length} total={clients.data[0]?.total ?? 0} href={href} />
    </>
  );
}
