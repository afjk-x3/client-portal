"use client";

import { useId, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_CLIENTS_PER_SEND } from "@/lib/constants";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function ClientPicker({
  clients,
  selected,
  onChange,
  marks = {},
}: {
  clients: { id: string; name: string; contacts: number }[];
  selected: ReadonlySet<string>;
  onChange: (next: ReadonlySet<string>) => void;
  marks?: Record<string, "Archived" | "No contacts">;
}) {
  const id = useId();
  const [filter, setFilter] = useState("");
  const shown = clients.filter((client) => client.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const allShown = shown.length > 0 && shown.every((client) => selected.has(client.id));
  const tooMany = selected.size > MAX_CLIENTS_PER_SEND;

  function select(ids: string[], on: boolean) {
    const next = new Set(selected);
    for (const clientId of ids) {
      if (on) next.add(clientId);
      else next.delete(clientId);
    }
    onChange(next);
  }

  return (
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
                    {marks[client.id] ? (
                      <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                        {marks[client.id]}
                      </span>
                    ) : null}
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
          : Object.keys(marks).length > 0
            ? "Marked clients are skipped when the schedule sends."
            : "Only active clients with at least one contact are listed."}
      </p>
    </div>
  );
}
