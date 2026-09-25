"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
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

/** One page of clients; the page's filters decide which. */
export function ClientsTable({ clients }: { clients: ClientRow[] }) {
  return <DataTable columns={columns} data={clients} emptyMessage="No clients." />;
}
