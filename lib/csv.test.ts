import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";

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
});
