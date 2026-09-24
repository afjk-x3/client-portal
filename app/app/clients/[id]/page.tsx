import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { ActionButton } from "@/components/action-button";
import { RequestStatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { requireStaff } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { ClientFormDialog } from "../client-form-dialog";
import { setClientArchived, updateClient } from "./actions";
import { Contacts } from "./contacts";

export default function ClientPage({ params }: PageProps<"/app/clients/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Client params={params} />
    </Suspense>
  );
}

async function Client({ params }: Pick<PageProps<"/app/clients/[id]">, "params">) {
  const { id } = await params;
  const staff = await requireStaff();
  const supabase = await createClient();
  const [{ data: client }, contacts, requests, members] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, kind, owner_id, archived_at")
      .eq("id", id)
      .eq("firm_id", staff.firmId)
      .maybeSingle(),
    supabase
      .from("client_contacts")
      .select("user_id, full_name, email")
      .eq("client_id", id)
      .eq("firm_id", staff.firmId)
      .order("full_name"),
    supabase
      .from("requests")
      .select("id, title, status, due_date")
      .eq("client_id", id)
      .eq("firm_id", staff.firmId)
      .order("created_at", { ascending: false }),
    supabase.from("firm_members").select("user_id, full_name").eq("firm_id", staff.firmId).order("full_name"),
  ]);
  if (!client) notFound();

  const memberList = (members.data ?? []).map((m) => ({ userId: m.user_id, fullName: m.full_name }));
  const owner = memberList.find((m) => m.userId === client.owner_id);
  const archived = client.archived_at !== null;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            {client.name}
            {archived && <Badge variant="outline">Archived</Badge>}
          </h1>
          <p className="text-sm text-muted-foreground">
            {client.kind === "business" ? "Business" : "Individual"}
            {owner && ` · Owner: ${owner.fullName}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ClientFormDialog
            title="Edit client"
            members={memberList}
            initial={{ name: client.name, kind: client.kind, ownerId: client.owner_id }}
            action={updateClient.bind(null, id)}
            trigger={<Button variant="outline">Edit</Button>}
          />
          <ActionButton
            variant="outline"
            action={setClientArchived.bind(null, id, !archived)}
            success={archived ? "Client unarchived." : "Client archived."}
          >
            {archived ? "Unarchive" : "Archive"}
          </ActionButton>
          <Button asChild>
            <Link href={`/app/requests/new?client=${id}`}>
              <Plus />
              New request
            </Link>
          </Button>
        </div>
      </div>

      <Contacts
        clientId={id}
        contacts={(contacts.data ?? []).map((c) => ({ userId: c.user_id, fullName: c.full_name, email: c.email }))}
      />

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Requests</h2>
        {(requests.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No requests yet.</p>
        ) : (
          <Table>
            <TableBody>
              {(requests.data ?? []).map((request) => (
                <TableRow key={request.id}>
                  <TableCell>
                    <Link className="font-medium underline-offset-4 hover:underline" href={`/app/requests/${request.id}`}>
                      {request.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <RequestStatusBadge status={request.status} />
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    Due {formatDate(request.due_date)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
