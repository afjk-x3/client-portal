# Export Clients to CSV: Design Spec

- **Date:** 2026-09-26
- **Status:** Design approved in conversation on 2026-09-26
- **Builds on:** [`2026-09-25-paperline-backlog-design.md`](2026-09-25-paperline-backlog-design.md) (the backlog spec: the client list's filters in §3.2 and the CSV import in §5; this reverses the import, which §9 deferred)

## 1. Summary

Admins can download the client list as a CSV file in the import's format, for a spreadsheet, a backup, or a move to another tool. The same file imports back unchanged.

### Success criteria

- One click on the Clients page downloads the clients the list currently shows, across every page.
- Excel opens the file with names such as "Peña" intact.
- Importing the exported file adds nothing.

## 2. Decisions

| Topic | Decision |
|---|---|
| Which clients | What the list shows: the current search, owner, type, and "Show archived" settings, across all pages |
| Columns | The import's four: `client_name,client_type,contact_name,contact_email` |
| Who | Admins only |
| Mechanism | A download route, like the zip route |
| Encoding | UTF-8 with a byte-order mark, so Excel reads it as UTF-8 |
| Formulas | A value starting with `=`, `+`, `-`, `@`, a tab, or a carriage return gets a leading apostrophe |

## 3. Button

On the Clients page, admins see an outline "Export CSV" link with a download icon, next to "Import CSV". Its href is `/api/clients/export` with the list's current `q`, `owner`, `kind`, and `archived` params (built with `listHref`), without `page`. Staff who are not admins do not see it.

## 4. Route: `GET /api/clients/export`

1. It responds 404 unless the caller is signed in and is an admin of a firm. The app does not reveal what exists (v1 §9.4).
2. It reads the filters with `parseClientFilters`, so an invalid value falls back to its default.
3. It reads the matching clients through `list_clients` with the user-scoped client, page 1, 2, … until a page returns fewer than `LIST_PAGE_SIZE` rows. The list's filters and name order therefore apply exactly.
4. It reads those clients' contacts from `client_contacts`, 200 client ids per query, sorted by `full_name`.
5. It builds one row per contact: the client's name, its type (`individual` or `business`), the contact's name, and the contact's email. A client without contacts gets one row with the contact columns empty. Every value passes through `spreadsheetSafe`.
6. It responds with a byte-order mark followed by `toCsv` of the header and rows, with the headers `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="clients-{YYYY-MM-DD}.csv"` (the firm's today), and `Cache-Control: no-store`.

## 5. CSV writing

`lib/csv.ts` gains:

- `toCsv(records: string[][]): string` joins fields with commas and records with CRLF. A field that contains a comma, a quote, a CR, or an LF is wrapped in quotes, with its quotes doubled.
- `spreadsheetSafe(value: string): string` returns the value with a leading `'` when it starts with `=`, `+`, `-`, `@`, a tab, or a carriage return, and unchanged otherwise. Such names are rare; one exported this way comes back with the apostrophe if re-imported.

## 6. Errors

- A caller who is not an admin, or not signed in, gets 404.
- A database error fails the request with 500 and is logged, like the zip route. The browser shows its download error.

## 7. Tests

- **Unit:**
  - `toCsv` quotes fields with commas, quotes, and line breaks, and doubles quotes.
  - `spreadsheetSafe` prefixes the six starting characters and leaves ordinary values unchanged.
  - `parseCsv(toCsv(records))` returns the same records.
- **Browser:**
  - An admin exports with a type filter; the download starts with a byte-order mark, has the header, and holds only the filtered clients' rows.
  - Importing that file shows nothing new to import.
  - Staff who are not admins see no Export button, and the route answers 404 for them.

## 8. Other changes

- README: mention the export next to the import in the feature description.

## 9. Out of scope

- Owner or archived columns.
- Exporting requests, answers, or files.
- Recording exports in an audit log.
- Scheduled exports.
