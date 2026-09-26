import { Suspense } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/auth";
import { IMPORT_TEMPLATE, MAX_IMPORT_ROWS } from "@/lib/client-import";
import { ImportForm } from "./import-form";

// This page's Server Actions create an account per contact, which takes a while for 500 rows.
export const maxDuration = 300;

export default function ImportClientsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <ImportClients />
    </Suspense>
  );
}

async function ImportClients() {
  await requireStaff();
  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href="/app/clients" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← All clients
        </Link>
        <h1 className="text-2xl font-semibold">Import clients</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Upload a CSV file with the columns client_name, client_type, contact_name, and contact_email: one row per
          contact, up to {MAX_IMPORT_ROWS} rows. Leave the contact columns empty for a client without contacts. Nothing is
          saved until you check the preview and click Import, and no emails are sent.{" "}
          <a
            className="underline"
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(IMPORT_TEMPLATE)}`}
            download="clients-template.csv"
          >
            Download the template
          </a>
        </p>
      </div>
      <ImportForm />
    </>
  );
}
