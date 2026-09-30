"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DatePicker } from "@/components/date-picker";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LIMITS, MAX_CLIENTS_PER_SEND } from "@/lib/constants";
import { sendToClients } from "@/app/app/requests/actions";
import { ClientPicker } from "../client-picker";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function SendToClientsForm({
  templateId,
  defaultTitle,
  clients,
}: {
  templateId: string;
  defaultTitle: string;
  clients: { id: string; name: string; contacts: number }[];
}) {
  const router = useRouter();
  const id = useId();
  const [title, setTitle] = useState(defaultTitle);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const tooMany = selected.size > MAX_CLIENTS_PER_SEND;

  function send() {
    startTransition(async () => {
      const result = await sendToClients({
        templateId,
        title,
        dueDate: dueDate ?? "",
        clientIds: [...selected],
        message,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Sent to ${plural(result.data!.requests, "client")}.`);
      router.push("/app");
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-title`}>Title</Label>
          <Input
            id={`${id}-title`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={LIMITS.name}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-due`}>Due date</Label>
          <DatePicker id={`${id}-due`} value={dueDate} onChange={setDueDate} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-message`}>Message to the client (optional)</Label>
        <Textarea
          id={`${id}-message`}
          value={message}
          maxLength={LIMITS.message}
          rows={3}
          onChange={(event) => setMessage(event.target.value)}
        />
      </div>

      <ClientPicker clients={clients} selected={selected} onChange={setSelected} />

      <div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button disabled={pending || selected.size === 0 || tooMany || !dueDate || title.trim() === ""}>
              {pending ? "Sending…" : `Send to ${plural(selected.size, "client")}`}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Send to {plural(selected.size, "client")}?</AlertDialogTitle>
              <AlertDialogDescription>
                Each client gets their own request, and their contacts get an email now.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={send}>Send</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
