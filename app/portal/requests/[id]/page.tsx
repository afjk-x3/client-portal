import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RequestStatusBadge } from "@/components/status-badge";
import type { ThreadMessage } from "@/components/item-thread";
import { Card, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { getContactClientIds, getUser } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/dates";
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
      `id, title, status, due_date, message, clients(firms(name, time_zone)),
       request_items(id, position, title, description, kind, required, status, text_answer, review_note,
         unavailable_reason, item_files(id, filename, size_bytes, created_at, by_staff))`,
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

  const { data: messages, error: messagesError } = await supabase
    .from("item_messages")
    .select("id, item_id, author_id, author_name, by_staff, body, created_at")
    .eq("request_id", request.id)
    .order("created_at")
    .order("id");
  if (messagesError) throw messagesError;

  const progress = progressPercent(request.request_items);
  const open = request.status === "open";
  const canWrite = open || request.status === "completed";
  const firmName = request.clients?.firms?.name ?? "your firm";
  const timeZone = request.clients?.firms?.time_zone ?? "UTC";
  const viewerId = (await getUser())?.id ?? null;
  const messagesByItem = new Map<string, ThreadMessage[]>();
  for (const message of messages ?? []) {
    const thread: ThreadMessage[] = messagesByItem.get(message.item_id) ?? [];
    thread.push({
      id: message.id,
      author: message.author_id === viewerId ? "You" : message.by_staff ? firmName : message.author_name,
      body: message.body,
      at: formatDateTime(message.created_at, timeZone),
    });
    messagesByItem.set(message.item_id, thread);
  }

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
        {request.message && (
          <Card className="gap-2 py-4">
            <CardTitle className="px-4 text-base">Message from {request.clients?.firms?.name}</CardTitle>
            <p className="whitespace-pre-wrap px-4 text-sm">{request.message}</p>
          </Card>
        )}
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
          canWrite={canWrite}
          firmName={firmName}
          messages={messagesByItem.get(item.id) ?? []}
          item={{
            id: item.id,
            title: item.title,
            description: item.description,
            kind: item.kind,
            required: item.required,
            status: item.status,
            textAnswer: item.text_answer,
            reviewNote: item.review_note,
            unavailableReason: item.unavailable_reason,
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
