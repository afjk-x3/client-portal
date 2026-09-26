import { describe, expect, it } from "vitest";
import { decodeUtf8, parseCsv } from "@/lib/csv";

describe("parseCsv", () => {
  it("splits records and fields", () => {
    expect(parseCsv("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("reads quoted fields with commas, escaped quotes, and line breaks", () => {
    expect(parseCsv('"Rivera, Alex","say ""hi""","two\nlines"')).toEqual([["Rivera, Alex", 'say "hi"', "two\nlines"]]);
  });

  it("handles CRLF, a byte-order mark, a blank line, and a final newline", () => {
    expect(parseCsv("﻿a,b\r\n\r\nc,d\r\n")).toEqual([["a", "b"], [""], ["c", "d"]]);
  });

  it("keeps empty fields", () => {
    expect(parseCsv('a,,c\n,,\nx,y,""')).toEqual([
      ["a", "", "c"],
      ["", "", ""],
      ["x", "y", ""],
    ]);
  });

  it("keeps accented and non-Latin text", () => {
    expect(parseCsv("José Núñez,李明")).toEqual([["José Núñez", "李明"]]);
  });

  it("reads nothing from an empty file", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("treats a quote inside an unquoted field as a plain character, as Excel does", () => {
    expect(parseCsv('12" Subs,business\nNext Co,individual')).toEqual([
      ['12" Subs', "business"],
      ["Next Co", "individual"],
    ]);
  });
});

describe("decodeUtf8", () => {
  it("reads UTF-8 and drops a byte-order mark", () => {
    expect(decodeUtf8(new TextEncoder().encode("﻿Peña,José"))).toBe("Peña,José");
  });

  it("refuses text in another encoding, such as Excel's plain CSV", () => {
    // "Peña" in Windows-1252, where ñ is the single byte 0xF1.
    expect(decodeUtf8(new Uint8Array([0x50, 0x65, 0xf1, 0x61]))).toBeNull();
  });
});
