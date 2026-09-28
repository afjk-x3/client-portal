import { describe, expect, it } from "vitest";
import { unavailableReasonSchema } from "@/lib/validation";

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
