"use server";

import { requireStaff } from "@/lib/auth";
import { fail, invalid, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { clientSchema } from "@/lib/validation";

export async function addClient(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const staff = await requireStaff();
  const parsed = clientSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .insert({
      firm_id: staff.firmId,
      name: parsed.data.name,
      kind: parsed.data.kind,
      owner_id: parsed.data.ownerId,
    })
    .select("id")
    .single();
  if (error) return fail(error);

  return { ok: true, data: { id: data.id } };
}
