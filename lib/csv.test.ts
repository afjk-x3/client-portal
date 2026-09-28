import { describe, expect, it } from "vitest";
import { decodeUtf8, parseCsv, spreadsheetSafe, toCsv } from "@/lib/csv";

describe("toCsv", () => {
  it("joins fields with commas and records with CRLF", () => {
    expect(
      toCsv([
        ["a", "b"],
        ["c", "d"],
      ]),
    ).toBe("a,b\r\nc,d");
  });

  it("quotes fields with commas, quotes, or line breaks, doubling quotes", () => {
    expect(toCsv([['Peña, "Ann"', "x\ny"]])).toBe('"Peña, ""Ann""","x\ny"');
  });

  it("round-trips through parseCsv", () => {
    const records = [
      ["client_name", "contact_email"],
      ['Peña, "Ann"', "a@b.co"],
      ["", "line\r\nbreak"],
    ];
    expect(parseCsv(toCsv(records))).toEqual(records);
  });
});

describe("spreadsheetSafe", () => {
  it("prefixes values a spreadsheet could run as a formula", () => {
    for (const value of ["=SUM(A1)", "+1", "-2", "@x", "\tx", "\rx"]) {
      expect(spreadsheetSafe(value)).toBe(`'${value}`);
    }
  });

  it("leaves ordinary values unchanged", () => {
    for (const value of ["Maria", "", "a=b"]) {
      expect(spreadsheetSafe(value)).toBe(value);
    }
  });
});

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
