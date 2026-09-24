"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { fail, invalid, notFound, type ActionResult } from "@/lib/errors";
import { ensureUser } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { clientSchema, contactSchema } from "@/lib/validation";

export async function updateClient(
  clientId: string,
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const staff = await requireStaff();
  const parsed = clientSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .update({ name: parsed.data.name, kind: parsed.data.kind, owner_id: parsed.data.ownerId })
    .eq("id", clientId)
    .eq("firm_id", staff.firmId)
    .select("id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return fail(notFound);

  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true, data: { id: clientId } };
}

export async function setClientArchived(clientId: string, archived: boolean): Promise<ActionResult> {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase
    .from("clients")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", clientId)
    .eq("firm_id", staff.firmId);
  if (error) return fail(error);

  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}

/** Section 10.3: confirm the caller is staff, ensure the auth user, insert the contact. No email. */
export async function addContact(
  clientId: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = contactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .eq("firm_id", staff.firmId)
    .maybeSingle();
  if (!client) return fail(notFound);

  const userId = await ensureUser(parsed.data.email);
  const { error } = await supabase.from("client_contacts").insert({
    client_id: clientId,
    firm_id: staff.firmId,
    user_id: userId,
    full_name: parsed.data.fullName,
    email: parsed.data.email,
  });
  if (error) return fail(error, { "23505": "This person is already a contact of this client." });

  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}

export async function removeContact(clientId: string, userId: string): Promise<ActionResult> {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase
    .from("client_contacts")
    .delete()
    .eq("client_id", clientId)
    .eq("user_id", userId)
    .eq("firm_id", staff.firmId);
  if (error) return fail(error);

  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}
