"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { fail, invalid, notFound, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { isId, templateSchema } from "@/lib/validation";

export async function createTemplate(): Promise<ActionResult> {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("templates")
    .insert({ firm_id: staff.firmId, name: "Untitled template" })
    .select("id")
    .single();
  if (error) return fail(error);

  revalidatePath("/app/templates");
  redirect(`/app/templates/${data.id}`);
}

/**
 * Replaces the template's name and items in one transaction (`save_template`), so a
 * failure changes nothing and two saves never merge. Requests keep their own copies.
 */
export async function saveTemplate(input: z.input<typeof templateSchema>): Promise<ActionResult> {
  await requireStaff();
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { templateId, name, items } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_template", { template_id: templateId, name, items });
  if (error) return fail(error);

  revalidatePath(`/app/templates/${templateId}`);
  revalidatePath("/app/templates");
  return { ok: true };
}

export async function deleteTemplate(templateId: string): Promise<ActionResult> {
  const staff = await requireStaff();
  if (!isId(templateId)) return fail(notFound);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("templates")
    .delete()
    .eq("id", templateId)
    .eq("firm_id", staff.firmId)
    .select("id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return fail(notFound);

  revalidatePath("/app/templates");
  redirect("/app/templates");
}
