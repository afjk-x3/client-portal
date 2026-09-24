import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RequestStatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/dates";
import { newEditorItem } from "@/lib/editor-items";
import { createClient } from "@/lib/supabase/server";
import { isId } from "@/lib/validation";
import { RequestEditor } from "../request-editor";
import { RequestActions } from "./request-actions";
import { ReviewItems } from "./review-items";

export default function RequestPage({ params }: PageProps<"/app/requests/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Request params={params} />
    </Suspense>
  );
}

async function Request({ params }: Pick<PageProps<"/app/requests/[id]">, "params">) {
  const { id } = await params;
  if (!isId(id)) notFound();
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data: request, error } = await supabase
    .from("requests")
    .select(
      `id, title, status, due_date, sent_at, client_id, clients(name),
       request_items(id, position, title, description, kind, required, status, text_answer, review_note, submitted_at,
         item_files(id, filename, size_bytes, created_at))`,
    )
    .eq("id", id)
    .eq("firm_id", staff.firmId)
    .order("position", { referencedTable: "request_items" })
    .order("id", { referencedTable: "request_items" })
    .order("created_at", { referencedTable: "request_items.item_files" })
    .maybeSingle();
  if (error) throw error;
  if (!request) notFound();

  const clientLink = (
    <Link className="underline-offset-4 hover:underline" href={`/app/clients/${request.client_id}`}>
      {request.clients?.name}
    </Link>
  );

  if (request.status === "draft") {
    return (
      <>
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            Draft request <RequestStatusBadge status="draft" />
          </h1>
          <p className="text-sm text-muted-foreground">For {clientLink}</p>
        </div>
        <RequestEditor
          clientId={request.client_id}
          requestId={request.id}
          initial={{
            title: request.title,
            dueDate: request.due_date,
            items: request.request_items.map((item) => newEditorItem(item)),
          }}
        />
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            {request.title} <RequestStatusBadge status={request.status} />
          </h1>
          <p className="text-sm text-muted-foreground">
            For {clientLink} · Due {formatDate(request.due_date)}
            {request.sent_at && ` · Sent ${formatDateTime(request.sent_at)}`}
          </p>
        </div>
        <RequestActions
          requestId={request.id}
          title={request.title}
          dueDate={request.due_date}
          status={request.status}
        />
      </div>
      <ReviewItems
        editable={request.status === "open" || request.status === "completed"}
        items={request.request_items.map((item) => ({
          id: item.id,
          title: item.title,
          description: item.description,
          kind: item.kind,
          required: item.required,
          status: item.status,
          textAnswer: item.text_answer,
          reviewNote: item.review_note,
          submittedAt: item.submitted_at,
          files: item.item_files.map((file) => ({ id: file.id, filename: file.filename, sizeBytes: file.size_bytes })),
        }))}
      />
    </>
  );
}
