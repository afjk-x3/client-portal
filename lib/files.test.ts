import { describe, expect, it } from "vitest";
import { sanitizeFilename, storagePath, uploadMimeType, zipEntryNames } from "@/lib/files";

describe("sanitizeFilename", () => {
  it("keeps safe characters", () => {
    expect(sanitizeFilename("W-2_2026.final.pdf")).toBe("W-2_2026.final.pdf");
  });

  it("replaces everything outside [A-Za-z0-9._-]", () => {
    expect(sanitizeFilename("my tax/return (1)é.pdf")).toBe("my_tax_return__1__.pdf");
  });

  it("keeps at most 100 characters without losing the extension", () => {
    const safe = sanitizeFilename(`${"a".repeat(150)}.pdf`);
    expect(safe).toHaveLength(100);
    expect(safe.endsWith(".pdf")).toBe(true);
  });

  it("never returns an empty name", () => {
    expect(sanitizeFilename("")).toBe("file");
  });
});

describe("storagePath", () => {
  it("builds {firm}/{client}/{item}/{uuid}-{safe name}", () => {
    expect(storagePath({ firmId: "f", clientId: "c", itemId: "i" }, "a b.pdf", "u")).toBe("f/c/i/u-a_b.pdf");
  });
});

describe("uploadMimeType", () => {
  it("uses an allowed declared type", () => {
    expect(uploadMimeType({ name: "scan.pdf", type: "application/pdf" })).toBe("application/pdf");
  });

  it("falls back to the extension when the type is empty", () => {
    expect(uploadMimeType({ name: "IMG_0001.HEIC", type: "" })).toBe("image/heic");
  });

  it("rejects other types", () => {
    expect(uploadMimeType({ name: "run.exe", type: "application/x-msdownload" })).toBeNull();
  });

  it.each(["x.constructor", "x.__proto__", "pdf", ".pdf"])("rejects %j", (name) => {
    expect(uploadMimeType({ name, type: "" })).toBeNull();
  });
});

describe("zipEntryNames", () => {
  it("numbers folders and suffixes duplicate names", () => {
    expect(
      zipEntryNames([
        { itemNumber: 1, itemTitle: "Photo ID", filename: "scan.pdf" },
        { itemNumber: 1, itemTitle: "Photo ID", filename: "scan.pdf" },
        { itemNumber: 12, itemTitle: "W-2 / 1099", filename: "a:b.pdf" },
      ]),
    ).toEqual(["01 Photo ID/scan.pdf", "01 Photo ID/scan (2).pdf", "12 W-2 _ 1099/a_b.pdf"]);
  });

  it("keeps the extension of long names and never uses . or ..", () => {
    const [long, dots] = zipEntryNames([
      { itemNumber: 1, itemTitle: "Statements", filename: `${"s".repeat(120)}.pdf` },
      { itemNumber: 1, itemTitle: "Statements", filename: ".." },
    ]);
    expect(long).toBe(`01 Statements/${"s".repeat(96)}.pdf`);
    expect(dots).toBe("01 Statements/untitled");
  });

  it("avoids names Windows cannot create", () => {
    expect(
      zipEntryNames([
        { itemNumber: 7, itemTitle: "Anything else we should know.", filename: "notes." },
        { itemNumber: 7, itemTitle: "Anything else we should know.", filename: "CON.pdf" },
        { itemNumber: 7, itemTitle: "Anything else we should know.", filename: `${"s".repeat(99)} tail` },
      ]),
    ).toEqual([
      "07 Anything else we should know/notes",
      "07 Anything else we should know/_CON.pdf",
      `07 Anything else we should know/${"s".repeat(99)}`,
    ]);
  });
});
