"use client";

import type { ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type DataTableColumn<TData> = {
  id?: string;
  accessorKey?: keyof TData & string;
  header: string | (() => ReactNode);
  cell?: (context: { row: { original: TData } }) => ReactNode;
};

/** Renders rows in the order given; callers sort and filter the data. */
export function DataTable<TData>({
  columns,
  data,
  emptyMessage,
}: {
  columns: DataTableColumn<TData>[];
  data: TData[];
  emptyMessage: string;
}) {
  const cellValue = (column: DataTableColumn<TData>, row: TData): ReactNode => {
    if (column.cell) return column.cell({ row: { original: row } });
    const value = column.accessorKey === undefined ? undefined : row[column.accessorKey];
    return value == null ? null : String(value);
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.id ?? String(column.accessorKey)}>
                {typeof column.header === "function" ? column.header() : column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.length > 0 ? (
            data.map((row, index) => (
              <TableRow key={index}>
                {columns.map((column) => (
                  <TableCell key={column.id ?? String(column.accessorKey)}>{cellValue(column, row)}</TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
