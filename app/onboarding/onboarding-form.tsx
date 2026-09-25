"use client";

import { useActionState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LIMITS } from "@/lib/constants";
import type { ActionResult } from "@/lib/errors";
import { submitKeepingValues } from "@/lib/forms";
import { createFirm } from "./actions";

const subscribe = () => () => {};
const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function OnboardingForm() {
  // UTC while rendering on the server, then the browser's own zone.
  const timeZone = useSyncExternalStore(subscribe, browserTimeZone, () => "UTC");
  const [, formAction, pending] = useActionState(async (prev: ActionResult | null, formData: FormData) => {
    const result = await createFirm(prev, formData);
    if (!result.ok) toast.error(result.error);
    return result;
  }, null);

  return (
    <form onSubmit={submitKeepingValues(formAction)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="firmName">Firm name</Label>
        <Input id="firmName" name="firmName" maxLength={LIMITS.firmName} required autoFocus />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="fullName">Your full name</Label>
        <Input id="fullName" name="fullName" maxLength={LIMITS.name} autoComplete="name" required />
      </div>
      <input type="hidden" name="timeZone" value={timeZone} />
      <p className="text-sm text-muted-foreground">
        Due dates follow your time zone, {timeZone.replaceAll("_", " ")}. You can change it later in Settings.
      </p>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create firm"}
      </Button>
    </form>
  );
}
