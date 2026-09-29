import { describe, expect, it } from "vitest";
import { noteAuthor } from "@/lib/notes";

describe("noteAuthor", () => {
  it("takes the name from the firm's members", () => {
    expect(noteAuthor("u1", new Map([["u1", "Tia Staff"]]))).toBe("Tia Staff");
  });
  it("reports a departed author", () => {
    expect(noteAuthor("u2", new Map())).toBe("Former staff member");
  });
});
