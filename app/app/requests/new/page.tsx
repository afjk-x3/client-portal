import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isId } from "@/lib/validation";
import { RequestEditor } from "../request-editor";

export default function NewRequestPage({ searchParams }: PageProps<"/app/requests/new">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <NewRequest searchParams={searchParams} />
    </Suspense>
  );
}

async function NewRequest({ searchParams }: Pick<PageProps<"/app/requests/new">, "searchParams">) {
  const { client: clientId } = await searchParams;
  if (!isId(clientId)) notFound();

  const staff = await requireStaff();
  const supabase = await createClient();
  const [clientResult, templates] = await Promise.all([
    supabase.from("clients").select("id, name").eq("id", clientId).eq("firm_id", staff.firmId).maybeSingle(),
    supabase
      .from("templates")
      .select("id, name, template_items(title, description, kind, required, position)")
      .eq("firm_id", staff.firmId)
      .order("name")
      .order("position", { referencedTable: "template_items" })
      .order("id", { referencedTable: "template_items" }),
  ]);
  if (clientResult.error) throw clientResult.error;
  if (templates.error) throw templates.error;
  const client = clientResult.data;
  if (!client) notFound();

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">New request</h1>
        <p className="text-sm text-muted-foreground">
          For{" "}
          <Link className="underline-offset-4 hover:underline" href={`/app/clients/${client.id}`}>
            {client.name}
          </Link>
        </p>
      </div>
      {/* Keyed by client: Next keeps this page mounted without its search params, so an
          unsaved request for one client must not carry over to another. */}
      <RequestEditor
        key={client.id}
        clientId={client.id}
        initial={{ title: "", dueDate: null, items: [] }}
        templates={templates.data.map((t) => ({ id: t.id, name: t.name, items: t.template_items }))}
      />
    </>
  );
}
