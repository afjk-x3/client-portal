import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Redirects to a 60-second signed URL. RLS on item_files and storage.objects
 * decides access; anything the caller cannot see is a 404, never a 403.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/files/[id]">) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: file } = await supabase.from("item_files").select("storage_path, filename").eq("id", id).maybeSingle();
  if (!file) return new NextResponse("Not found", { status: 404 });

  const download = request.nextUrl.searchParams.get("download") === "1";
  const { data, error } = await supabase.storage
    .from("documents")
    .createSignedUrl(file.storage_path, 60, download ? { download: file.filename } : undefined);
  if (error) return new NextResponse("Not found", { status: 404 });

  return NextResponse.redirect(data.signedUrl);
}
