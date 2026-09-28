import { describe, expect, it } from "vitest";
import { messageSchema, unavailableReasonSchema } from "@/lib/validation";

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
