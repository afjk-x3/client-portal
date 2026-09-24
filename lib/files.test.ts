import { describe, expect, it } from "vitest";
import { sanitizeFilename, storagePath, uploadMimeType, zipEntryNames } from "@/lib/files";

describe("sanitizeFilename", () => {
  it("keeps safe characters", () => {
    expect(sanitizeFilename("W-2_2026.final.pdf")).toBe("W-2_2026.final.pdf");
  });

  it("replaces everything outside [A-Za-z0-9._-]", () => {
    expect(sanitizeFilename("my tax/return (1)é.pdf")).toBe("my_tax_return__1__.pdf");
  });

  it("truncates to 100 characters", () => {
    expect(sanitizeFilename(`${"a".repeat(150)}.pdf`)).toHaveLength(100);
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
});
