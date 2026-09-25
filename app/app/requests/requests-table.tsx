"use client";

import Link from "next/link";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { RequestStatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/dates";

export type RequestListRow = {
  id: string;
  title: string;
  status: string;
  dueDate: string;
  clientId: string;
  clientName: string;
  openItems: number;
  overdue: boolean;
};

const columns: DataTableColumn<RequestListRow>[] = [
  {
    id: "client",
    header: "Client",
    cell: ({ row }) => (
      <Link className="underline-offset-4 hover:underline" href={`/app/clients/${row.original.clientId}`}>
        {row.original.clientName}
      </Link>
    ),
  },
  {
    id: "title",
    header: "Request",
    cell: ({ row }) => (
      <Link className="font-medium underline-offset-4 hover:underline" href={`/app/requests/${row.original.id}`}>
        {row.original.title}
      </Link>
    ),
  },
  { id: "status", header: "Status", cell: ({ row }) => <RequestStatusBadge status={row.original.status} /> },
  {
    id: "due",
    header: "Due",
    cell: ({ row }) => (
      <span className="flex items-center gap-2">
        {formatDate(row.original.dueDate)}
        {row.original.overdue && <Badge variant="destructive">Overdue</Badge>}
      </span>
    ),
  },
  { accessorKey: "openItems", header: "Open items" },
];

export function RequestsTable({ rows }: { rows: RequestListRow[] }) {
  return <DataTable columns={columns} data={rows} emptyMessage="No requests match." />;
}
