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

type Initial = {
  title: string;
  everyMonths: number;
  nextSendOn: string;
  dueAfterDays: number;
  clientIds: string[];
};

export function ScheduleForm({
  mode,
  templateId,
  scheduleId,
  defaultTitle,
  clients,
  initial,
  marks = {},
}: {
  mode: "create" | "edit";
  templateId: string;
  scheduleId?: string;
  defaultTitle: string;
  clients: { id: string; name: string; contacts: number }[];
  initial?: Initial;
  marks?: Record<string, "Archived" | "No contacts">;
}) {
  const router = useRouter();
  const id = useId();
  const [title, setTitle] = useState(initial?.title ?? defaultTitle);
  const [everyMonths, setEveryMonths] = useState(String(initial?.everyMonths ?? 1));
  const [nextSendOn, setNextSendOn] = useState<string | null>(initial?.nextSendOn ?? null);
  const [dueAfterDays, setDueAfterDays] = useState(initial?.dueAfterDays ?? 14);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(initial?.clientIds ?? []));
  const [pending, startTransition] = useTransition();

  const tooMany = selected.size > MAX_CLIENTS_PER_SEND;
  // The form sends the date on create, and on edit only when staff changed it.
  const sendDate = mode === "create" || nextSendOn !== (initial?.nextSendOn ?? null);
  const emails = clients
    .filter((client) => selected.has(client.id) && !marks[client.id])
    .reduce((total, client) => total + client.contacts, 0);

  function save() {
    startTransition(async () => {
      const result = await saveSchedule({
        scheduleId: mode === "edit" ? scheduleId : undefined,
        templateId,
        title,
        everyMonths: Number(everyMonths) as 1 | 3 | 12,
        nextSendOn: sendDate ? nextSendOn ?? undefined : undefined,
        dueAfterDays,
        clientIds: [...selected],
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (mode === "create") router.push("/app/schedules");
      else toast.success("Schedule saved.");
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
          <Label htmlFor={`${id}-send`}>{mode === "create" ? "First send date" : "Next send date"}</Label>
          <DatePicker id={`${id}-send`} value={nextSendOn} onChange={setNextSendOn} />
          <p className="text-sm text-muted-foreground">
            Sent with the daily emails on this date. To send today as well, use Send to clients.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-due`}>Due after</Label>
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

      <ClientPicker clients={clients} selected={selected} onChange={setSelected} marks={marks} />

      <p className="text-sm text-muted-foreground">About {emails} emails each time</p>

      <div>
        <Button
          disabled={pending || selected.size === 0 || tooMany || !nextSendOn || title.trim() === ""}
          onClick={save}
        >
          {pending ? (mode === "create" ? "Creating…" : "Saving…") : mode === "create" ? "Create schedule" : "Save"}
        </Button>
      </div>
    </div>
  );
}
