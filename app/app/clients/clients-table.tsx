"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DataTable, type DataTableColumn } from "@/components/data-table";

export type ClientRow = {
  id: string;
  name: string;
  kind: string;
  owner: string;
  archived: boolean;
};

const columns: DataTableColumn<ClientRow>[] = [
  {
    id: "name",
    header: "Name",
    cell: ({ row }) => (
      <Link className="font-medium underline-offset-4 hover:underline" href={`/app/clients/${row.original.id}`}>
        {row.original.name}
      </Link>
    ),
  },
  { id: "kind", header: "Type", cell: ({ row }) => (row.original.kind === "business" ? "Business" : "Individual") },
  { accessorKey: "owner", header: "Owner" },
  { id: "status", header: "", cell: ({ row }) => row.original.archived && <Badge variant="outline">Archived</Badge> },
];

export function ClientsTable({ clients }: { clients: ClientRow[] }) {
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const needle = query.trim().toLowerCase();
  const visible = clients.filter(
    (client) => (showArchived || !client.archived) && client.name.toLowerCase().includes(needle),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <Input
          className="max-w-xs"
          placeholder="Search by name"
          aria-label="Search by name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <Switch id="show-archived" checked={showArchived} onCheckedChange={setShowArchived} />
          <Label htmlFor="show-archived">Show archived</Label>
        </div>
      </div>
      <DataTable columns={columns} data={visible} emptyMessage="No clients." />
    </div>
  );
}
