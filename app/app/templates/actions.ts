"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { fail, invalid, notFound, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { templateSchema } from "@/lib/validation";

export async function createTemplate(): Promise<ActionResult> {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("templates")
    .insert({ firm_id: staff.firmId, name: "Untitled template" })
    .select("id")
    .single();
  if (error) return fail(error);

  redirect(`/app/templates/${data.id}`);
}

/** Replaces the template's name and items. Requests already created from it keep their copies. */
export async function saveTemplate(input: z.input<typeof templateSchema>): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { templateId, name, items } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("templates")
    .update({ name })
    .eq("id", templateId)
    .eq("firm_id", staff.firmId)
    .select("id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return fail(notFound);

  const { error: deleteError } = await supabase.from("template_items").delete().eq("template_id", templateId);
  if (deleteError) return fail(deleteError);
  if (items.length > 0) {
    const { error: insertError } = await supabase.from("template_items").insert(
      items.map((item, index) => ({ ...item, template_id: templateId, firm_id: staff.firmId, position: index + 1 })),
    );
    if (insertError) return fail(insertError);
  }

  revalidatePath(`/app/templates/${templateId}`);
  revalidatePath("/app/templates");
  return { ok: true };
}

export async function deleteTemplate(templateId: string): Promise<ActionResult> {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.from("templates").delete().eq("id", templateId).eq("firm_id", staff.firmId);
  if (error) return fail(error);

  redirect("/app/templates");
}
