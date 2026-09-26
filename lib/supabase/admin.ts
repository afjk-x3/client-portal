import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Service-role client. It bypasses RLS, so only three callers may use it:
 * the two cron routes and ensureUser() below.
 */
export function createAdminClient() {
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Returns the auth user id for an email, creating a confirmed user when none
 * exists. Sends no email. Callers must confirm the caller's role first.
 */
export async function ensureUser(email: string): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (data.user) return data.user.id;
  if (error?.code !== "email_exists") throw error ?? new Error("createUser returned no user");

  const { data: userId, error: lookupError } = await admin.rpc("admin_user_id_by_email", { email });
  if (lookupError || !userId) throw lookupError ?? new Error("admin_user_id_by_email found no user");
  return userId;
}
