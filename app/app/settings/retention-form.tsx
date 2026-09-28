"use client";

import { startTransition, useActionState, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDateTime } from "@/lib/dates";
import type { ActionResult } from "@/lib/errors";
import { isShorterRetention, nextCleanupAt, RETENTION_YEARS } from "@/lib/retention";
import { previewRetention, setFileRetention } from "./actions";

const OPTIONS = [
  { value: "forever", label: "Forever" },
  ...RETENTION_YEARS.map((years) => ({
    value: String(years),
    label: `${years} year${years === 1 ? "" : "s"} after archiving`,
  })),
];

export function RetentionForm({
  current,
  timeZone,
  editable,
}: {
  current: number | null;
  timeZone: string;
  editable: boolean;
}) {
  const [years, setYears] = useState(current === null ? "forever" : String(current));
  const [count, setCount] = useState(0);
  const [cleanup, setCleanup] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pendingForm, setPendingForm] = useState<FormData | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const [, formAction, saving] = useActionState(async (prev: ActionResult | null, formData: FormData) => {
    const result = await setFileRetention(prev, formData);
    if (result.ok) toast.success("File retention saved.");
    else toast.error(result.error);
    return result;
  }, null);

  function save(formData: FormData) {
    startTransition(() => formAction(formData));
  }

  async function checkAndSave(formData: FormData, next: number) {
    setPreviewing(true);
    try {
      const preview = await previewRetention(next);
      if (!preview.ok) {
        toast.error(preview.error);
        return;
      }
      const previewCount = preview.data?.count ?? 0;
      if (previewCount > 0) {
        setCount(previewCount);
        setCleanup(formatDateTime(nextCleanupAt(new Date()).toISOString(), timeZone));
        setPendingForm(formData);
        setConfirming(true);
      } else {
        save(formData);
      }
    } finally {
      setPreviewing(false);
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const next = years === "forever" ? null : Number(years);
    if (next === null || !isShorterRetention(current, next)) save(formData);
    else void checkAndSave(formData, next);
  }

  function saveAnyway() {
    setConfirming(false);
    if (pendingForm) save(pendingForm);
    setPendingForm(null);
  }

  return (
    <form onSubmit={submit} className="flex max-w-md flex-col gap-2">
      <Label htmlFor="retention">Keep files from archived requests</Label>
      <div className="flex gap-2">
        <Select name="years" value={years} onValueChange={setYears} disabled={!editable}>
          <SelectTrigger id="retention" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {editable && (
          <Button type="submit" disabled={saving || previewing} aria-label="Save file retention">
            Save
          </Button>
        )}
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Files from {count} archived requests will be deleted at the next daily cleanup ({cleanup}). Save anyway?
            </AlertDialogTitle>
          </AlertDialogHeader>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction type="button" onClick={saveAnyway}>
              Save anyway
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
