import { LIMITS } from "@/lib/constants";
import { emailSchema, personNameSchema } from "@/lib/validation";

export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_BYTES = 1024 * 1024;
/** The longest value any column may hold; the import actions accept nothing longer. */
export const MAX_IMPORT_FIELD = 1000;

/** The file staff can download from the import page. */
export const IMPORT_TEMPLATE = [
  "client_name,client_type,contact_name,contact_email",
  "Rivera Household,individual,Alex Rivera,alex@example.com",
  "Rivera Household,individual,Sam Rivera,sam@example.com",
  "Acme Bakery,business,Jo Baker,jo@example.com",
  "",
].join("\n");

/** A data row as read from the file. `row` is its spreadsheet row; the header is row 1. */
export type ImportRow = {
  row: number;
  clientName: string;
  clientType: string;
  contactName: string;
  contactEmail: string;
};

type Kind = "individual" | "business";

/** A firm's client as the import sees it. `contactEmails` are lowercase. */
export type ExistingClient = { id: string; name: string; archived: boolean; contactEmails: string[] };

export type RowOutcome = {
  row: number;
  clientName: string;
  contactEmail: string;
  outcome: "create" | "add" | "skip" | "error";
  message: string;
};

export type ImportPlan = {
  outcomes: RowOutcome[];
  /** Clients to create, keyed by lowercase name, with every row that names them. */
  newClients: { key: string; name: string; kind: Kind; rows: number[] }[];
  /** Contacts to add: to an existing client (`clientId`), or to a new one (`clientKey`). */
  contacts: { row: number; clientId: string | null; clientKey: string; fullName: string; email: string }[];
};

/** The data rows of a parsed file, found by column name, or why the file cannot be used. */
export function readImportRows(records: string[][]): { ok: true; rows: ImportRow[] } | { ok: false; error: string } {
  const header = (records[0] ?? []).map((name) => name.trim().toLowerCase());
  const [client, type, contact, email] = ["client_name", "client_type", "contact_name", "contact_email"].map((name) =>
    header.indexOf(name),
  );
  if (client < 0 || contact < 0 || email < 0) {
    return {
      ok: false,
      error: "The first row must name the columns client_name, client_type, contact_name, and contact_email.",
    };
  }
  const cell = (record: string[], index: number) => (index < 0 ? "" : (record[index] ?? ""));
  const rows = records
    .map((record, index) => ({
      row: index + 1,
      clientName: cell(record, client),
      clientType: cell(record, type),
      contactName: cell(record, contact),
      contactEmail: cell(record, email),
    }))
    .slice(1)
    .filter((row) => [row.clientName, row.clientType, row.contactName, row.contactEmail].some((v) => v.trim() !== ""));
  if (rows.length === 0) return { ok: false, error: "The file has no rows after the header." };
  if (rows.length > MAX_IMPORT_ROWS) return { ok: false, error: `A file can have at most ${MAX_IMPORT_ROWS} rows.` };
  const long = rows.find((row) =>
    [row.clientName, row.clientType, row.contactName, row.contactEmail].some((v) => v.length > MAX_IMPORT_FIELD),
  );
  if (long) {
    return {
      ok: false,
      error: `Row ${long.row} has a value longer than ${MAX_IMPORT_FIELD.toLocaleString("en-US")} characters.`,
    };
  }
  return { ok: true, rows };
}

type Checked = { clientName: string; kind: Kind; contact: { fullName: string; email: string } | null };

/** One row's client and optional contact, or what is wrong with it. */
function checkRow(input: ImportRow): { ok: true; value: Checked } | { ok: false; error: string } {
  const clientName = input.clientName.trim();
  if (clientName === "") return { ok: false, error: "The client name is missing." };
  if (clientName.length > LIMITS.name) {
    return { ok: false, error: `Client names must be ${LIMITS.name} characters or fewer.` };
  }
  const type = input.clientType.trim().toLowerCase();
  if (type !== "" && type !== "individual" && type !== "business") {
    return { ok: false, error: "The type must be individual or business." };
  }
  const kind: Kind = type === "business" ? "business" : "individual";
  const name = input.contactName.trim();
  const email = input.contactEmail.trim();
  // Quoted CSV fields may hold line breaks; a name never should.
  if (/[\r\n]/.test(clientName) || /[\r\n]/.test(name)) return { ok: false, error: "Names can't contain line breaks." };
  if (name === "" && email === "") return { ok: true, value: { clientName, kind, contact: null } };
  if (email === "") return { ok: false, error: "The contact's email is missing." };
  if (name === "") return { ok: false, error: "The contact's name is missing." };
  const fullName = personNameSchema.safeParse(name);
  if (!fullName.success) return { ok: false, error: fullName.error.issues[0].message };
  const address = emailSchema.safeParse(email);
  if (!address.success) return { ok: false, error: address.error.issues[0].message };
  return { ok: true, value: { clientName, kind, contact: { fullName: fullName.data, email: address.data } } };
}

/**
 * What importing `rows` would do for a firm with `existing` clients. Pure: the
 * preview and the import both call it, the import against fresh data.
 */
export function planImport(rows: ImportRow[], existing: ExistingClient[]): ImportPlan {
  const byName = Map.groupBy(existing, (client) => client.name.trim().toLowerCase());
  const plan: ImportPlan = { outcomes: [], newClients: [], contacts: [] };
  const firstRow = new Map<string, number>(); // "client|email" → the row that used it first

  for (const input of rows) {
    const base = { row: input.row, clientName: input.clientName.trim(), contactEmail: input.contactEmail.trim() };
    const outcome = (kind: RowOutcome["outcome"], message: string) => plan.outcomes.push({ ...base, outcome: kind, message });
    const checked = checkRow(input);
    if (!checked.ok) {
      outcome("error", checked.error);
      continue;
    }
    const { clientName, kind, contact } = checked.value;
    const key = clientName.toLowerCase();
    const rowKey = `${key}|${contact?.email ?? ""}`;
    const earlier = firstRow.get(rowKey);
    if (earlier !== undefined) {
      outcome("error", `Same as row ${earlier}.`);
      continue;
    }
    firstRow.set(rowKey, input.row);

    const matches = byName.get(key) ?? [];
    const active = matches.filter((client) => !client.archived);
    if (active.length > 1) {
      outcome("error", `More than one client is named ${clientName}. Add this contact by hand.`);
    } else if (active.length === 0 && matches.length > 0) {
      outcome("error", `${matches[0].name} is archived. Unarchive it first.`);
    } else if (active.length === 1) {
      const client = active[0];
      if (!contact) outcome("skip", "Client already exists.");
      else if (client.contactEmails.includes(contact.email)) outcome("skip", "Contact already on this client.");
      else {
        outcome("add", `Adds a contact to ${client.name}.`);
        plan.contacts.push({ row: input.row, clientId: client.id, clientKey: key, ...contact });
      }
    } else {
      // New to the firm: the first row creates the client, and its type wins.
      let created = plan.newClients.find((client) => client.key === key);
      if (!created) {
        created = { key, name: clientName, kind, rows: [] };
        plan.newClients.push(created);
        outcome("create", contact ? `New client, with ${contact.email}.` : "New client.");
      } else if (contact) {
        outcome("add", `Adds a contact to ${created.name}.`);
      } else {
        outcome("skip", "Client listed in an earlier row.");
      }
      created.rows.push(input.row);
      if (contact) plan.contacts.push({ row: input.row, clientId: null, clientKey: key, ...contact });
    }
  }
  return plan;
}
