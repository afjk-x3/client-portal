"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MAX_IMPORT_BYTES, readImportRows, type ImportRow, type RowOutcome } from "@/lib/client-import";
import { parseCsv } from "@/lib/csv";
import { importClients, previewImport, type ImportResult } from "./actions";

const LABEL: Record<RowOutcome["outcome"], [string, "default" | "secondary" | "outline" | "destructive"]> = {
  create: ["New client", "default"],
  add: ["Adds contact", "secondary"],
  skip: ["Skipped", "outline"],
  error: ["Error", "destructive"],
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Reads the file in the browser, previews it on the server, then imports on request. */
export function ImportForm() {
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [outcomes, setOutcomes] = useState<RowOutcome[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(file: File | undefined) {
    setRows(null);
    setOutcomes([]);
    setResult(null);
    setProblem(null);
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setProblem("The file must be 1 MB or smaller.");
      return;
    }
    startTransition(async () => {
      const read = readImportRows(parseCsv(await file.text()));
      if (!read.ok) {
        setProblem(read.error);
        return;
      }
      const preview = await previewImport(read.rows);
      if (!preview.ok) {
        setProblem(preview.error);
        return;
      }
      setRows(read.rows);
      setOutcomes(preview.data!);
    });
  }

  function runImport() {
    if (!rows) return;
    startTransition(async () => {
      const done = await importClients(rows);
      if (!done.ok) {
        toast.error(done.error);
        return;
      }
      setResult(done.data!);
      setRows(null);
    });
  }

  const importable = outcomes.filter((o) => o.outcome === "create" || o.outcome === "add").length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="import-file">CSV file</Label>
        <Input
          id="import-file"
          type="file"
          accept=".csv,text/csv"
          className="max-w-sm"
          disabled={pending}
          onChange={(event) => choose(event.target.files?.[0])}
        />
      </div>
      {pending && <p className="text-sm text-muted-foreground">Working…</p>}
      {problem && (
        <Alert variant="destructive">
          <AlertTitle>This file cannot be imported</AlertTitle>
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      )}
      {result && (
        <Alert>
          <AlertTitle>Import finished</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <p>
              {plural(result.clientsCreated, "client")} created, {plural(result.contactsAdded, "contact")} added,{" "}
              {plural(result.skipped, "row")} skipped, {plural(result.failed.length, "row")} failed.
            </p>
            {result.failed.length > 0 && (
              <ul className="list-disc pl-5">
                {result.failed.map((failure) => (
                  <li key={failure.row}>
                    Row {failure.row}: {failure.message}
                  </li>
                ))}
              </ul>
            )}
            <Link className="underline" href="/app/clients">
              Back to clients
            </Link>
          </AlertDescription>
        </Alert>
      )}
      {rows && outcomes.length > 0 && (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Row</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {outcomes.map((o) => {
                  const [label, variant] = LABEL[o.outcome];
                  return (
                    <TableRow key={o.row}>
                      <TableCell>{o.row}</TableCell>
                      <TableCell>{o.clientName}</TableCell>
                      <TableCell>{o.contactEmail}</TableCell>
                      <TableCell>
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge variant={variant}>{label}</Badge>
                          <span className="text-sm text-muted-foreground">{o.message}</span>
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <Button className="self-start" disabled={pending || importable === 0} onClick={runImport}>
            Import {plural(importable, "row")}
          </Button>
        </>
      )}
    </div>
  );
}
