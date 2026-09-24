export const MAX_FILE_BYTES = 25 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  csv: "text/csv",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

// ponytail: the MIME type is the declared type only, and files are not
// virus-scanned. Upgrade path: add a scanning step before register_file.

/** Must match allowed_mime_types on the documents bucket. */
export const ALLOWED_MIME_TYPES: readonly string[] = [...new Set(Object.values(MIME_BY_EXTENSION))];

/** Value for <input type="file" accept>. */
export const ACCEPT_ATTRIBUTE = Object.keys(MIME_BY_EXTENSION)
  .map((extension) => `.${extension}`)
  .join(",");

/**
 * The declared MIME type to upload a file with, or null when the type is not
 * allowed. Falls back to the extension because browsers often report an empty
 * type (HEIC, CSV on some systems).
 */
export function uploadMimeType(file: { name: string; type: string }): string | null {
  if (ALLOWED_MIME_TYPES.includes(file.type)) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? null;
}

/** Replaces every character outside [A-Za-z0-9._-] with "_" and keeps 100 characters. */
export function sanitizeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 100) || "file";
}

/** {firm_id}/{client_id}/{item_id}/{random uuid}-{safe name} */
export function storagePath(
  ids: { firmId: string; clientId: string; itemId: string },
  filename: string,
  id: string = crypto.randomUUID(),
): string {
  return `${ids.firmId}/${ids.clientId}/${ids.itemId}/${id}-${sanitizeFilename(filename)}`;
}

function zipSafe(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 100) || "untitled";
}

/**
 * Zip entry names "{NN} {item title}/{filename}". Names are sanitized, and
 * duplicates within a folder get " (2)", " (3)", ... before the extension.
 */
export function zipEntryNames(
  entries: { itemNumber: number; itemTitle: string; filename: string }[],
): string[] {
  const used = new Set<string>();
  return entries.map(({ itemNumber, itemTitle, filename }) => {
    const folder = `${String(itemNumber).padStart(2, "0")} ${zipSafe(itemTitle)}`;
    const base = zipSafe(filename);
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const extension = dot > 0 ? base.slice(dot) : "";
    let name = `${folder}/${base}`;
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      name = `${folder}/${stem} (${n})${extension}`;
    }
    used.add(name.toLowerCase());
    return name;
  });
}
