import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  needsChangesEmail,
  reminderEmail,
  requestSentEmail,
  staffAddedEmail,
  staffDigestEmail,
} from "@/lib/email/templates";

// Every value a user can type, with markup, quotes, and a header-injection attempt.
const evil = `<img src=x onerror="alert(1)">&'\r\nBcc: victim@evil.example`;
const escaped = "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;";

const templates = {
  staffAdded: () => staffAddedEmail({ firmName: evil, adminName: evil }),
  requestSent: () =>
    requestSentEmail({ firmName: evil, title: evil, dueDate: "2027-04-15", itemCount: 2, requestId: "r1" }),
  needsChanges: () => needsChangesEmail({ firmName: evil, itemTitle: evil, note: evil, requestId: "r1" }),
  reminder: () =>
    reminderEmail({
      firmName: evil,
      title: evil,
      dueDate: "2027-04-15",
      overdue: true,
      openItems: [evil],
      requestId: "r1",
    }),
  staffDigest: () =>
    staffDigestEmail({
      firmName: evil,
      groups: [{ clientName: evil, requestTitle: evil, requestId: "r1", items: [evil] }],
    }),
};

describe("email templates", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://portal.example");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(Object.entries(templates))("%s escapes user text and keeps the subject on one line", (_name, build) => {
    const email = build();
    expect(email.html).not.toContain("<img");
    expect(email.html).toContain(escaped);
    expect(email.html).not.toMatch(/<p><ul>|<\/ul><\/p>/);
    expect(email.subject).not.toMatch(/[\r\n]/);
  });

  it("links to the request page and formats the due date", () => {
    const email = requestSentEmail({ firmName: "Smith & Co", title: "2026 taxes", dueDate: "2027-04-15", itemCount: 2, requestId: "r1" });
    expect(email.html).toContain('href="https://portal.example/portal/requests/r1"');
    expect(email.text).toContain("due Apr 15, 2027");
  });

  it("fails clearly when the site URL is missing", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    expect(() => staffAddedEmail({ firmName: "A", adminName: "B" })).toThrow("NEXT_PUBLIC_SITE_URL is not set");
  });
});
