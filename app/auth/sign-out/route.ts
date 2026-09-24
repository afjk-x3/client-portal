import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Signs this device out, then does a full page load of /login. A full load
 * (not a client navigation) drops every page React kept mounted for the
 * previous user. The redirect is relative, so it works on any host.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  const response = new NextResponse(null, { status: 303, headers: { Location: "/login" } });
  if (error) {
    // Auth could not be reached, so the client kept its session cookies. Clear them here.
    console.error("Sign-out failed", error);
    for (const { name } of request.cookies.getAll()) {
      if (name.startsWith("sb-")) response.cookies.delete(name);
    }
  }
  return response;
}
