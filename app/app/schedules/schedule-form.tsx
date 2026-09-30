"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DatePicker } from "@/components/date-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { LIMITS, MAX_CLIENTS_PER_SEND } from "@/lib/constants";
import { ClientPicker } from "@/app/app/templates/[id]/client-picker";
import { saveSchedule } from "./actions";

export function ScheduleForm({
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
  const [everyMonths, setEveryMonths] = useState("1");
  const [nextSendOn, setNextSendOn] = useState<string | null>(null);
  const [dueAfterDays, setDueAfterDays] = useState(14);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const tooMany = selected.size > MAX_CLIENTS_PER_SEND;
  const emails = clients
    .filter((client) => selected.has(client.id))
    .reduce((total, client) => total + client.contacts, 0);

  function create() {
    startTransition(async () => {
      const result = await saveSchedule({
        templateId,
        title,
        everyMonths: Number(everyMonths) as 1 | 3 | 12,
        nextSendOn: nextSendOn ?? undefined,
        dueAfterDays,
        clientIds: [...selected],
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.push("/app/schedules");
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
            maxLength={LIMITS.scheduleTitle}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-repeat`}>Repeat</Label>
          <NativeSelect id={`${id}-repeat`} value={everyMonths} onChange={(event) => setEveryMonths(event.target.value)}>
            <NativeSelectOption value="1">Monthly</NativeSelectOption>
            <NativeSelectOption value="3">Quarterly</NativeSelectOption>
            <NativeSelectOption value="12">Yearly</NativeSelectOption>
          </NativeSelect>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-send`}>First send date</Label>
          <DatePicker id={`${id}-send`} value={nextSendOn} onChange={setNextSendOn} />
          <p className="text-sm text-muted-foreground">
            Sent with the daily emails on this date. To send today as well, use Send to clients.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-due`}>Due after (days)</Label>
          <Input
            id={`${id}-due`}
            type="number"
            min={1}
            max={365}
            value={dueAfterDays}
            onChange={(event) => setDueAfterDays(event.target.valueAsNumber || 0)}
          />
        </div>
      </div>

      <ClientPicker clients={clients} selected={selected} onChange={setSelected} />

      <p className="text-sm text-muted-foreground">About {emails} emails each time</p>

      <div>
        <Button
          disabled={pending || selected.size === 0 || tooMany || !nextSendOn || title.trim() === ""}
          onClick={create}
        >
          {pending ? "Creating…" : "Create schedule"}
        </Button>
      </div>
    </div>
  );
}
