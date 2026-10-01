import { describe, expect, it } from "vitest";
import { imagesToPdf } from "@/lib/pdf";

const FAKE_JPEG = Uint8Array.of(0xff, 0xd8, 1, 2, 3, 0xff, 0xd9);
const latin1 = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

describe("imagesToPdf", () => {
  const tall = { jpeg: FAKE_JPEG, width: 1000, height: 2000 };
  const wide = { jpeg: FAKE_JPEG, width: 2000, height: 1000 };
  const text = latin1(imagesToPdf([tall, wide]));

  it("writes a two-page PDF with a matching page count", () => {
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text.match(/\/Type \/Page\b/g)).toHaveLength(2);
    expect(text.match(/\/Count 2\b/g)).toHaveLength(1);
  });

  it("sizes the page to the photo's orientation", () => {
    expect(text).toContain("/MediaBox [0 0 595 842]");
    expect(text).toContain("/MediaBox [0 0 842 595]");
  });

  it("fits each image inside the 24-point margin, centered", () => {
    const drawn = [...text.matchAll(/q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm \/Im1 Do Q/g)];
    expect(drawn).toHaveLength(2);
    const [first, second] = drawn.map((m) => m.slice(1).map(Number));
    const [a1, d1, e1, f1] = first;
    const [a2, d2, e2, f2] = second;

    // The tall photo: about 397 wide, centered on the 595-wide page.
    expect(Math.abs(a1 - 397)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(e1 * 2 + a1 - 595)).toBeLessThanOrEqual(0.01);

    // Portrait page 595x842, landscape page 842x595: everything within 24 points.
    expect(e1).toBeGreaterThanOrEqual(24 - 0.01);
    expect(f1).toBeGreaterThanOrEqual(24 - 0.01);
    expect(e1 + a1).toBeLessThanOrEqual(595 - 24 + 0.01);
    expect(f1 + d1).toBeLessThanOrEqual(842 - 24 + 0.01);
    expect(e2).toBeGreaterThanOrEqual(24 - 0.01);
    expect(f2).toBeGreaterThanOrEqual(24 - 0.01);
    expect(e2 + a2).toBeLessThanOrEqual(842 - 24 + 0.01);
    expect(f2 + d2).toBeLessThanOrEqual(595 - 24 + 0.01);
  });

  it("points every xref entry at its object", () => {
    const startxref = Number(/startxref\n(\d+)\n%%EOF\s*$/.exec(text)?.[1]);
    expect(startxref).toBeGreaterThan(0);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const header = /^xref\n0 (\d+)\n/.exec(text.slice(startxref));
    expect(header).not.toBeNull();
    const size = Number(header![1]);
    const table = startxref + header![0].length;
    for (let n = 0; n < size; n++) {
      const entry = text.slice(table + 20 * n, table + 20 * (n + 1));
      expect(entry.slice(0, 10)).toMatch(/^\d{10}$/);
      if (n === 0) {
        expect(entry).toMatch(/^0000000000 65535 f /);
        continue;
      }
      expect(text.slice(Number(entry.slice(0, 10)), Number(entry.slice(0, 10)) + `${n} 0 obj`.length)).toBe(
        `${n} 0 obj`,
      );
    }
  });

  it("embeds the JPEG bytes unchanged with a matching length", () => {
    const streams = [...text.matchAll(/\/DCTDecode[\s\S]*?stream\n/g)];
    expect(streams).toHaveLength(2);
    for (const match of streams) {
      expect(match[0].replace(/\nstream\n$/, "")).toContain("/Length 7");
      const at = match.index! + match[0].length;
      for (const [i, byte] of FAKE_JPEG.entries()) {
        expect(text.charCodeAt(at + i)).toBe(byte);
      }
    }
  });
});
