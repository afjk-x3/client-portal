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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LIMITS, MAX_CLIENTS_PER_SEND } from "@/lib/constants";
import { sendToClients } from "@/app/app/requests/actions";

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
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const shown = clients.filter((client) => client.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const allShown = shown.length > 0 && shown.every((client) => selected.has(client.id));
  const tooMany = selected.size > MAX_CLIENTS_PER_SEND;

  function select(ids: string[], on: boolean) {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const clientId of ids) {
        if (on) next.add(clientId);
        else next.delete(clientId);
      }
      return next;
    });
  }

  function send() {
    startTransition(async () => {
      const result = await sendToClients({ templateId, title, dueDate: dueDate ?? "", clientIds: [...selected] });
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
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={`${id}-filter`}>Clients</Label>
          <span className="text-sm text-muted-foreground">{selected.size} selected</span>
        </div>
        {clients.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active client has a contact yet.</p>
        ) : (
          <>
            <Input
              id={`${id}-filter`}
              placeholder="Filter by name"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            <div className="rounded-md border">
              <label className="flex items-center gap-3 border-b px-3 py-2 text-sm font-medium">
                <Checkbox
                  checked={allShown}
                  disabled={shown.length === 0}
                  onCheckedChange={(checked) => select(shown.map((client) => client.id), checked === true)}
                />
                Select all shown
              </label>
              <ul className="max-h-96 overflow-y-auto">
                {shown.map((client) => (
                  <li key={client.id}>
                    <label className="flex items-center gap-3 px-3 py-2 text-sm">
                      <Checkbox
                        checked={selected.has(client.id)}
                        onCheckedChange={(checked) => select([client.id], checked === true)}
                      />
                      <span className="flex-1">{client.name}</span>
                      <span className="text-muted-foreground">{plural(client.contacts, "contact")}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
        <p className="text-sm text-muted-foreground">
          {tooMany
            ? `Pick at most ${MAX_CLIENTS_PER_SEND} clients at a time.`
            : "Only active clients with at least one contact are listed."}
        </p>
      </div>

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
