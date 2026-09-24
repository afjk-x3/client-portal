"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getContactClientIds, requireAdmin, requireStaff } from "@/lib/auth";
import { sendEmails } from "@/lib/email/send";
import { staffAddedEmail } from "@/lib/email/templates";
import { fail, invalid, notFound, staleState, type ActionResult } from "@/lib/errors";
import { ensureUser } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { firmNameSchema, isId, roleSchema, staffSchema } from "@/lib/validation";

export async function renameFirm(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const staff = await requireAdmin();
  const name = firmNameSchema.safeParse(formData.get("name"));
  if (!name.success) return invalid(name.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("firms")
    .update({ name: name.data })
    .eq("id", staff.firmId)
    .select("id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return fail(notFound);

  revalidatePath("/app", "layout");
  return { ok: true };
}

/** Section 10.2: admin check, ensure the auth user, insert the membership, then email them. */
export async function addStaff(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = staffSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  // Build the email before changing anything, so a configuration error adds nobody.
  const { data: firm, error: firmError } = await supabase.from("firms").select("name").eq("id", admin.firmId).single();
  if (firmError) return fail(firmError);
  const firmName = firm.name;
  const content = staffAddedEmail({ firmName, adminName: admin.fullName });

  const userId = await ensureUser(parsed.data.email);
  const { error } = await supabase.from("firm_members").insert({
    firm_id: admin.firmId,
    user_id: userId,
    role: parsed.data.role,
    full_name: parsed.data.fullName,
    email: parsed.data.email,
  });
  if (error) return fail(error, { "23505": "This person already belongs to a firm." });

  after(() =>
    sendEmails([{ ...content, to: parsed.data.email, fromName: firmName, replyTo: admin.email }]),
  );

  revalidatePath("/app/settings");
  return { ok: true };
}

export async function changeRole(userId: string, role: "admin" | "staff"): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!isId(userId)) return fail(notFound);
  const parsedRole = roleSchema.safeParse(role);
  if (!parsedRole.success) return invalid(parsedRole.error);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("firm_members")
    .update({ role: parsedRole.data })
    .eq("firm_id", admin.firmId)
    .eq("user_id", userId)
    .neq("user_id", admin.userId)
    .select("user_id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return fail(staleState);

  revalidatePath("/app/settings");
  return { ok: true };
}

export async function removeStaff(userId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!isId(userId)) return fail(notFound);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("firm_members")
    .delete()
    .eq("firm_id", admin.firmId)
    .eq("user_id", userId)
    .neq("user_id", admin.userId)
    .select("user_id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return fail(staleState);

  revalidatePath("/app/settings");
  return { ok: true };
}

/**
 * A staff member (not an admin) leaves the firm, for example after being added by
 * mistake. Returns where to go next: the portal for someone who is also a contact.
 */
export async function leaveFirm(): Promise<ActionResult<{ next: string }>> {
  const staff = await requireStaff();
  if (staff.role !== "staff") {
    return { ok: false, error: "An admin must make you staff before you can leave." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("firm_members")
    .delete()
    .eq("firm_id", staff.firmId)
    .eq("user_id", staff.userId)
    .select("user_id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return fail(staleState);

  return { ok: true, data: { next: (await getContactClientIds()).length > 0 ? "/portal" : "/onboarding" } };
}
