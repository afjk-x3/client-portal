import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RequestStatusBadge } from "@/components/status-badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { getContactClientIds } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { isId } from "@/lib/validation";
import { progressPercent } from "../../progress";
import { ItemCard } from "./item-card";

export default function PortalRequestPage({ params }: PageProps<"/portal/requests/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <PortalRequest params={params} />
    </Suspense>
  );
}

async function PortalRequest({ params }: Pick<PageProps<"/portal/requests/[id]">, "params">) {
  const { id } = await params;
  if (!isId(id)) notFound();
  const clientIds = await getContactClientIds();
  const supabase = await createClient();
  const { data: request, error } = await supabase
    .from("requests")
    .select(
      `id, title, status, due_date, clients(firms(name)),
       request_items(id, position, title, description, kind, required, status, text_answer, review_note,
         item_files(id, filename, size_bytes, created_at, by_staff))`,
    )
    .eq("id", id)
    .in("client_id", clientIds)
    .neq("status", "draft")
    .order("position", { referencedTable: "request_items" })
    .order("id", { referencedTable: "request_items" })
    .order("created_at", { referencedTable: "request_items.item_files" })
    .maybeSingle();
  if (error) throw error;
  if (!request) notFound();

  const progress = progressPercent(request.request_items);
  const open = request.status === "open";

  return (
    <>
      <div className="flex flex-col gap-2">
        <Link href="/portal" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← All requests
        </Link>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
          {request.title} <RequestStatusBadge status={request.status} />
        </h1>
        <p className="text-sm text-muted-foreground">
          From {request.clients?.firms?.name} · Due {formatDate(request.due_date)}
        </p>
        <div className="flex items-center gap-3">
          <Progress value={progress} aria-label="Progress" />
          <span className="text-sm text-muted-foreground">{progress}%</span>
        </div>
        {!open && <p className="text-sm text-muted-foreground">This request is closed. You can still view and download your files.</p>}
      </div>
      {request.request_items.map((item) => (
        <ItemCard
          key={item.id}
          requestOpen={open}
          firmName={request.clients?.firms?.name ?? "your firm"}
          item={{
            id: item.id,
            title: item.title,
            description: item.description,
            kind: item.kind,
            required: item.required,
            status: item.status,
            textAnswer: item.text_answer,
            reviewNote: item.review_note,
            files: item.item_files.map((f) => ({
              id: f.id,
              filename: f.filename,
              sizeBytes: f.size_bytes,
              byStaff: f.by_staff,
            })),
          }}
        />
      ))}
    </>
  );
}
