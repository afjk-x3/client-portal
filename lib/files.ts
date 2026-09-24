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

/** Splits "name.ext" into ["name", ".ext"]. A leading dot does not start an extension. */
function splitExtension(name: string): [string, string] {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
}

/** Keeps at most `max` characters, shortening the stem so the extension survives. */
function truncate(name: string, max: number): string {
  const chars = Array.from(name);
  if (chars.length <= max) return name;
  const [stem, extension] = splitExtension(name);
  const extensionLength = Array.from(extension).length;
  if (extensionLength >= max) return chars.slice(0, max).join("");
  return Array.from(stem).slice(0, max - extensionLength).join("") + extension;
}

/**
 * The declared MIME type to upload a file with, or null when the type is not
 * allowed. Falls back to the extension because browsers often report an empty
 * type (HEIC, CSV on some systems).
 */
export function uploadMimeType(file: { name: string; type: string }): string | null {
  if (ALLOWED_MIME_TYPES.includes(file.type)) return file.type;
  const extension = splitExtension(file.name)[1].slice(1).toLowerCase();
  return Object.hasOwn(MIME_BY_EXTENSION, extension) ? MIME_BY_EXTENSION[extension] : null;
}

/** Replaces every character outside [A-Za-z0-9._-] with "_" and keeps 100 characters, extension included. */
export function sanitizeFilename(name: string): string {
  return truncate(name.replace(/[^A-Za-z0-9._-]/g, "_"), 100) || "file";
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
  const safe = truncate(name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim(), 100);
  // Extractors skip "." and "..", which would silently drop the file.
  return safe === "" || safe === "." || safe === ".." ? "untitled" : safe;
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
    const [stem, extension] = splitExtension(base);
    let name = `${folder}/${base}`;
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      name = `${folder}/${stem} (${n})${extension}`;
    }
    used.add(name.toLowerCase());
    return name;
  });
}
