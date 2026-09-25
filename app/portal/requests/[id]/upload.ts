import { MAX_FILE_BYTES, uploadMimeType } from "@/lib/files";
import { createClient } from "@/lib/supabase/client";
import { createUploadUrl, registerFile } from "./actions";

/** Why a file can never be uploaded (so retrying cannot help), or null. */
export function rejection(file: File): string | null {
  if (!uploadMimeType(file)) return `${file.name}: this file type is not accepted.`;
  if (file.size > MAX_FILE_BYTES) return `${file.name}: files must be 25 MB or smaller.`;
  return null;
}

/**
 * Section 10.5: create a signed URL, upload straight to Storage, then register
 * the file. Returns an error message, or null when the file is registered.
 * Contacts upload in the portal, and staff on the request page.
 */
export async function uploadFile(itemId: string, file: File): Promise<string | null> {
  const type = uploadMimeType(file)!;
  const created = await createUploadUrl(itemId, file.name);
  if (!created.ok) return created.error;
  const { path, token } = created.data!;

  const storage = createClient().storage.from("documents");
  const body = type === file.type ? file : new File([file], file.name, { type });
  const { error } = await storage.uploadToSignedUrl(path, token, body, { contentType: type });
  if (error) return "Upload failed. Check your connection and retry.";

  const registered = await registerFile(itemId, path, file.name);
  if (registered.ok) return null;
  // The object is not registered, so the uploader may still delete it; a retry uploads it again.
  // ponytail: the object is orphaned if this delete fails too. Upgrade path: a nightly
  // cleanup of objects that have no item_files row.
  await storage.remove([path]);
  return registered.error;
}
