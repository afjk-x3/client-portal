"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { leaveFirm } from "./actions";

/** Lets a staff member (not an admin) leave the firm. */
export function LeaveFirm({ firmName }: { firmName: string }) {
  const [pending, startTransition] = useTransition();

  function leave() {
    startTransition(async () => {
      const result = await leaveFirm();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      // A full page load, so no page kept mounted for this firm survives.
      window.location.replace(result.data!.next);
    });
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <h2 className="text-lg font-semibold">Leave firm</h2>
      <p className="text-sm text-muted-foreground">
        Were you added by mistake? Leave {firmName}, and then you can set up your own firm.
      </p>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" disabled={pending}>
            Leave firm
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave {firmName}?</AlertDialogTitle>
            <AlertDialogDescription>
              You will lose access to its clients and requests. An admin can add you again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={leave}>Leave firm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
