"use client";

import { useActionState, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { ActionButton } from "@/components/action-button";
import { ItemThread, type ThreadMessage } from "@/components/item-thread";
import { ItemStatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { LIMITS } from "@/lib/constants";
import { ACCEPT_ATTRIBUTE } from "@/lib/files";
import type { ActionResult } from "@/lib/errors";
import { submitKeepingValues } from "@/lib/forms";
import { removeFile } from "@/app/portal/requests/[id]/actions";
import { rejection, uploadFile } from "@/app/portal/requests/[id]/upload";
import { acceptItem, markItemMessagesRead, postStaffMessage, removeItem, returnItem } from "../actions";

const subscribe = () => () => {};
const locationHash = () => window.location.hash;

export type ReviewItem = {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  required: boolean;
  status: string;
  textAnswer: string | null;
  reviewNote: string | null;
  unavailableReason: string | null;
  /** Formatted on the server in the firm's time zone. */
  submitted: string | null;
  /** The conversation, oldest first; author is the display name the thread shows. */
  messages: ThreadMessage[];
  /** byStaff: added by the firm; staff can remove only these. */
  files: { id: string; filename: string; sizeBytes: number; byStaff: boolean }[];
};

/** `editable`: the request is open or completed. `open`: it is open, so staff can add files. */
export function ReviewItems({ items, editable, open }: { items: ReviewItem[]; editable: boolean; open: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  // Next keeps visited pages mounted but hidden; close so Back and Forward never return to an open Sheet.
  useLayoutEffect(() => () => setOpenId(null), []);
  // A dashboard link with #item-{id} opens that item's Sheet on arrival; rows open the rest.
  const hashId = useSyncExternalStore(subscribe, locationHash, () => "");
  const hashItem = /^#item-(.+)$/.exec(hashId)?.[1] ?? null;
  const selected = items.find((item) => item.id === (openId ?? hashItem));
  const close = () => {
    setOpenId(null);
    // Drop the anchor too, so a closed Sheet cannot reopen from it.
    if (window.location.hash) history.replaceState(null, "", window.location.pathname + window.location.search);
  };

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Files</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, index) => (
              <TableRow key={item.id} id={`item-${item.id}`} className="cursor-pointer" onClick={() => setOpenId(item.id)}>
                <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                <TableCell>
                  <button type="button" className="text-left font-medium underline-offset-4 hover:underline">
                    {item.title}
                  </button>
                  {!item.required && <span className="ml-2 text-xs text-muted-foreground">Optional</span>}
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <ItemStatusBadge status={item.status} />
                    {item.unavailableReason && <Badge variant="secondary">Not available</Badge>}
                  </span>
                </TableCell>
                <TableCell className="text-right">{item.kind === "file" ? item.files.length : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Sheet open={selected !== undefined} onOpenChange={(next) => !next && close()}>
        <SheetContent className="overflow-y-auto">
          {selected && <ItemDetails item={selected} editable={editable} open={open} onRemoved={close} />}
        </SheetContent>
      </Sheet>
    </>
  );
}

function ItemDetails({
  item,
  editable,
  open,
  onRemoved,
}: {
  item: ReviewItem;
  editable: boolean;
  open: boolean;
  onRemoved: () => void;
}) {
  const canAccept = editable && item.status !== "accepted";
  // Staff add files for documents the client sent another way, until the item is accepted.
  const canAddFiles = open && item.kind === "file" && item.status !== "accepted";
  const canReturn = editable && (item.status === "submitted" || item.status === "accepted");
  const canRemove = editable && item.status === "requested" && item.files.length === 0;

  return (
    <div className="flex flex-col gap-6 p-4">
      <SheetHeader className="p-0">
        <SheetTitle>{item.title}</SheetTitle>
        <SheetDescription>
          {item.required ? "Required" : "Optional"} · {item.kind === "file" ? "File upload" : "Written answer"}
        </SheetDescription>
      </SheetHeader>
      <div className="flex items-center gap-2">
        <ItemStatusBadge status={item.status} />
        {item.submitted && (
          <span className="text-sm text-muted-foreground">Submitted {item.submitted}</span>
        )}
      </div>
      {item.description && <p className="whitespace-pre-wrap text-sm">{item.description}</p>}
      {item.kind === "text" && (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">Answer</h3>
          <p className="whitespace-pre-wrap text-sm">{item.textAnswer ?? "No answer yet."}</p>
        </div>
      )}
      {item.kind === "file" && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Files</h3>
          {item.files.length === 0 &&
            (item.unavailableReason ? (
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">The client says they don&apos;t have this</p>
                <p className="whitespace-pre-wrap text-sm">{item.unavailableReason}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No files yet.</p>
            ))}
          {item.files.map((file) => (
            <div key={file.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">
                {file.filename}
                {file.byStaff && <span className="text-muted-foreground"> · Added by staff</span>}
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <a className="underline" href={`/api/files/${file.id}`} target="_blank" rel="noopener noreferrer">
                  Open
                </a>
                <a className="underline" href={`/api/files/${file.id}?download=1`}>
                  Download
                </a>
                {canAddFiles && file.byStaff && (
                  <ActionButton
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${file.filename}`}
                    action={() => removeFile(file.id)}
                    success="File removed."
                  >
                    Remove
                  </ActionButton>
                )}
              </span>
            </div>
          ))}
          {canAddFiles && <AddFiles itemId={item.id} />}
        </div>
      )}
      {item.reviewNote && (
        <Alert>
          <AlertTitle>Review note</AlertTitle>
          <AlertDescription className="whitespace-pre-wrap">{item.reviewNote}</AlertDescription>
        </Alert>
      )}
      {(editable || item.messages.length > 0) && (
        <div className="flex flex-col gap-3 border-t pt-4">
          <h3 className="text-sm font-medium">Messages</h3>
          <ItemThread
            messages={item.messages}
            canWrite={editable}
            label="Write to the client"
            hint="The client's contacts get this by email."
            send={(body) => postStaffMessage(item.id, body)}
          />
          {item.messages.some((message) => message.isNew) && (
            <ActionButton
              variant="outline"
              size="sm"
              className="self-start"
              action={() => markItemMessagesRead(item.id)}
              success="Marked as read."
            >
              Mark as read
            </ActionButton>
          )}
        </div>
      )}
      <div className="flex flex-col gap-4 border-t pt-4">
        {canAccept && (
          <ActionButton action={() => acceptItem(item.id)} success="Item accepted.">
            Accept
          </ActionButton>
        )}
        {canReturn && <NeedsChangesForm itemId={item.id} />}
        {canRemove && (
          <ActionButton
            variant="ghost"
            action={async () => {
              const result = await removeItem(item.id);
              if (result.ok) onRemoved();
              return result;
            }}
            success="Item removed."
          >
            Remove item
          </ActionButton>
        )}
      </div>
    </div>
  );
}

/** Uploads files for the client, one at a time; the page refreshes as each is registered. */
function AddFiles({ itemId }: { itemId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function add(files: File[]) {
    setBusy(true);
    for (const file of files) {
      const error = rejection(file) ?? (await uploadFile(itemId, file));
      if (error) toast.error(error);
      else toast.success(`${file.name} added.`);
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        className="hidden"
        aria-label="Add files"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length > 0) void add(files);
        }}
      />
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
        <Upload />
        {busy ? "Uploading…" : "Add files"}
      </Button>
      <p className="text-xs text-muted-foreground">For documents the client sent another way. The client sees them too.</p>
    </div>
  );
}

function NeedsChangesForm({ itemId }: { itemId: string }) {
  const id = useId();
  const [, formAction, pending] = useActionState(async (prev: ActionResult | null, formData: FormData) => {
    const result = await returnItem(itemId, prev, formData);
    if (result.ok) toast.success("Returned to the client with your note.");
    else toast.error(result.error);
    return result;
  }, null);

  return (
    <form onSubmit={submitKeepingValues(formAction)} className="flex flex-col gap-2">
      <Label htmlFor={`${id}-note`}>What needs to change?</Label>
      <Textarea id={`${id}-note`} name="note" maxLength={LIMITS.reviewNote} rows={3} required />
      <Button type="submit" variant="outline" disabled={pending}>
        Needs changes
      </Button>
    </form>
  );
}
