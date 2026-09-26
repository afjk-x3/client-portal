# Photos into One PDF: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the portal, a client turns several phone photos into one PDF, in the order they choose, and uploads it like any file.

**Architecture:** A pure PDF writer in `lib/pdf.ts` embeds JPEGs, one per A4 page, since PDF supports JPEG natively. A "Scan pages" dialog in the portal prepares each photo on a canvas and hands the finished PDF to the item's existing upload queue. The server, the database, and the file rules do not change, and no dependency is added.

**Tech Stack:** Next.js 16 client components, Canvas and `createImageBitmap`, Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-26-scan-pages-design.md`](../specs/2026-09-26-scan-pages-design.md)

**Build order:** 11 of 12, after [recurring requests](2026-09-26-recurring-requests.md). Next: [messages on an item](2026-09-26-item-messages.md).

**Commands:** as in the backlog plan's [How to run things](2026-09-25-paperline-backlog.md#how-to-run-things-windows).

**Execution:** Native, chosen by the user on 2026-09-26. One session implements this plan's tasks in order (superpowers:executing-plans), then one fresh reviewer checks this plan's diff before the next plan starts. Start only when the user says so.

## Global Constraints

- Pages are A4: 595 × 842 points, or 842 × 595 when the photo is wider than tall. The image is centered and scaled to fit within a 24-point margin, without cropping.
- Photos are resized to at most 2,000 pixels on the long side and saved with `toBlob("image/jpeg", 0.85)`, keeping their orientation. Only the resulting JPEGs are kept in memory.
- A PDF has at most 30 pages, and must be `MAX_FILE_BYTES` (25 MB) or smaller. It is named "{item title}.pdf", with the type `application/pdf`, and counts once toward the 20-file limit.
- Copy, verbatim: "Scan pages"; "Add photos"; "Page {n}"; "Move page {n} up", "Move page {n} down", "Remove page {n}"; "Create PDF" and "Creating…"; "Discard {n} pages?"; the three error messages in spec §5.
- No new npm packages. One Conventional Commit per task, with no AI attribution lines. Do not push.

## Review Focus

1. **A photo the browser cannot decode**, such as HEIC on desktop Chrome, is skipped with its named toast, and the other photos stay. Pinned in Task 2 (browser test with a corrupt `broken.png`).
2. **The 31st photo** is refused with "A PDF can have at most 30 pages." and 30 pages remain. Pinned in Task 2 (browser test).
3. **Closing the dialog by accident** with pages asks "Discard {n} pages?" before losing them. Pinned in Task 2 (browser test).
4. **A tall photo and a wide photo in one PDF** each get a matching page orientation and stay inside the margins. Pinned in Task 1 (unit test).
5. **Reordering** is reflected in the final page order. Pinned in Task 2 (browser test, via the thumbnails' alt text before Create PDF).

---

### Task 1: The PDF writer

**Files:**
- Create: `lib/pdf.ts`, `lib/pdf.test.ts`

**Interfaces:**
- Produces: `imagesToPdf(pages: { jpeg: Uint8Array; width: number; height: number }[]): Uint8Array`.

- [ ] **Step 1: Write the failing unit tests** `lib/pdf.test.ts`. Decode the output with `new TextDecoder("latin1")` so offsets match bytes. Use fake JPEG bytes (`Uint8Array.of(0xff, 0xd8, 1, 2, 3, 0xff, 0xd9)`); the writer does not parse them.
  - For two pages (1000 × 2000, then 2000 × 1000), the text starts with `%PDF-1.4`, trimmed it ends with `%%EOF`, `/Type /Page\b` appears twice, and `/Count 2` once.
  - The first page's `/MediaBox [0 0 595 842]` and the second's `/MediaBox [0 0 842 595]`.
  - Parse each content stream's `q a 0 0 d e f cm /Im… Do Q` numbers:
    - the first page draws about 397 × 794 at (99, 24): `a` within 0.01 of 397, and `e * 2 + a` within 0.01 of 595;
    - on both pages, the image lies within the 24-point margin.
  - Every entry in the `xref` table, after the free entry, holds a 10-digit offset at which the text reads `{n} 0 obj`.
  - The fake JPEG bytes appear unchanged after each image's `stream\n`, and each `/Length` equals 7.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run lib/pdf.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `imagesToPdf`**, following spec §4. Object 1 is the catalog and object 2 the page tree. Each page gets three objects: the page, its image (`/Type /XObject /Subtype /Image /Width /Height /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length`), and its content stream. Build the file as `Uint8Array` chunks, tracking byte offsets for the `xref` table: 20-byte entries, `%010d 00000 n \n`. Write numbers with at most two decimals.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run lib/pdf.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/pdf.ts lib/pdf.test.ts
git commit -m "feat: add a PDF writer that places one JPEG per A4 page"
```

