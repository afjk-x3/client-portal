import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isId } from "@/lib/validation";

/**
 * Redirects to a 60-second signed URL. RLS on item_files and storage.objects
 * decides access; anything the caller cannot see is a 404, never a 403.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/files/[id]">) {
  const { id } = await ctx.params;
  if (!isId(id)) return new NextResponse("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: file, error: fileError } = await supabase
    .from("item_files")
    .select("storage_path, filename")
    .eq("id", id)
    .maybeSingle();
  if (fileError) throw fileError;
  if (!file) return new NextResponse("Not found", { status: 404 });

  const { data, error } = await supabase.storage.from("documents").createSignedUrl(file.storage_path, 60);
  if (error) return new NextResponse("Not found", { status: 404 });

  const url = new URL(data.signedUrl);
  // Set here rather than through createSignedUrl's `download` option, which
  // encodes the name twice ("Scan (1).pdf" would save as "Scan %281%29.pdf").
  if (request.nextUrl.searchParams.get("download") === "1") url.searchParams.set("download", file.filename);
  return NextResponse.redirect(url);
}
