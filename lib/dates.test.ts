import { describe, expect, it } from "vitest";
import { formatDateTime, isTimeZone, timeZoneNames, todayIn } from "@/lib/dates";

describe("todayIn", () => {
  const instant = new Date("2031-03-10T13:00:00Z");

  it("gives the calendar date in the time zone", () => {
    expect(todayIn("UTC", instant)).toBe("2031-03-10");
    expect(todayIn("Pacific/Auckland", instant)).toBe("2031-03-11");
    expect(todayIn("America/Los_Angeles", new Date("2031-03-10T05:00:00Z"))).toBe("2031-03-09");
  });
});

describe("formatDateTime", () => {
  // ICU may put a narrow no-break space before AM/PM.
  const format = (timestamp: string, timeZone: string) => formatDateTime(timestamp, timeZone).replace(/\s/g, " ");

  it("shows the time and zone where the firm is", () => {
    expect(format("2026-09-24T13:30:00Z", "UTC")).toBe("Sep 24, 2026, 1:30 PM UTC");
    expect(format("2026-09-24T13:30:00Z", "America/New_York")).toBe("Sep 24, 2026, 9:30 AM EDT");
  });
});

describe("time zone names", () => {
  it("accepts IANA names, including UTC, and nothing else", () => {
    expect(isTimeZone("Asia/Manila")).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(timeZoneNames()).toContain("UTC");
    expect(timeZoneNames().every(isTimeZone)).toBe(true);
  });
});
