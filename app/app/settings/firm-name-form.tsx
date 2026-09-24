"use client";

import { useActionState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LIMITS } from "@/lib/constants";
import type { ActionResult } from "@/lib/errors";
import { renameFirm } from "./actions";

export function FirmNameForm({ name, editable }: { name: string; editable: boolean }) {
  const [, formAction, pending] = useActionState(async (prev: ActionResult | null, formData: FormData) => {
    const result = await renameFirm(prev, formData);
    if (result.ok) toast.success("Firm name saved.");
    else toast.error(result.error);
    return result;
  }, null);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-2">
      <Label htmlFor="firm-name">Firm name</Label>
      <div className="flex gap-2">
        <Input id="firm-name" name="name" defaultValue={name} maxLength={LIMITS.firmName} required disabled={!editable} />
        {editable && (
          <Button type="submit" disabled={pending}>
            Save
          </Button>
        )}
      </div>
    </form>
  );
}
