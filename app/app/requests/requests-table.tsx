"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
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
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RequestStatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { archiveResultMessage, unarchiveResultMessage } from "./archive-message";
import { archiveRequests, unarchiveRequests } from "./actions";
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

const isSelectable = (row: RequestListRow) => row.status !== "draft";
const plural = (count: number) => `${count} ${count === 1 ? "request" : "requests"}`;

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
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [, startTransition] = useTransition();

  const selectableIds = useMemo(() => rows.filter(isSelectable).map((row) => row.id), [rows]);
  const chosen = selectableIds.filter((id) => selected.has(id));
  const rowsById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  const { toArchive, toUnarchive, openCount } = useMemo(() => {
    const toArchive = chosen.filter((id) => rowsById.get(id)!.status !== "archived");
    const toUnarchive = chosen.filter((id) => rowsById.get(id)!.status === "archived");
    const openCount = toArchive.filter((id) => rowsById.get(id)!.status === "open").length;
    return { toArchive, toUnarchive, openCount };
  }, [chosen, rowsById]);

  const allColumns = useMemo<DataTableColumn<RequestListRow>[]>(() => {
    const selectColumn: DataTableColumn<RequestListRow> = {
      id: "select",
      header: () => {
        const all = selectableIds.length > 0 && chosen.length === selectableIds.length;
        return (
          <Checkbox
            aria-label="Select all on this page"
            checked={all ? true : chosen.length > 0 ? "indeterminate" : false}
            onCheckedChange={(state) =>
              setSelected((previous) => {
                const next = new Set(previous);
                for (const id of selectableIds) {
                  if (state === true || state === "indeterminate") next.add(id);
                  else next.delete(id);
                }
                return next;
              })
            }
          />
        );
      },
      cell: ({ row }) =>
        isSelectable(row.original) ? (
          <Checkbox
            aria-label={`Select ${row.original.title}`}
            checked={selected.has(row.original.id)}
            onCheckedChange={(state) =>
              setSelected((previous) => {
                const next = new Set(previous);
                if (state === true) next.add(row.original.id);
                else next.delete(row.original.id);
                return next;
              })
            }
          />
        ) : null,
    };
    return [selectColumn, ...columns];
  }, [selectableIds, chosen, selected]);

  function archive() {
    const ids = toArchive;
    startTransition(async () => {
      const result = await archiveRequests(ids);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(archiveResultMessage(result.data?.archived ?? 0, ids.length));
      setSelected(new Set());
    });
  }

  function unarchive() {
    const ids = toUnarchive;
    startTransition(async () => {
      const result = await unarchiveRequests(ids);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(unarchiveResultMessage(result.data?.unarchived ?? 0, ids.length));
      setSelected(new Set());
    });
  }

  return (
    <>
      {chosen.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{chosen.length} selected</span>
          {toArchive.length > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline">Archive {plural(toArchive.length)}</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Archive {plural(toArchive.length)}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Reminders stop and clients can no longer upload or submit. You can unarchive any of them later.
                    {openCount > 0 && ` ${openCount} of them are still open.`}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={archive}>Archive</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {toUnarchive.length > 0 && (
            <Button variant="outline" onClick={unarchive}>
              Unarchive {plural(toUnarchive.length)}
            </Button>
          )}
          <Button variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}
      <DataTable columns={allColumns} data={rows} emptyMessage="No requests match." />
    </>
  );
}
