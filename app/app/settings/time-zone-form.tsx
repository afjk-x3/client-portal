"use client";

import { useActionState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ActionResult } from "@/lib/errors";
import { submitKeepingValues } from "@/lib/forms";
import { setTimeZone } from "./actions";

export function TimeZoneForm({
  timeZone,
  regions,
  editable,
}: {
  timeZone: string;
  regions: { region: string; names: string[] }[];
  editable: boolean;
}) {
  const [, formAction, pending] = useActionState(async (prev: ActionResult | null, formData: FormData) => {
    const result = await setTimeZone(prev, formData);
    if (result.ok) toast.success("Time zone saved.");
    else toast.error(result.error);
    return result;
  }, null);

  return (
    <form onSubmit={submitKeepingValues(formAction)} className="flex max-w-md flex-col gap-2">
      <Label htmlFor="time-zone">Time zone</Label>
      <div className="flex gap-2">
        <Select name="timeZone" defaultValue={timeZone} disabled={!editable}>
          <SelectTrigger id="time-zone" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {regions.map(({ region, names }) => (
              <SelectGroup key={region}>
                <SelectLabel>{region}</SelectLabel>
                {names.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name.replaceAll("_", " ")}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        {editable && (
          <Button type="submit" disabled={pending} aria-label="Save time zone">
            Save
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">Due dates, overdue requests, and reminder days follow this time zone.</p>
    </form>
  );
}
