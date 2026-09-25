"use server";

import { redirect } from "next/navigation";
import { fail, invalid, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { onboardingSchema } from "@/lib/validation";

export async function createFirm(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = onboardingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_firm", {
    name: parsed.data.firmName,
    full_name: parsed.data.fullName,
    time_zone: parsed.data.timeZone,
  });
  if (error) return fail(error, { P0001: "You already belong to a firm." });

  redirect("/app");
}
