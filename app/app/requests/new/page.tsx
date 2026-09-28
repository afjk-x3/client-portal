import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { newEditorItem } from "@/lib/editor-items";
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
  const { client: clientId, from } = await searchParams;
  if (!isId(clientId)) notFound();

  const staff = await requireStaff();
  const supabase = await createClient();
  // A sent request of this client to copy; anything else falls back to the blank editor.
  const sourceQuery = isId(from)
    ? supabase
        .from("requests")
        .select("id, title, request_items(title, description, kind, required, position)")
        .eq("id", from)
        .eq("firm_id", staff.firmId)
        .eq("client_id", clientId)
        .neq("status", "draft")
        .order("position", { referencedTable: "request_items" })
        .order("id", { referencedTable: "request_items" })
        .maybeSingle()
    : Promise.resolve({ data: null, error: null });
  const [clientResult, templates, sourceResult] = await Promise.all([
    supabase.from("clients").select("id, name").eq("id", clientId).eq("firm_id", staff.firmId).maybeSingle(),
    supabase
      .from("templates")
      .select("id, name, template_items(title, description, kind, required, position)")
      .eq("firm_id", staff.firmId)
      .order("name")
      .order("position", { referencedTable: "template_items" })
      .order("id", { referencedTable: "template_items" }),
    sourceQuery,
  ]);
  if (clientResult.error) throw clientResult.error;
  if (templates.error) throw templates.error;
  if (sourceResult.error) throw sourceResult.error;
  const client = clientResult.data;
  if (!client) notFound();
  const source = sourceResult.data;

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
        {source && <p className="text-sm text-muted-foreground">Copy of “{source.title}”</p>}
      </div>
      {/* Keyed by client and source: Next keeps this page mounted without its search params, so an
          unsaved request for one client must not carry over, nor a copy into a blank request. */}
      <RequestEditor
        key={`${client.id}:${source?.id ?? ""}`}
        clientId={client.id}
        initial={
          source
            ? { title: source.title, dueDate: null, items: source.request_items.map(newEditorItem), message: "" }
            : { title: "", dueDate: null, items: [], message: "" }
        }
        templates={templates.data.map((t) => ({ id: t.id, name: t.name, items: t.template_items }))}
      />
    </>
  );
}
