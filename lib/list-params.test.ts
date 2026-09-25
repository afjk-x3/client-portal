import { describe, expect, it } from "vitest";
import { listHref, parseClientFilters, parseRequestFilters } from "@/lib/list-params";

describe("parseRequestFilters", () => {
  it("defaults to active requests on page 1", () => {
    expect(parseRequestFilters({})).toEqual({ q: "", status: "active", overdue: false, page: 1 });
  });

  it("reads every param, trimming the search", () => {
    expect(parseRequestFilters({ q: "  tax  ", status: "archived", overdue: "1", page: "3" })).toEqual({
      q: "tax",
      status: "archived",
      overdue: true,
      page: 3,
    });
  });

  it("falls back to defaults for values a hand-edited URL can hold", () => {
    expect(parseRequestFilters({ status: "nope", overdue: "yes", page: "-2" })).toEqual({
      q: "",
      status: "active",
      overdue: false,
      page: 1,
    });
    expect(parseRequestFilters({ page: "2.5" }).page).toBe(1);
    expect(parseRequestFilters({ q: ["first", "second"] }).q).toBe("first");
  });
});

describe("parseClientFilters", () => {
  it("defaults to every active client", () => {
    expect(parseClientFilters({})).toEqual({ q: "", owner: null, kind: null, archived: false, page: 1 });
  });

  it("reads owner, type, and archived", () => {
    const id = "0A1B2C3D-0000-4000-8000-000000000001";
    expect(parseClientFilters({ owner: id, kind: "business", archived: "1" })).toMatchObject({
      owner: id.toLowerCase(),
      kind: "business",
      archived: true,
    });
    expect(parseClientFilters({ owner: "none" }).owner).toBe("none");
  });

  it("ignores an owner or type it does not know", () => {
    expect(parseClientFilters({ owner: "someone", kind: "robot" })).toMatchObject({ owner: null, kind: null });
  });
});

describe("listHref", () => {
  it("keeps set params and drops empty ones", () => {
    expect(listHref("/app/requests", { q: "a b", status: null, overdue: true, page: 2 })).toBe(
      "/app/requests?q=a+b&overdue=1&page=2",
    );
    expect(listHref("/app/clients", { q: "", archived: false })).toBe("/app/clients");
  });
});
