"use client";

import { useActionState, useId, useLayoutEffect, useState } from "react";
import { toast } from "sonner";
import { ActionButton } from "@/components/action-button";
import { ItemStatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { LIMITS } from "@/lib/constants";
import { formatDateTime } from "@/lib/dates";
import type { ActionResult } from "@/lib/errors";
import { submitKeepingValues } from "@/lib/forms";
import { acceptItem, removeItem, returnItem } from "../actions";

export type ReviewItem = {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  required: boolean;
  status: string;
  textAnswer: string | null;
  reviewNote: string | null;
  submittedAt: string | null;
  files: { id: string; filename: string; sizeBytes: number }[];
};

export function ReviewItems({ items, editable }: { items: ReviewItem[]; editable: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  // Next keeps visited pages mounted but hidden; close so Back and Forward never return to an open Sheet.
  useLayoutEffect(() => () => setOpenId(null), []);
  const selected = items.find((item) => item.id === openId);

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
              <TableRow key={item.id} className="cursor-pointer" onClick={() => setOpenId(item.id)}>
                <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                <TableCell>
                  <button type="button" className="text-left font-medium underline-offset-4 hover:underline">
                    {item.title}
                  </button>
                  {!item.required && <span className="ml-2 text-xs text-muted-foreground">Optional</span>}
                </TableCell>
                <TableCell>
                  <ItemStatusBadge status={item.status} />
                </TableCell>
                <TableCell className="text-right">{item.kind === "file" ? item.files.length : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Sheet open={selected !== undefined} onOpenChange={(open) => !open && setOpenId(null)}>
        <SheetContent className="overflow-y-auto">
          {selected && <ItemDetails item={selected} editable={editable} onRemoved={() => setOpenId(null)} />}
        </SheetContent>
      </Sheet>
    </>
  );
}

function ItemDetails({ item, editable, onRemoved }: { item: ReviewItem; editable: boolean; onRemoved: () => void }) {
  const canAccept = editable && item.status !== "accepted";
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
        {item.submittedAt && (
          <span className="text-sm text-muted-foreground">Submitted {formatDateTime(item.submittedAt)}</span>
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
          {item.files.length === 0 && <p className="text-sm text-muted-foreground">No files yet.</p>}
          {item.files.map((file) => (
            <div key={file.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{file.filename}</span>
              <span className="flex shrink-0 gap-3">
                <a className="underline" href={`/api/files/${file.id}`} target="_blank" rel="noopener noreferrer">
                  Open
                </a>
                <a className="underline" href={`/api/files/${file.id}?download=1`}>
                  Download
                </a>
              </span>
            </div>
          ))}
        </div>
      )}
      {item.reviewNote && (
        <Alert>
          <AlertTitle>Review note</AlertTitle>
          <AlertDescription className="whitespace-pre-wrap">{item.reviewNote}</AlertDescription>
        </Alert>
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
