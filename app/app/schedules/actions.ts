"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { todayIn } from "@/lib/dates";
import { fail, invalid, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { scheduleSchema } from "@/lib/validation";

export async function saveSchedule(input: z.input<typeof scheduleSchema>): Promise<ActionResult<{ id: string }>> {
  const staff = await requireStaff();
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { scheduleId, templateId, title, everyMonths, nextSendOn, dueAfterDays, clientIds } = parsed.data;

  if (nextSendOn && nextSendOn <= todayIn(staff.timeZone)) {
    return { ok: false, error: "Pick a date after today." };
  }

  const supabase = await createClient();
  // Both are nullable in Postgres; the generated types require a string.
  const { data, error } = await supabase.rpc("save_schedule", {
    schedule_id: (scheduleId ?? null) as string,
    template_id: templateId,
    title,
    every_months: everyMonths,
    next_send_on: (nextSendOn ?? null) as string,
    due_after_days: dueAfterDays,
    client_ids: clientIds,
  });
  if (error) return fail(error);

  revalidatePath("/app/schedules");
  return { ok: true, data: { id: data } };
}
