import type { PostgrestResponse } from "@supabase/supabase-js";

// PostgREST cuts responses off at max_rows (1000 by default) without an error. A page larger
// than max_rows would come back short and end the read early (see the README).
export const PAGE_SIZE = 1000;
export const NIL_UUID = "00000000-0000-0000-0000-000000000000"; // sorts before every generated id

/**
 * Every row of a query, a page at a time. Each page starts after the previous
 * page's last row (keyset paging), so rows that change during the read cannot
 * shift others into a second page or out of both. Callers type `last` with the
 * key columns they page by.
 */
export async function readAll<Row>(page: (last: Row | undefined) => PromiseLike<PostgrestResponse<Row>>): Promise<Row[]> {
  const rows: Row[] = [];
  for (;;) {
    const { data, error } = await page(rows.at(-1));
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}
