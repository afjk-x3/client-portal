"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { formatDate, formatDateTime } from "@/lib/dates";

type WaitingRow = {
  requestId: string;
  client: string;
  title: string;
  dueDate: string;
  openItems: number;
  overdue: boolean;
};

type ReadyRow = {
  requestId: string;
  client: string;
  request: string;
  item: string;
  submittedAt: string;
};

const waitingColumns: DataTableColumn<WaitingRow>[] = [
  { accessorKey: "client", header: "Client" },
  {
    id: "title",
    header: "Request",
    cell: ({ row }) => (
      <Link className="font-medium underline-offset-4 hover:underline" href={`/app/requests/${row.original.requestId}`}>
        {row.original.title}
      </Link>
    ),
  },
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

const readyColumns: DataTableColumn<ReadyRow>[] = [
  { accessorKey: "client", header: "Client" },
  {
    id: "request",
    header: "Request",
    cell: ({ row }) => (
      <Link className="font-medium underline-offset-4 hover:underline" href={`/app/requests/${row.original.requestId}`}>
        {row.original.request}
      </Link>
    ),
  },
  { accessorKey: "item", header: "Item" },
  { id: "submitted", header: "Submitted", cell: ({ row }) => formatDateTime(row.original.submittedAt) },
];

export function DashboardTabs({ waiting, ready }: { waiting: WaitingRow[]; ready: ReadyRow[] }) {
  return (
    <Tabs defaultValue="waiting">
      <TabsList>
        <TabsTrigger value="waiting">Waiting on clients ({waiting.length})</TabsTrigger>
        <TabsTrigger value="ready">Ready for review ({ready.length})</TabsTrigger>
      </TabsList>
      <TabsContent value="waiting">
        <DataTable columns={waitingColumns} data={waiting} emptyMessage="No client is holding up a request." />
      </TabsContent>
      <TabsContent value="ready">
        <DataTable columns={readyColumns} data={ready} emptyMessage="Nothing to review." />
      </TabsContent>
    </Tabs>
  );
}
