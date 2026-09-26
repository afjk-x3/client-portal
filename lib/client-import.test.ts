import { describe, expect, it } from "vitest";
import { MAX_IMPORT_ROWS, planImport, readImportRows, type ExistingClient, type ImportRow } from "@/lib/client-import";

const row = (n: number, clientName: string, contactName = "", contactEmail = "", clientType = ""): ImportRow => ({
  row: n,
  clientName,
  clientType,
  contactName,
  contactEmail,
});

describe("readImportRows", () => {
  it("finds the columns by name, in any order, ignoring extra ones and blank rows", () => {
    expect(
      readImportRows([
        ["Contact_Email", "notes", " CLIENT_NAME ", "contact_name"],
        ["jo@example.com", "vip", "Acme", "Jo"],
        ["", "", "", ""],
        ["", "", "Birch", ""],
      ]),
    ).toEqual({
      ok: true,
      rows: [
        { row: 2, clientName: "Acme", clientType: "", contactName: "Jo", contactEmail: "jo@example.com" },
        { row: 4, clientName: "Birch", clientType: "", contactName: "", contactEmail: "" },
      ],
    });
  });

  it("refuses a file without the required columns, without rows, or with too many", () => {
    expect(readImportRows([["name", "email"], ["Acme", "jo@example.com"]])).toMatchObject({ ok: false });
    expect(readImportRows([["client_name", "contact_name", "contact_email"]])).toEqual({
      ok: false,
      error: "The file has no rows after the header.",
    });
    const header = ["client_name", "contact_name", "contact_email"];
    const many = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => [`Client ${i}`, "", ""]);
    expect(readImportRows([header, ...many])).toEqual({ ok: false, error: "A file can have at most 500 rows." });
  });
});

describe("planImport", () => {
  const existing: ExistingClient[] = [
    { id: "c1", name: "Rivera Household", archived: false, contactEmails: ["alex@example.com"] },
    { id: "c2", name: "Old Co", archived: true, contactEmails: [] },
    { id: "c3", name: "Twin", archived: false, contactEmails: [] },
    { id: "c4", name: "twin", archived: false, contactEmails: [] },
  ];

  it("creates each new client once, adds contacts to existing ones, and skips what is there", () => {
    const plan = planImport(
      [
        row(2, "Acme Bakery", "Jo Baker", "jo@example.com", "business"),
        row(3, "acme bakery", "Lee Baker", "lee@example.com", "individual"),
        row(4, "RIVERA HOUSEHOLD", "Sam Rivera", "Sam@Example.com"),
        row(5, "Rivera Household", "Alex Rivera", "ALEX@example.com"),
        row(6, "Rivera Household"),
        row(7, "Acme Bakery"),
      ],
      existing,
    );
    expect(plan.outcomes.map((o) => [o.row, o.outcome])).toEqual([
      [2, "create"],
      [3, "add"],
      [4, "add"],
      [5, "skip"],
      [6, "skip"],
      [7, "skip"],
    ]);
    expect(plan.newClients).toEqual([{ key: "acme bakery", name: "Acme Bakery", kind: "business", rows: [2, 3, 7] }]);
    expect(plan.contacts.map((c) => [c.row, c.clientId, c.clientKey, c.email])).toEqual([
      [2, null, "acme bakery", "jo@example.com"],
      [3, null, "acme bakery", "lee@example.com"],
      [4, "c1", "rivera household", "sam@example.com"],
    ]);
  });

  it("reports the rows it cannot import", () => {
    const plan = planImport(
      [
        row(2, "", "No Client", "x@example.com"),
        row(3, "Acme", "Jo", "not-an-email"),
        row(4, "Acme", "", "jo@example.com"),
        row(5, "Acme", "Jo", "jo@example.com", "robot"),
        row(6, "Old Co", "Pat", "pat@example.com"),
        row(7, "Twin", "Kim", "kim@example.com"),
        row(8, "New Co", "Kim", "kim@example.com"),
        row(9, "new co", "Kim", "KIM@example.com"),
      ],
      existing,
    );
    expect(plan.outcomes.map((o) => [o.row, o.outcome, o.message])).toEqual([
      [2, "error", "The client name is missing."],
      [3, "error", "Enter a valid email address."],
      [4, "error", "The contact's name is missing."],
      [5, "error", "The type must be individual or business."],
      [6, "error", "Old Co is archived. Unarchive it first."],
      [7, "error", "More than one client is named Twin. Add this contact by hand."],
      [8, "create", "New client, with kim@example.com."],
      [9, "error", "Same as row 8."],
    ]);
    expect(plan.contacts.map((c) => c.row)).toEqual([8]);
  });
});
