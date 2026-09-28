import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

const CHUNK = 100;

export type CleanupSummary = { expired: number; found: number; deleted: number; failed: number };

/**
 * First deletes file records past their firm's retention period (the orphan
 * step then takes their stored objects in this same run), then stored documents
 * that no item_files row points to, through the Storage API so the bytes go too.
 * At most `maxRows` per run; the next run continues.
 */
export async function runCleanup(
  admin: SupabaseClient<Database>,
  { olderThan = "24 hours", maxRows = 1000 }: { olderThan?: string; maxRows?: number } = {},
): Promise<CleanupSummary> {
  const { data: expired, error } = await admin.rpc("expire_files", { max_rows: maxRows });
  if (error) throw error;
  const { data: names, error: orphanError } = await admin.rpc("orphaned_documents", {
    older_than: olderThan,
    max_rows: maxRows,
  });
  if (orphanError) throw orphanError;
  let deleted = 0;
  for (let i = 0; i < names.length; i += CHUNK) {
    const { data, error: removeError } = await admin.storage.from("documents").remove(names.slice(i, i + CHUNK));
    if (removeError) console.error("[cleanup] delete failed", removeError);
    else deleted += data.length;
  }
  return { expired, found: names.length, deleted, failed: names.length - deleted };
}
