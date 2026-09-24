import { Suspense } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addClient } from "./actions";
import { ClientFormDialog } from "./client-form-dialog";
import { ClientsTable } from "./clients-table";

export default function ClientsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <Clients />
    </Suspense>
  );
}

async function Clients() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const [clients, members] = await Promise.all([
    supabase.from("clients").select("id, name, kind, owner_id, archived_at").eq("firm_id", staff.firmId).order("name"),
    supabase.from("firm_members").select("user_id, full_name").eq("firm_id", staff.firmId).order("full_name"),
  ]);
  if (clients.error) throw clients.error;
  if (members.error) throw members.error;

  const memberList = members.data.map((m) => ({ userId: m.user_id, fullName: m.full_name }));
  const ownerName = new Map(memberList.map((m) => [m.userId, m.fullName]));

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
      <ClientsTable
        clients={clients.data.map((c) => ({
          id: c.id,
          name: c.name,
          kind: c.kind,
          owner: (c.owner_id && ownerName.get(c.owner_id)) || "",
          archived: c.archived_at !== null,
        }))}
      />
    </>
  );
}
