"use client";

import { useTransition, type ComponentProps } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/errors";

/** A button that runs a Server Action and reports the result in a toast. */
export function ActionButton({
  action,
  success,
  disabled,
  ...props
}: Omit<ComponentProps<typeof Button>, "onClick" | "action"> & {
  action: () => Promise<ActionResult<unknown>>;
  success?: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      {...props}
      disabled={disabled || pending}
      onClick={() =>
        startTransition(async () => {
          const result = await action();
          if (!result.ok) toast.error(result.error);
          else if (success) toast.success(success);
        })
      }
    />
  );
}
