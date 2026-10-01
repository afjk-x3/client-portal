/**
 * A PDF 1.4 writer: one JPEG per A4 page, centered in a 24-point margin.
 * PDF embeds JPEG natively (/DCTDecode), so the bytes go in unchanged.
 * Pure, no browser APIs.
 */

const PORTRAIT: [number, number] = [595, 842];
const LANDSCAPE: [number, number] = [842, 595];
const MARGIN = 24;
const encoder = new TextEncoder();

/** At most two decimals, so offsets in the xref table stay predictable. */
const num = (x: number) => String(Number(x.toFixed(2)));

export function imagesToPdf(pages: { jpeg: Uint8Array; width: number; height: number }[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const write = (data: Uint8Array) => {
    chunks.push(data);
    offset += data.length;
  };
  const text = (value: string) => write(encoder.encode(value));

  // Object 1 is the catalog, object 2 the page tree; each page adds three more.
  const offsets: number[] = [];
  text("%PDF-1.4\n");
  offsets[1] = offset;
  text("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  offsets[2] = offset;
  const kids = pages.map((_, i) => `${3 + 3 * i} 0 R`).join(" ");
  text(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`);

  pages.forEach((page, i) => {
    const landscape = page.width > page.height;
    const [pageWidth, pageHeight] = landscape ? LANDSCAPE : PORTRAIT;
    const scale = Math.min((pageWidth - 2 * MARGIN) / page.width, (pageHeight - 2 * MARGIN) / page.height);
    const width = Number((page.width * scale).toFixed(2));
    const height = Number((page.height * scale).toFixed(2));
    const x = (pageWidth - width) / 2;
    const y = (pageHeight - height) / 2;

    const pageObj = 3 + 3 * i;
    const imageObj = pageObj + 1;
    const contentObj = pageObj + 2;

    offsets[pageObj] = offset;
    text(
      `${pageObj} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
        `/Resources << /XObject << /Im1 ${imageObj} 0 R >> >> /Contents ${contentObj} 0 R >>\nendobj\n`,
    );

    offsets[imageObj] = offset;
    text(
      `${imageObj} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
    );
    write(page.jpeg);
    text("\nendstream\nendobj\n");

    const content = `q ${num(width)} 0 0 ${num(height)} ${num(x)} ${num(y)} cm /Im1 Do Q\n`;
    offsets[contentObj] = offset;
    text(`${contentObj} 0 obj\n<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream\nendobj\n`);
  });

  const size = 2 + 3 * pages.length + 1;
  const startxref = offset;
  text(`xref\n0 ${size}\n`);
  text("0000000000 65535 f \n");
  for (let object = 1; object < size; object++) {
    text(`${String(offsets[object]).padStart(10, "0")} 00000 n \n`);
  }
  text(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`);

  const pdf = new Uint8Array(offset);
  let at = 0;
  for (const chunk of chunks) {
    pdf.set(chunk, at);
    at += chunk.length;
  }
  return pdf;
}
