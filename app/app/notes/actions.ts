"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { fail, invalid, notFound, staleState, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { isId, noteSchema } from "@/lib/validation";

/** The note may show on its request's page and always on its client's page. */
function revalidateNotePages(clientId: string, requestId: string | null) {
  revalidatePath(`/app/clients/${clientId}`);
  if (requestId) revalidatePath(`/app/requests/${requestId}`);
}

export async function addNote(clientId: string, requestId: string | null, body: string): Promise<ActionResult> {
  const staff = await requireStaff();
  if (!isId(clientId) || (requestId !== null && !isId(requestId))) return fail(notFound);
  const parsed = noteSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.from("notes").insert({
    firm_id: staff.firmId,
    client_id: clientId,
    request_id: requestId,
    body: parsed.data,
  });
  if (error) return fail(error);

  revalidateNotePages(clientId, requestId);
  return { ok: true };
}

export async function updateNote(noteId: string, body: string): Promise<ActionResult> {
  const staff = await requireStaff();
  if (!isId(noteId)) return fail(notFound);
  const parsed = noteSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notes")
    .update({ body: parsed.data })
    .eq("id", noteId)
    .eq("firm_id", staff.firmId)
    .select("id, client_id, request_id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return fail(staleState);

  revalidateNotePages(data.client_id, data.request_id);
  return { ok: true };
}

export async function deleteNote(noteId: string): Promise<ActionResult> {
  const staff = await requireStaff();
  if (!isId(noteId)) return fail(notFound);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notes")
    .delete()
    .eq("id", noteId)
    .eq("firm_id", staff.firmId)
    .select("id, client_id, request_id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return fail(staleState);

  revalidateNotePages(data.client_id, data.request_id);
  return { ok: true };
}
