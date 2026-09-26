"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { MAX_IMPORT_ROWS, planImport, type ExistingClient, type ImportRow, type RowOutcome } from "@/lib/client-import";
import { errorMessage, type ActionResult } from "@/lib/errors";
import { ensureUser } from "@/lib/supabase/admin";
import { NIL_UUID, PAGE_SIZE, readAll } from "@/lib/supabase/read-all";
import { createClient } from "@/lib/supabase/server";

// The browser sends what it read from the file; planImport decides which rows are valid.
const rowsSchema = z
  .array(
    z.object({
      row: z.number().int().min(2),
      clientName: z.string().max(1000),
      clientType: z.string().max(100),
      contactName: z.string().max(1000),
      contactEmail: z.string().max(1000),
    }),
  )
  .min(1)
  .max(MAX_IMPORT_ROWS);

const badRows = { ok: false as const, error: `A file must have between 1 and ${MAX_IMPORT_ROWS} rows.` };

export type ImportResult = {
  clientsCreated: number;
  contactsAdded: number;
  skipped: number;
  failed: { row: number; message: string }[];
};

/** Every client of the firm with its contacts' emails, in pages. */
async function existingClients(firmId: string): Promise<ExistingClient[]> {
  const supabase = await createClient();
  const clients = await readAll((last?: { id: string }) =>
    supabase
      .from("clients")
      .select("id, name, archived_at, client_contacts(email)")
      .eq("firm_id", firmId)
      .gt("id", last?.id ?? NIL_UUID)
      .order("id")
      .limit(PAGE_SIZE),
  );
  return clients.map((client) => ({
    id: client.id,
    name: client.name,
    archived: client.archived_at !== null,
    contactEmails: client.client_contacts.map((contact) => contact.email.toLowerCase()),
  }));
}

/** What importing the rows would do. Saves nothing. */
export async function previewImport(input: ImportRow[]): Promise<ActionResult<RowOutcome[]>> {
  const staff = await requireStaff();
  const rows = rowsSchema.safeParse(input);
  if (!rows.success) return badRows;
  return { ok: true, data: planImport(rows.data, await existingClients(staff.firmId)).outcomes };
}

/**
 * Plans again against current data, then creates the clients and adds the
 * contacts the way addContact does. No emails are sent. Running the same file
 * twice adds nothing the second time.
 */
export async function importClients(input: ImportRow[]): Promise<ActionResult<ImportResult>> {
  const staff = await requireStaff();
  const rows = rowsSchema.safeParse(input);
  if (!rows.success) return badRows;
  const plan = planImport(rows.data, await existingClients(staff.firmId));
  const failed = plan.outcomes.filter((o) => o.outcome === "error").map((o) => ({ row: o.row, message: o.message }));

  const supabase = await createClient();
  const createdIds = new Map<string, string>();
  for (const client of plan.newClients) {
    const { data, error } = await supabase
      .from("clients")
      .insert({ firm_id: staff.firmId, name: client.name, kind: client.kind })
      .select("id")
      .single();
    if (error) failed.push(...client.rows.map((row) => ({ row, message: errorMessage(error) })));
    else createdIds.set(client.key, data.id);
  }

  let contactsAdded = 0;
  let skipped = plan.outcomes.filter((o) => o.outcome === "skip").length;
  for (const contact of plan.contacts) {
    const clientId = contact.clientId ?? createdIds.get(contact.clientKey);
    if (!clientId) continue; // Its new client failed, and that row is already reported.
    try {
      const userId = await ensureUser(contact.email);
      const { error } = await supabase.from("client_contacts").insert({
        client_id: clientId,
        firm_id: staff.firmId,
        user_id: userId,
        full_name: contact.fullName,
        email: contact.email,
      });
      // 23505: this person is already a contact of the client under another address.
      if (!error) contactsAdded++;
      else if (error.code === "23505") skipped++;
      else failed.push({ row: contact.row, message: errorMessage(error) });
    } catch (error) {
      console.error("[import] contact failed", contact.row, error);
      failed.push({ row: contact.row, message: "This contact could not be added. Run the import again." });
    }
  }

  revalidatePath("/app/clients");
  return {
    ok: true,
    data: {
      clientsCreated: createdIds.size,
      contactsAdded,
      skipped,
      failed: failed.sort((a, b) => a.row - b.row),
    },
  };
}
