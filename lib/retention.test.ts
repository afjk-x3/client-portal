import { describe, expect, it } from "vitest";
import { confirmsName, isShorterRetention, nextCleanupAt } from "@/lib/retention";

describe("confirmsName", () => {
  it("ignores surrounding spaces", () => {
    expect(confirmsName("  Pat Client  ", "Pat Client")).toBe(true);
  });
  it("does not ignore case", () => {
    expect(confirmsName("pat client", "Pat Client")).toBe(false);
  });
  it("rejects an empty confirmation", () => {
    expect(confirmsName("", "Pat Client")).toBe(false);
  });
});

describe("isShorterRetention", () => {
  it("is true when the current period is Forever", () => {
    expect(isShorterRetention(null, 5)).toBe(true);
  });
  it("is true for a shorter period", () => {
    expect(isShorterRetention(7, 5)).toBe(true);
  });
  it("is false for the same period", () => {
    expect(isShorterRetention(5, 5)).toBe(false);
  });
  it("is false for a longer period", () => {
    expect(isShorterRetention(5, 7)).toBe(false);
  });
  it("is false when the next period is Forever", () => {
    expect(isShorterRetention(5, null)).toBe(false);
  });
});

describe("nextCleanupAt", () => {
  it("returns the next 02:00 UTC", () => {
    expect(nextCleanupAt(new Date("2026-09-26T01:59:00Z")).toISOString()).toBe("2026-09-26T02:00:00.000Z");
  });
  it("skips to the next day when 02:00 has passed", () => {
    expect(nextCleanupAt(new Date("2026-09-26T02:00:00Z")).toISOString()).toBe("2026-09-27T02:00:00.000Z");
  });
});
