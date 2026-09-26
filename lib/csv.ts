/**
 * Records and fields of CSV text: quoted fields with "" escapes, commas and line
 * breaks inside quotes, CRLF or LF, and a leading byte-order mark. A quote opens a
 * quoted field only at the field's start; elsewhere it is a plain character, as
 * in Excel. An empty line is a record with one empty field, so record numbers
 * match spreadsheet rows.
 */
export function parseCsv(text: string): string[][] {
  const input = text.startsWith("﻿") ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char !== '"') field += char;
      else if (input[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (char === '"' && field === "") {
      quoted = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

/**
 * The text of a UTF-8 file, without a byte-order mark, or null for any other
 * encoding. Excel's plain "CSV" is not UTF-8 and would turn letters like ñ into �.
 */
export function decodeUtf8(bytes: ArrayBuffer | Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
