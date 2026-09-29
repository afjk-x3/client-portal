"use client";

import { useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatSize } from "@/lib/files";

export type ClientFileRow = {
  id: string;
  filename: string;
  sizeBytes: number;
  added: string;
  byStaff: boolean;
  requestId: string;
  requestTitle: string;
  itemTitle: string;
};

/** Every file across the client's requests, searchable as staff type. Read-only. */
export function ClientFiles({ files }: { files: ClientFileRow[] }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const hit = (row: ClientFileRow) =>
    needle === "" || [row.filename, row.requestTitle, row.itemTitle].some((field) => field.toLowerCase().includes(needle));
  const shown = files.filter(hit);

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Files ({files.length})</h2>
      <Input
        type="search"
        aria-label="Search this client's files"
        placeholder="File, request, or item"
        className="max-w-sm"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files yet.</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files match.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File</TableHead>
              <TableHead>Request</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Added</TableHead>
              <TableHead>By</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Download</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((file) => (
              <TableRow key={file.id}>
                <TableCell>
                  <a
                    href={`/api/files/${file.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {file.filename}
                  </a>
                </TableCell>
                <TableCell>
                  <Link className="underline-offset-4 hover:underline" href={`/app/requests/${file.requestId}`}>
                    {file.requestTitle}
                  </Link>
                </TableCell>
                <TableCell>{file.itemTitle}</TableCell>
                <TableCell>{file.added}</TableCell>
                <TableCell>{file.byStaff ? "Firm" : "Client"}</TableCell>
                <TableCell className="text-muted-foreground">{formatSize(file.sizeBytes)}</TableCell>
                <TableCell>
                  <a className="underline-offset-4 hover:underline" href={`/api/files/${file.id}?download=1`}>
                    Download
                  </a>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
