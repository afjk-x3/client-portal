/** Photo preparation for Scan pages, browser-only: decode, shrink, JPEG. */

const LONG_SIDE = 2000;
const JPEG_QUALITY = 0.85;

export type ScanPage = { jpeg: Uint8Array; width: number; height: number; url: string; name: string };

/**
 * Prepares one photo: the browser decodes it (applying its orientation), draws
 * it at most 2,000 pixels on the long side, and saves it as JPEG. Rejects when
 * the photo cannot be read here, such as HEIC in desktop Chrome.
 */
export async function preparePhoto(file: File): Promise<ScanPage> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, LONG_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("Could not encode the photo"))), "image/jpeg", JPEG_QUALITY),
    );
    return {
      jpeg: new Uint8Array(await blob.arrayBuffer()),
      width,
      height,
      url: URL.createObjectURL(blob),
      name: file.name,
    };
  } finally {
    bitmap.close();
  }
}
