import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RequestStatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { actorName, describeEvent, itemLabel } from "@/lib/activity";
import { requireStaff } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/dates";
import { newEditorItem } from "@/lib/editor-items";
import { createClient } from "@/lib/supabase/server";
import { isId } from "@/lib/validation";
import { RequestEditor } from "../request-editor";
import { Activity } from "./activity";
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
      `id, title, status, due_date, sent_at, client_id, clients(name, archived_at),
       request_items(id, position, title, description, kind, required, status, text_answer, review_note, submitted_at,
         item_files(id, filename, size_bytes, created_at, by_staff))`,
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

  const [events, members, contacts] = await Promise.all([
    supabase
      .from("request_events")
      .select("id, kind, item_id, actor_id, detail, created_at")
      .eq("request_id", request.id)
      .order("id", { ascending: false }),
    supabase.from("firm_members").select("user_id, full_name").eq("firm_id", staff.firmId),
    supabase.from("client_contacts").select("user_id, full_name").eq("client_id", request.client_id),
  ]);
  if (events.error) throw events.error;
  if (members.error) throw members.error;
  if (contacts.error) throw contacts.error;
  // Staff names win for a user who is also this client's contact.
  const names = new Map([
    ...contacts.data.map((contact) => [contact.user_id, contact.full_name] as const),
    ...members.data.map((member) => [member.user_id, member.full_name] as const),
  ]);
  const titles = new Map(request.request_items.map((item) => [item.id, item.title]));
  const activity = events.data.map((event) => {
    const detail = (event.detail ?? {}) as Record<string, unknown>;
    return {
      id: event.id,
      actor: actorName(event.actor_id, names),
      text: describeEvent(event.kind, detail, itemLabel(event.item_id, detail, titles)),
      at: formatDateTime(event.created_at, staff.timeZone),
    };
  });

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            {request.title} <RequestStatusBadge status={request.status} />
          </h1>
          <p className="text-sm text-muted-foreground">
            For {clientLink} · Due {formatDate(request.due_date)}
            {request.sent_at && ` · Sent ${formatDateTime(request.sent_at, staff.timeZone)}`}
          </p>
        </div>
        <RequestActions
          requestId={request.id}
          title={request.title}
          dueDate={request.due_date}
          status={request.status}
          canRemind={
            request.status === "open" &&
            !request.clients?.archived_at &&
            request.request_items.some((item) => item.status === "requested" || item.status === "needs_changes")
          }
        />
      </div>
      <ReviewItems
        editable={request.status === "open" || request.status === "completed"}
        open={request.status === "open"}
        items={request.request_items.map((item) => ({
          id: item.id,
          title: item.title,
          description: item.description,
          kind: item.kind,
          required: item.required,
          status: item.status,
          textAnswer: item.text_answer,
          reviewNote: item.review_note,
          submitted: item.submitted_at ? formatDateTime(item.submitted_at, staff.timeZone) : null,
          files: item.item_files.map((file) => ({
            id: file.id,
            filename: file.filename,
            sizeBytes: file.size_bytes,
            byStaff: file.by_staff,
          })),
        }))}
      />
      <Activity events={activity} />
    </>
  );
}
