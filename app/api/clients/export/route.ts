import { NextRequest, NextResponse } from "next/server";
import { getStaff } from "@/lib/auth";
import { spreadsheetSafe, toCsv } from "@/lib/csv";
import { todayIn } from "@/lib/dates";
import { LIST_PAGE_SIZE, parseClientFilters } from "@/lib/list-params";
import { createClient } from "@/lib/supabase/server";

const HEADER = ["client_name", "client_type", "contact_name", "contact_email"];

/** The client list as CSV, in the import's own columns. Admins only, 404 for everyone else. */
export async function GET(request: NextRequest) {
  const staff = await getStaff();
  if (!staff || staff.role !== "admin") return new NextResponse("Not found", { status: 404 });

  try {
    const filters = parseClientFilters(Object.fromEntries(request.nextUrl.searchParams));
    const supabase = await createClient();

    const clients: { id: string; name: string; kind: string }[] = [];
    for (let page = 1; ; page++) {
      const { data, error } = await supabase.rpc("list_clients", {
        q: filters.q,
        owner: filters.owner ?? undefined,
        kind: filters.kind ?? undefined,
        include_archived: filters.archived,
        page,
      });
      if (error) throw error;
      clients.push(...data);
      if (data.length < LIST_PAGE_SIZE) break;
    }

    const contactsByClient = new Map<string, { full_name: string; email: string }[]>();
    for (let i = 0; i < clients.length; i += 200) {
      const chunk = clients.slice(i, i + 200).map((client) => client.id);
      const { data, error } = await supabase
        .from("client_contacts")
        .select("client_id, full_name, email")
        .in("client_id", chunk)
        .order("full_name");
      if (error) throw error;
      for (const contact of data) {
        const list = contactsByClient.get(contact.client_id) ?? [];
        list.push(contact);
        contactsByClient.set(contact.client_id, list);
      }
    }

    const rows = clients.flatMap((client) => {
      const contacts = contactsByClient.get(client.id);
      if (!contacts?.length) return [[spreadsheetSafe(client.name), client.kind, "", ""]];
      return contacts.map((contact) => [
        spreadsheetSafe(client.name),
        client.kind,
        spreadsheetSafe(contact.full_name),
        spreadsheetSafe(contact.email),
      ]);
    });

    return new NextResponse(`\uFEFF${toCsv([HEADER, ...rows])}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="clients-${todayIn(staff.timeZone)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(error);
    return new NextResponse("Export failed", { status: 500 });
  }
}
