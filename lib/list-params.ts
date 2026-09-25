import { z } from "zod";

/** Rows per page on the Requests page and the client list; list_requests and list_clients use the same number. */
export const LIST_PAGE_SIZE = 50;

/** The statuses each Status choice shows. "active" is the default and hides archived requests. */
export const REQUEST_STATUS_FILTERS = {
  active: ["draft", "open", "completed"],
  draft: ["draft"],
  open: ["open"],
  completed: ["completed"],
  archived: ["archived"],
  all: ["draft", "open", "completed", "archived"],
} as const satisfies Record<string, readonly string[]>;

export type RequestStatusFilter = keyof typeof REQUEST_STATUS_FILTERS;
export type RequestFilters = { q: string; status: RequestStatusFilter; overdue: boolean; page: number };
export type ClientFilters = {
  q: string;
  owner: string | null;
  kind: "individual" | "business" | null;
  archived: boolean;
  page: number;
};

type SearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const search = z.string().trim().transform((value) => value.slice(0, 200)).catch("");
const page = z.coerce.number().int().min(1).max(10_000).catch(1);
const status = z
  .enum(Object.keys(REQUEST_STATUS_FILTERS) as [RequestStatusFilter, ...RequestStatusFilter[]])
  .catch("active");
const owner = z
  .union([z.literal("none"), z.uuid().transform((id) => id.toLowerCase())])
  .nullable()
  .catch(null);
const kind = z.enum(["individual", "business"]).nullable().catch(null);

/** Requests page filters from the URL. Anything invalid falls back to its default. */
export function parseRequestFilters(params: SearchParams): RequestFilters {
  return {
    q: search.parse(first(params.q)),
    status: status.parse(first(params.status)),
    overdue: first(params.overdue) === "1",
    page: page.parse(first(params.page)),
  };
}

/** Client list filters from the URL. Anything invalid falls back to its default. */
export function parseClientFilters(params: SearchParams): ClientFilters {
  return {
    q: search.parse(first(params.q)),
    owner: owner.parse(first(params.owner)),
    kind: kind.parse(first(params.kind)),
    archived: first(params.archived) === "1",
    page: page.parse(first(params.page)),
  };
}

/** A list URL with the given params; empty, null, and false values are left out. */
export function listHref(path: string, params: Record<string, string | number | boolean | null>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === "" || value === false) continue;
    query.set(key, value === true ? "1" : String(value));
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}
