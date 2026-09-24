import { NextResponse } from "next/server";
import { downloadZip } from "client-zip";
import { getStaff } from "@/lib/auth";
import { zipEntryNames } from "@/lib/files";
import { createClient } from "@/lib/supabase/server";

// ponytail: zip size is limited by the 300-second function duration.
// Upgrade path: download files individually, or build zips in a background job.
export const maxDuration = 300;

/** Streams every file of a request as one zip. Staff of the request's firm only. */
export async function GET(_request: Request, ctx: RouteContext<"/api/requests/[id]/zip">) {
  const { id } = await ctx.params;
  const staff = await getStaff();
  if (!staff) return new NextResponse("Not found", { status: 404 });

  const supabase = await createClient();
  const { data: request } = await supabase
    .from("requests")
    .select("title, request_items(position, title, item_files(storage_path, filename, created_at))")
    .eq("id", id)
    .eq("firm_id", staff.firmId)
    .order("position", { referencedTable: "request_items" })
    .order("id", { referencedTable: "request_items" })
    .order("created_at", { referencedTable: "request_items.item_files" })
    .maybeSingle();
  if (!request) return new NextResponse("Not found", { status: 404 });

  const files = request.request_items.flatMap((item, index) =>
    item.item_files.map((file) => ({ ...file, itemNumber: index + 1, itemTitle: item.title })),
  );
  const names = zipEntryNames(files);

  let signedUrls: string[] = [];
  if (files.length > 0) {
    const { data, error } = await supabase.storage.from("documents").createSignedUrls(
      files.map((file) => file.storage_path),
      maxDuration,
    );
    if (error) throw error;
    signedUrls = data.map((entry) => entry.signedUrl ?? "");
  }

  async function* entries() {
    for (const [index, file] of files.entries()) {
      const response = await fetch(signedUrls[index]);
      if (!response.ok || !response.body) throw new Error(`Could not fetch ${file.storage_path}`);
      yield { name: names[index], input: response, lastModified: new Date(file.created_at) };
    }
  }

  const zipName = `${request.title.replace(/[^A-Za-z0-9 ._-]/g, "_").trim() || "request"}.zip`;
  return new Response(downloadZip(entries()).body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipName}"`,
    },
  });
}
