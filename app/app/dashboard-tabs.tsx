"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { formatDate } from "@/lib/dates";

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
  /** Formatted on the server in the firm's time zone. */
  submitted: string;
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
  { accessorKey: "submitted", header: "Submitted" },
];

export function DashboardTabs({ waiting, ready }: { waiting: WaitingRow[]; ready: ReadyRow[] }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const hit = (...fields: string[]) => needle === "" || fields.some((field) => field.toLowerCase().includes(needle));
  const shownWaiting = waiting.filter((row) => hit(row.client, row.title));
  const shownReady = ready.filter((row) => hit(row.client, row.request, row.item));

  return (
    <div className="flex flex-col gap-4">
      <Input
        type="search"
        aria-label="Search the dashboard"
        placeholder="Search clients, requests, and items"
        className="max-w-sm"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <Tabs defaultValue="waiting">
        <TabsList>
          <TabsTrigger value="waiting">Waiting on clients ({shownWaiting.length})</TabsTrigger>
          <TabsTrigger value="ready">Ready for review ({shownReady.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="waiting">
          <DataTable columns={waitingColumns} data={shownWaiting} emptyMessage="No client is holding up a request." />
        </TabsContent>
        <TabsContent value="ready">
          <DataTable columns={readyColumns} data={shownReady} emptyMessage="Nothing to review." />
        </TabsContent>
      </Tabs>
    </div>
  );
}
