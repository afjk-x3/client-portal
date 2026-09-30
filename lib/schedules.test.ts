import { describe, expect, it } from "vitest";
import { describeRepeat } from "@/lib/schedules";

describe("describeRepeat", () => {
  it("describes monthly and quarterly repeats by the day of month", () => {
    expect(describeRepeat(1, 1, "2027-02-01")).toBe("Monthly on the 1st");
    expect(describeRepeat(3, 5, "2027-02-05")).toBe("Quarterly on the 5th");
  });

  it("describes yearly repeats by the next send date", () => {
    expect(describeRepeat(12, 15, "2027-01-15")).toBe("Yearly on Jan 15");
  });

  it("ordinals the days", () => {
    const cases: [number, string][] = [
      [2, "nd"],
      [3, "rd"],
      [11, "th"],
      [12, "th"],
      [13, "th"],
      [21, "st"],
      [22, "nd"],
      [23, "rd"],
      [31, "st"],
    ];
    for (const [day, suffix] of cases) {
      expect(describeRepeat(1, day, `2027-01-${day}`)).toBe(`Monthly on the ${day}${suffix}`);
    }
  });
});
