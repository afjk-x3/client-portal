"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { sendEmails } from "@/lib/email/send";
import { staffAddedEmail } from "@/lib/email/templates";
import { fail, invalid, notFound, staleState, type ActionResult } from "@/lib/errors";
import { ensureUser } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { firmNameSchema, staffSchema } from "@/lib/validation";

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
  const { data: firm } = await supabase.from("firms").select("name").eq("id", admin.firmId).single();
  const firmName = firm?.name ?? "";
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
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("firm_members")
    .update({ role })
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
