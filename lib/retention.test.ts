import { describe, expect, it } from "vitest";
import { confirmsName } from "@/lib/retention";

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
