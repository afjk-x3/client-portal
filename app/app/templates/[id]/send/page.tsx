import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/auth";
import { NIL_UUID, PAGE_SIZE, readAll } from "@/lib/supabase/read-all";
import { createClient } from "@/lib/supabase/server";
import { isId } from "@/lib/validation";
import { SendToClientsForm } from "./send-to-clients-form";

export default function SendTemplatePage({ params }: PageProps<"/app/templates/[id]/send">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <SendTemplate params={params} />
    </Suspense>
  );
}

async function SendTemplate({ params }: Pick<PageProps<"/app/templates/[id]/send">, "params">) {
  const { id } = await params;
  if (!isId(id)) notFound();
  const staff = await requireStaff();
  const supabase = await createClient();
  const [template, clients] = await Promise.all([
    supabase.from("templates").select("id, name").eq("id", id).eq("firm_id", staff.firmId).maybeSingle(),
    // Every active client with at least one contact to email; the inner join drops the rest.
    readAll((last?: { id: string }) =>
      supabase
        .from("clients")
        .select("id, name, client_contacts!inner(user_id)")
        .eq("firm_id", staff.firmId)
        .is("archived_at", null)
        .gt("id", last?.id ?? NIL_UUID)
        .order("id")
        .limit(PAGE_SIZE),
    ),
  ]);
  if (template.error) throw template.error;
  if (!template.data) notFound();
  clients.sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Send to clients</h1>
        <p className="text-sm text-muted-foreground">
          Each client you pick gets their own request from{" "}
          <Link className="underline-offset-4 hover:underline" href={`/app/templates/${template.data.id}`}>
            {template.data.name}
          </Link>
          , sent right away.
        </p>
      </div>
      {/* Keyed by template: Next keeps this page mounted, and picks for one template must not carry over. */}
      <SendToClientsForm
        key={template.data.id}
        templateId={template.data.id}
        defaultTitle={template.data.name}
        clients={clients.map((client) => ({
          id: client.id,
          name: client.name,
          contacts: client.client_contacts.length,
        }))}
      />
    </>
  );
}
