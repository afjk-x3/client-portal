"use client";

import { useActionState, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { LIMITS } from "@/lib/constants";
import type { ActionResult } from "@/lib/errors";

export type Member = { userId: string; fullName: string };

type ClientValues = { name: string; kind: string; ownerId: string | null };

type Result = ActionResult<{ id: string }>;

/**
 * Create or edit a client. `action` receives the form fields name, kind, ownerId.
 * With `openAfterSave`, navigates to the saved client after closing.
 */
export function ClientFormDialog({
  title,
  trigger,
  members,
  initial,
  action,
  openAfterSave = false,
}: {
  title: string;
  trigger: ReactNode;
  members: Member[];
  initial?: ClientValues;
  action: (prev: Result | null, formData: FormData) => Promise<Result>;
  openAfterSave?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, formAction, pending] = useActionState(async (prev: Result | null, formData: FormData) => {
    const result = await action(prev, formData);
    if (result.ok) {
      toast.success("Client saved.");
      setOpen(false);
      if (openAfterSave) router.push(`/app/clients/${result.data!.id}`);
    } else {
      toast.error(result.error);
    }
    return result;
  }, null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="client-name">Name</Label>
            <Input id="client-name" name="name" defaultValue={initial?.name} maxLength={LIMITS.name} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="client-kind">Type</Label>
            <Select name="kind" defaultValue={initial?.kind ?? "individual"}>
              <SelectTrigger id="client-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="individual">Individual or household</SelectItem>
                <SelectItem value="business">Business</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="client-owner">Owner</Label>
            <Select name="ownerId" defaultValue={initial?.ownerId ?? "none"}>
              <SelectTrigger id="client-owner">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No owner</SelectItem>
                {members.map((member) => (
                  <SelectItem key={member.userId} value={member.userId}>
                    {member.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
