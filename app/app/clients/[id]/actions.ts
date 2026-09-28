"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { fail, invalid, notFound, staleState, type ActionResult } from "@/lib/errors";
import { confirmsName } from "@/lib/retention";
import { ensureUser } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { clientSchema, contactSchema, isId } from "@/lib/validation";

export async function updateClient(
  clientId: string,
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const staff = await requireStaff();
  if (!isId(clientId)) return fail(notFound);
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
  if (!isId(clientId)) return fail(notFound);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", clientId)
    .eq("firm_id", staff.firmId)
    .select("id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return fail(notFound);

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
  if (!isId(clientId)) return fail(notFound);
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
  if (!isId(clientId) || !isId(userId)) return fail(notFound);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("client_contacts")
    .delete()
    .eq("client_id", clientId)
    .eq("user_id", userId)
    .eq("firm_id", staff.firmId)
    .select("user_id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return fail(notFound);

  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}

/** Permanently deletes an archived client, after the admin types its name. */
export async function deleteClient(clientId: string, confirmation: string): Promise<ActionResult> {
  const staff = await requireStaff();
  if (staff.role !== "admin") return { ok: false, error: "Only admins can delete clients." };
  if (!isId(clientId)) return fail(notFound);
  const supabase = await createClient();
  const { data: client } = await supabase
    .from("clients")
    .select("name")
    .eq("id", clientId)
    .eq("firm_id", staff.firmId)
    .maybeSingle();
  if (!client) return fail(staleState);
  if (!confirmsName(confirmation, client.name))
    return { ok: false, error: "Type the client's name exactly to confirm." };

  const { data, error } = await supabase
    .from("clients")
    .delete()
    .eq("id", clientId)
    .eq("firm_id", staff.firmId)
    .not("archived_at", "is", null)
    .select("id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return fail(staleState);

  revalidatePath("/app/clients");
  redirect("/app/clients");
}
