"use client";

import { useActionState, useId, useLayoutEffect, useState } from "react";
import { BellRing, Download, Plus } from "lucide-react";
import { toast } from "sonner";
import { ActionButton } from "@/components/action-button";
import { DatePicker } from "@/components/date-picker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { LIMITS } from "@/lib/constants";
import type { ActionResult } from "@/lib/errors";
import { submitKeepingValues } from "@/lib/forms";
import { addItem, sendReminder, setRequestArchived, updateRequestDetails } from "../actions";

/** Header actions for a sent request. */
export function RequestActions({
  requestId,
  title,
  dueDate,
  status,
  canRemind,
}: {
  requestId: string;
  title: string;
  dueDate: string;
  status: string;
  /** Open, for an active client, with an item still to do. */
  canRemind: boolean;
}) {
  const archived = status === "archived";

  return (
    <div className="flex flex-wrap gap-2">
      {!archived && <EditDetailsDialog requestId={requestId} title={title} dueDate={dueDate} />}
      {!archived && <AddItemDialog requestId={requestId} />}
      {canRemind && (
        <ActionButton variant="outline" action={() => sendReminder(requestId)} success="Reminder sent.">
          <BellRing />
          Send reminder
        </ActionButton>
      )}
      <Button variant="outline" asChild>
        <a href={`/api/requests/${requestId}/zip`} download>
          <Download />
          Download all (.zip)
        </a>
      </Button>
      <ActionButton
        variant="outline"
        action={() => setRequestArchived(requestId, !archived)}
        success={archived ? "Request unarchived." : "Request archived. Reminders have stopped."}
      >
        {archived ? "Unarchive" : "Archive"}
      </ActionButton>
    </div>
  );
}

function useDialogAction(action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>, success: string) {
  const [open, setOpen] = useState(false);
  // Next keeps visited pages mounted but hidden; close so Back and Forward never return to an open dialog.
  useLayoutEffect(() => () => setOpen(false), []);
  const [, formAction, pending] = useActionState(async (prev: ActionResult | null, formData: FormData) => {
    const result = await action(prev, formData);
    if (result.ok) {
      toast.success(success);
      setOpen(false);
    } else {
      toast.error(result.error);
    }
    return result;
  }, null);
  return { open, setOpen, formAction, pending };
}

function EditDetailsDialog({ requestId, title, dueDate }: { requestId: string; title: string; dueDate: string }) {
  const { open, setOpen, formAction, pending } = useDialogAction(
    updateRequestDetails.bind(null, requestId),
    "Request updated.",
  );
  const [date, setDate] = useState<string | null>(dueDate);
  const id = useId();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Start from the saved date each time, not one picked and then cancelled.
        if (next) setDate(dueDate);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">Edit details</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit request</DialogTitle>
        </DialogHeader>
        <form onSubmit={submitKeepingValues(formAction)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-title`}>Title</Label>
            <Input id={`${id}-title`} name="title" defaultValue={title} maxLength={LIMITS.name} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-due`}>Due date</Label>
            <DatePicker id={`${id}-due`} name="dueDate" value={date} onChange={setDate} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddItemDialog({ requestId }: { requestId: string }) {
  const { open, setOpen, formAction, pending } = useDialogAction(addItem.bind(null, requestId), "Item added.");
  const id = useId();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus />
          Add item
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add item</DialogTitle>
        </DialogHeader>
        <form onSubmit={submitKeepingValues(formAction)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-title`}>Title</Label>
            <Input id={`${id}-title`} name="title" maxLength={LIMITS.name} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-description`}>Details (optional)</Label>
            <Textarea id={`${id}-description`} name="description" maxLength={LIMITS.description} rows={3} />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Select name="kind" defaultValue="file">
              <SelectTrigger aria-label="Item type" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="file">File upload</SelectItem>
                <SelectItem value="text">Written answer</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Checkbox id={`${id}-required`} name="required" defaultChecked />
              <Label htmlFor={`${id}-required`}>Required</Label>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              Add item
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
