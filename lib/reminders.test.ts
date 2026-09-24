import { describe, expect, it } from "vitest";
import { reminderDue } from "@/lib/reminders";

const today = "2027-03-10";
const sentOn = "2027-03-01";

function dueIn(days: number): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe("reminderDue", () => {
  it.each([
    [8, false],
    [7, true],
    [1, false],
    [0, true],
    [-1, false],
    [-3, true],
    [-6, true],
  ])("due in %i days -> %s", (days, expected) => {
    expect(reminderDue({ dueDate: dueIn(days), sentOn, today })).toBe(expected);
  });

  it("never reminds on the day the request was sent", () => {
    expect(reminderDue({ dueDate: dueIn(7), sentOn: today, today })).toBe(false);
  });

  it("counts days across month boundaries", () => {
    expect(reminderDue({ dueDate: "2027-03-07", sentOn, today: "2027-02-28" })).toBe(true);
  });
});
