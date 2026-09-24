import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";

/** User-scoped client for Client Components. RLS applies. */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
