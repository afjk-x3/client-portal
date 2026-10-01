import { describe, expect, it } from "vitest";
import { actorName, describeEvent, itemLabel } from "@/lib/activity";

describe("describeEvent", () => {
  it.each([
    ["sent", {}, "sent the request"],
    ["submitted", {}, "submitted Photo ID"],
    ["submitted", { reason: "No account" }, "said they don't have Photo ID: “No account”"],
    ["accepted", {}, "accepted Photo ID"],
    ["file_added", { filename: "scan.pdf", by_staff: false }, "added “scan.pdf” to Photo ID"],
    ["file_removed", { filename: "scan.pdf", by_staff: true }, "removed “scan.pdf” from Photo ID"],
    ["returned", { note: "Wrong year" }, "returned Photo ID: “Wrong year”"],
    ["item_added", { title: "Photo ID" }, "added the item “Photo ID”"],
    ["item_removed", { title: "Photo ID" }, "removed the item “Photo ID”"],
    ["reminder_sent", { manual: true }, "sent a reminder"],
    ["reminder_sent", { manual: false }, "sent the daily reminder"],
    ["archived", {}, "archived the request"],
    ["unarchived", {}, "unarchived the request"],
    ["completed", {}, "completed the request"],
    ["reopened", {}, "reopened the request"],
  ])("%s %o", (kind, detail, text) => {
    expect(describeEvent(kind, detail, "Photo ID")).toBe(text);
  });

  it("names each changed detail", () => {
    expect(
      describeEvent("details_changed", { title: ["2026 taxes", "2027 taxes"], due_date: ["2027-03-05", "2027-03-12"] }, ""),
    ).toBe("changed the title from “2026 taxes” to “2027 taxes” and changed the due date from Mar 5, 2027 to Mar 12, 2027");
  });

  it("describes failed and late emails", () => {
    expect(
      describeEvent(
        "email_failed",
        { email: "reminder", to: "maria@example.com", reason: "daily sending limit reached", outcome: "retrying" },
        "",
      ),
    ).toBe("couldn't send the reminder to maria@example.com (daily sending limit reached). Trying again tomorrow.");
    expect(
      describeEvent(
        "email_failed",
        { email: "request_sent", to: "maria@example.com", reason: "daily sending limit reached", outcome: "gave_up" },
        "",
      ),
    ).toBe("gave up on the request email to maria@example.com after 3 days (daily sending limit reached).");
    expect(
      describeEvent(
        "email_failed",
        { email: "needs_changes", to: "maria@example.com", reason: "550 5.1.1 unknown", outcome: "failed" },
        "Photo ID",
      ),
    ).toBe(
      "couldn't send the changes-needed email for “Photo ID” to maria@example.com (550 5.1.1 unknown). It won't be tried again.",
    );
    expect(describeEvent("email_sent_late", { email: "reminder", to: "maria@example.com" }, "")).toBe(
      "sent the reminder to maria@example.com after an earlier failure.",
    );
    expect(
      describeEvent(
        "email_failed",
        { email: "item_message", to: "pat@example.com", reason: "connection problem", outcome: "retrying" },
        "Bank statement",
      ),
    ).toBe("couldn't send the message about “Bank statement” to pat@example.com (connection problem). Trying again tomorrow.");
  });
});

describe("itemLabel", () => {
  const titles = new Map([["i1", "Photo ID"]]);

  it("uses the item's current title, then the title the event kept", () => {
    expect(itemLabel("i1", {}, titles)).toBe("Photo ID");
    expect(itemLabel("gone", { title: "Old item" }, titles)).toBe("Old item");
  });

  it("falls back for an item since removed whose event kept no title", () => {
    expect(itemLabel("gone", {}, titles)).toBe("an item");
  });
});

describe("actorName", () => {
  const names = new Map([["u1", "Maria Santos"]]);

  it("names people, the daily job, and removed users", () => {
    expect(actorName("u1", names)).toBe("Maria Santos");
    expect(actorName(null, names)).toBe("PaperLine");
    expect(actorName("u2", names)).toBe("Former user");
  });
});
