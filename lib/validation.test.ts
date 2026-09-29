import { describe, expect, it } from "vitest";
import { archiveRequestsSchema, messageSchema, noteSchema, unavailableReasonSchema } from "@/lib/validation";

describe("noteSchema", () => {
  it("trims the note", () => {
    expect(noteSchema.parse("  Called Pat.  ")).toBe("Called Pat.");
  });
  it("refuses a blank note", () => {
    expect(noteSchema.safeParse("   ").error?.issues[0].message).toBe("Note is required.");
  });
  it("refuses 2,001 characters", () => {
    expect(noteSchema.safeParse("x".repeat(2001)).error?.issues[0].message).toBe(
      "Note must be 2,000 characters or fewer.",
    );
  });
});


describe("unavailableReasonSchema", () => {
  it("trims the reason", () => {
    expect(unavailableReasonSchema.parse("  No account  ")).toBe("No account");
  });
  it("refuses a blank reason", () => {
    expect(unavailableReasonSchema.safeParse("   ").error?.issues[0].message).toBe("Reason is required.");
  });
  it("refuses 1,001 characters", () => {
    expect(unavailableReasonSchema.safeParse("x".repeat(1001)).error?.issues[0].message).toBe(
      "Reason must be 1,000 characters or fewer.",
    );
  });
});

describe("messageSchema", () => {
  it("trims the message", () => {
    expect(messageSchema.parse("  Hi Maria  ")).toBe("Hi Maria");
  });
  it("turns a blank or missing message into null", () => {
    expect(messageSchema.parse("  \n  ")).toBeNull();
    expect(messageSchema.parse(undefined)).toBeNull();
  });
  it("refuses 2,001 characters", () => {
    expect(messageSchema.safeParse("x".repeat(2001)).error?.issues[0].message).toBe(
      "Message must be 2,000 characters or fewer.",
    );
  });
});

describe("archiveRequestsSchema", () => {
  const ids = (count: number) =>
    Array.from({ length: count }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

  it("accepts one and fifty ids", () => {
    expect(archiveRequestsSchema.safeParse(ids(1)).success).toBe(true);
    expect(archiveRequestsSchema.safeParse(ids(50)).success).toBe(true);
  });
  it("refuses an empty list, 51 ids, and a malformed id", () => {
    expect(archiveRequestsSchema.safeParse([]).success).toBe(false);
    expect(archiveRequestsSchema.safeParse(ids(51)).success).toBe(false);
    expect(archiveRequestsSchema.safeParse(["not-an-id"]).success).toBe(false);
  });
  it("keeps one of each repeated id", () => {
    const [first] = ids(1);
    expect(archiveRequestsSchema.parse([first, first])).toEqual([first]);
  });
});
