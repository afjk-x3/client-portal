"use client";

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
import { deleteSchedule } from "./actions";

export function DeleteScheduleButton({ scheduleId }: { scheduleId: string }) {
  async function remove() {
    const result = await deleteSchedule(scheduleId);
    if (!result.ok) toast.error(result.error);
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline">
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this schedule?</AlertDialogTitle>
          <AlertDialogDescription>Requests it already sent stay.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
