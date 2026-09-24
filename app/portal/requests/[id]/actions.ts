"use server";

import { revalidatePath } from "next/cache";
import { MAX_FILES_PER_ITEM } from "@/lib/constants";
import { fail, invalid, notFound, type ActionResult } from "@/lib/errors";
import { storagePath } from "@/lib/files";
import { createClient } from "@/lib/supabase/server";
import { filenameSchema, textAnswerSchema } from "@/lib/validation";

function revalidateRequestPages() {
  revalidatePath("/portal/requests/[id]", "page");
  revalidatePath("/portal");
}

/**
 * Section 10.5 step 2. Checks can_write_document explicitly so safety does not
 * depend on when Storage evaluates its insert policy for signed uploads.
 */
export async function createUploadUrl(
  itemId: string,
  filename: string,
): Promise<ActionResult<{ path: string; token: string }>> {
  const name = filenameSchema.safeParse(filename);
  if (!name.success) return invalid(name.error);

  const supabase = await createClient();
  const { data: item } = await supabase
    .from("request_items")
    .select("firm_id, requests(client_id)")
    .eq("id", itemId)
    .maybeSingle();
  if (!item?.requests) return fail(notFound);

  // Refuse before signing: a 21st upload would be rejected by register_file
  // after the object already exists.
  const { count } = await supabase
    .from("item_files")
    .select("id", { count: "exact", head: true })
    .eq("item_id", itemId);
  if ((count ?? 0) >= MAX_FILES_PER_ITEM) {
    return { ok: false, error: `An item can have at most ${MAX_FILES_PER_ITEM} files.` };
  }

  const path = storagePath({ firmId: item.firm_id, clientId: item.requests.client_id, itemId }, name.data);
  const { data: allowed, error } = await supabase.rpc("can_write_document", { name: path });
  if (error) return fail(error);
  if (!allowed) return fail(notFound);

  const { data: signed, error: signError } = await supabase.storage.from("documents").createSignedUploadUrl(path);
  if (signError) return fail(signError);
  return { ok: true, data: { path: signed.path, token: signed.token } };
}

export async function registerFile(itemId: string, path: string, filename: string): Promise<ActionResult> {
  const name = filenameSchema.safeParse(filename);
  if (!name.success) return invalid(name.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("register_file", {
    item_id: itemId,
    storage_path: path,
    filename: name.data,
  });
  if (error) return fail(error);

  revalidateRequestPages();
  return { ok: true };
}

export async function removeFile(fileId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: path, error } = await supabase.rpc("remove_file", { file_id: fileId });
  if (error) return fail(error);

  const { error: storageError } = await supabase.storage.from("documents").remove([path]);
  if (storageError) {
    // ponytail: the object is orphaned when this delete fails after remove_file.
    // Upgrade path: a nightly cleanup of objects that have no item_files row.
    console.error("Storage delete failed after remove_file", storageError);
  }

  revalidateRequestPages();
  return { ok: true };
}

/** File items pass no answer; text items pass the answer. */
export async function submitItem(itemId: string, answer?: string): Promise<ActionResult> {
  let textAnswer: string | undefined;
  if (answer !== undefined) {
    const parsed = textAnswerSchema.safeParse(answer);
    if (!parsed.success) return invalid(parsed.error);
    textAnswer = parsed.data;
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_item", { item_id: itemId, text_answer: textAnswer });
  if (error) return fail(error);

  revalidateRequestPages();
  return { ok: true };
}