---

### Task 2: The Scan pages dialog

**Files:**
- Create: `app/portal/requests/[id]/scan.ts` (photo preparation, browser-only)
- Create: `app/portal/requests/[id]/scan-dialog.tsx`
- Modify: `app/portal/requests/[id]/item-card.tsx`
- Create: `e2e/scan-pages.spec.ts`
- Modify: `README.md`, `docs/superpowers/specs/2026-09-24-client-portal-design.md` (§10.5)

**Interfaces:**
- Consumes: `imagesToPdf` (Task 1); `MAX_FILE_BYTES` from `lib/files.ts`.
- Produces:
  - `ScanPage = { jpeg: Uint8Array; width: number; height: number; url: string; name: string }`, where `url` is an object URL for the thumbnail, revoked on remove and close;
  - `preparePhoto(file: File): Promise<ScanPage>`, which rejects when the browser cannot decode the photo;
  - `ScanDialog({ itemTitle, onPdf }: { itemTitle: string; onPdf: (file: File) => void })`.

- [ ] **Step 1: Write the failing browser test** `e2e/scan-pages.spec.ts`. Build tiny PNGs in the test, for example with the page's canvas through `page.evaluate`, returning a base64 PNG for a red and a blue square.
  - Test "scan two photos into one PDF":
    1. The contact opens a request's file item "Bank statement" and clicks "Scan pages".
    2. They add `red.png` and `blue.png` through the dialog's file input. The thumbnails' alt text reads "Page 1: red.png", then "Page 2: blue.png".
    3. Click "Move page 2 up": the order is blue, red.
    4. Click "Create PDF". The item's file list shows "Bank statement.pdf".
    5. Its download starts with `%PDF-` and contains `/Count 2`.
  - Test "limits and mistakes":
    1. Adding a corrupt `broken.png` (random bytes) shows the toast "broken.png: this photo can't be read here. Take a new photo, or upload it with Choose files.", and the page list stays empty.
    2. Adding 31 copies of `red.png` in one pick shows "A PDF can have at most 30 pages." and 30 thumbnails.
    3. Pressing Escape asks "Discard 30 pages?". "Cancel" keeps the dialog open.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test e2e/scan-pages.spec.ts`
Expected: FAIL, because there is no "Scan pages" button.

- [ ] **Step 3: Implement**
  - `preparePhoto`: `createImageBitmap(file)`, scaled so the long side is at most 2,000 pixels, drawn on a `<canvas>`, then `toBlob("image/jpeg", 0.85)`. Returns the bytes, the canvas size, `URL.createObjectURL(blob)`, and `file.name`. Close the bitmap after drawing.
  - `ScanDialog`:
    - A `Dialog` titled "Scan pages", with the item title as its description, opened by an outline "Scan pages" button (icon `Camera`).
    - A visually hidden `<input type="file" accept="image/*" multiple>` behind "Add photos". It prepares photos one at a time, toasting the decode error per photo and stopping at 30 with the limit toast.
    - The list shows each thumbnail (`alt="Page {n}: {name}"`), with "Move up" (aria-label "Move page {n} up"), "Move down", and "Remove".
    - "Create PDF" is disabled with no pages and shows "Creating…". It builds `new File([imagesToPdf(pages)], `${itemTitle}.pdf`, { type: "application/pdf" })`. Over `MAX_FILE_BYTES`, it shows the size error (spec §5) and stays open. Otherwise it calls `onPdf(file)`, clears the pages, and closes.
    - Closing with pages opens an AlertDialog, "Discard {n} pages?", with "Cancel" and "Discard".
  - In `FileItem`, render `<ScanDialog>` under the drop area, under the same condition as the area (`editable && room > 0`). `onPdf` feeds the file through the same path as `addFiles`, so it gets the upload queue, Retry, and Dismiss.
  - Docs: in v1 spec §10.5, "Scan pages" joins photos into one PDF in the browser before the usual upload. Mention scanning in the README.

- [ ] **Step 4: Run the tests**

Run: `npx playwright test e2e/scan-pages.spec.ts e2e/portal-and-review.spec.ts`, `npm run typecheck`, `npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/portal/requests/[id] e2e/scan-pages.spec.ts README.md docs/superpowers/specs/2026-09-24-client-portal-design.md
git commit -m "feat: let clients scan photos into one PDF in the portal"
```

---

## Finish

Run every suite once: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e`. Then check `git status` for a clean tree. Before release, try it once on a real phone, iPhone and Android if possible, with photos from the camera and the gallery.
