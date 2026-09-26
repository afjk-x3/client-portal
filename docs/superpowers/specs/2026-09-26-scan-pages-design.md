# Photos into One PDF: Design Spec

- **Date:** 2026-09-26
- **Status:** Design approved in conversation, section by section, on 2026-09-26
- **Builds on:** [`2026-09-24-client-portal-design.md`](2026-09-24-client-portal-design.md) (the v1 spec: uploads in §10.5)

## 1. Summary

Clients often photograph a multi-page document, such as a 6-page bank statement, with their phone. Today each photo is a separate file: staff open them one by one, the 20-file limit fills quickly, and pages can arrive out of order.

With this feature, a client taps "Scan pages" on a file item, adds photos from the camera or gallery, puts them in order, and creates one PDF. The browser builds the PDF, and it uploads like any other file.

### Success criteria

- A client turns several phone photos into one PDF, in the order they choose, and uploads it from the portal.
- Staff receive one file, "{item title}.pdf", with one readable A4 page per photo.
- The server, the database, and the file rules do not change, and no dependency is added.

## 2. Decisions

| Topic | Decision |
|---|---|
| Entry point | A "Scan pages" button on each file item in the portal. "Choose files" works as today. |
| Pages | A4, portrait or landscape to match each photo, which is fitted without cropping |
| Photos | Resized to at most 2,000 pixels on the long side and saved as JPEG, keeping their orientation. Their metadata, such as location, is dropped. |
| Limit | 30 pages. The PDF is one file: it counts once toward the 20-file limit and must be 25 MB or smaller. |
| PDF writing | A small writer of our own in `lib/pdf.ts`. PDF embeds JPEG natively, so no library is needed. |
| Who | Contacts in the portal. Staff uploads do not change. |

## 3. Scan dialog

### 3.1 Button

A "Scan pages" button, with a camera icon, sits under the "Choose files" area of each file item. It shows under the same conditions as that area: the portal is editable and the item has room for another file.

### 3.2 Dialog

The button opens a dialog titled "Scan pages", with the item's title under the heading.

- **Add photos:** a button that opens `<input type="file" accept="image/*" multiple>`, which on a phone offers the camera or the gallery. Clients can add photos several times.
- **Preparing each photo** happens as it is added, one photo at a time: the browser decodes it (`createImageBitmap`, which applies the photo's orientation), draws it on a canvas at most 2,000 pixels on its long side, and saves it with `toBlob("image/jpeg", 0.85)`. Only these JPEGs are kept, so 30 photos fit in a phone's memory.
- **Page list:** numbered thumbnails, "Page 1", "Page 2", and so on. Each has "Move up", "Move down", and "Remove", labeled for screen readers, for example "Move page 2 up".
- **Create PDF:** disabled until there is a page, and shows "Creating…" while it works. It calls `imagesToPdf` (§4), wraps the bytes in a `File` named "{item title}.pdf" with the type `application/pdf`, closes the dialog, and adds the file to the item's upload queue. From there it behaves like any file: "Uploading…", then the file list, or an error with Retry and Dismiss.
- **Closing** with pages asks "Discard {n} pages?" in an AlertDialog. Closing without pages just closes.

## 4. PDF writer: `lib/pdf.ts`

`imagesToPdf(pages: { jpeg: Uint8Array; width: number; height: number }[]): Uint8Array` is a pure function with no browser APIs.

- It writes a PDF 1.4 file: the header, a catalog, a page tree with `/Count` equal to the number of pages, then for each page:
  - a page object with an A4 `/MediaBox`: 595 × 842 points, or 842 × 595 when the photo is wider than tall;
  - an image object holding the JPEG bytes unchanged, with `/Filter /DCTDecode`, `/ColorSpace /DeviceRGB`, `/BitsPerComponent 8`, and the photo's width and height (a canvas always saves RGB JPEGs);
  - a content stream that draws the image centered, scaled to fit within a 24-point margin, without cropping.
- It ends with the cross-reference table, the trailer, `startxref`, and `%%EOF`.

## 5. Errors

| Case | What the client sees |
|---|---|
| A photo the browser can't read, such as a HEIC photo in desktop Chrome | A toast, "{name}: this photo can't be read here. Take a new photo, or upload it with Choose files.", and the photo is skipped |
| More than 30 pages | A toast, "A PDF can have at most 30 pages.", and the extra photos are not added |
| A PDF over 25 MB | "This PDF is over 25 MB. Remove some pages, or scan the rest separately." The dialog stays open. |
| An upload failure | The existing error with Retry and Dismiss |

## 6. Tests

- **Unit, `lib/pdf.test.ts`:**
  - The output starts with `%PDF-1.4`, ends with `%%EOF`, and has one page per image, with `/Count` to match.
  - A tall photo gets a portrait page and a wide one a landscape page, and each image is drawn inside the margins, centered.
  - Every cross-reference entry points at the start of its object (`{n} 0 obj`).
  - Each image's JPEG bytes appear unchanged, with a `/Length` that matches.
- **Browser:** a contact opens Scan pages on a file item, adds two images, moves page 2 up, and creates the PDF. The item then lists "{item title}.pdf", and its download starts with `%PDF-` and has `/Count 2`.
- **Database:** none; nothing changes there.

## 7. Other changes

- v1 spec §10.5: mention that "Scan pages" joins photos into one PDF in the browser before the usual upload.
- README: mention scanning in the feature description.

## 8. Out of scope

- Scanning for staff.
- Cropping, rotating, straightening, and black-and-white filters.
- Text recognition.
- Combining files already uploaded.
