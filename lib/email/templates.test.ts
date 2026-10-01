import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  itemMessageEmail,
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
      groups: [{ clientName: evil, requestTitle: evil, requestId: "r1", items: [{ title: evil, unavailable: false }] }],
      messages: [{ clientName: evil, requestTitle: evil, requestId: "r1", items: [{ title: evil, count: 2 }] }],
    }),
  itemMessage: () => itemMessageEmail({ firmName: evil, itemTitle: evil, message: evil, requestId: "r1" }),
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

  it("puts the request's message between the due date and the link", () => {
    const email = requestSentEmail({
      firmName: "Smith & Co",
      title: "2026 taxes",
      dueDate: "2027-04-15",
      itemCount: 2,
      requestId: "r1",
      message: "Hi <b>Maria</b>\nPlease upload by the 15th.",
    });
    const block = "Hi &lt;b&gt;Maria&lt;/b&gt;<br>Please upload by the 15th.";
    expect(email.html).toContain(block);
    expect(email.html.indexOf(block)).toBeGreaterThan(email.html.indexOf("It has 2 items and is due"));
    expect(email.html.indexOf(block)).toBeLessThan(email.html.indexOf("Open the request"));
    expect(email.text).toContain("\n\nHi <b>Maria</b>\nPlease upload by the 15th.\n\nOpen the request:");
  });

  it("leaves the request-sent email exactly as without a message when it is null", () => {
    const email = requestSentEmail({
      firmName: "Smith & Co",
      title: "2026 taxes",
      dueDate: "2027-04-15",
      itemCount: 1,
      requestId: "r1",
      message: null,
    });
    expect(email.text).toBe(
      "Smith & Co sent you a request: 2026 taxes.\nIt has 1 item and is due Apr 15, 2027.\n\nOpen the request: https://portal.example/portal/requests/r1",
    );
    expect(email.html).not.toContain("<p></p>");
  });

  it("marks unavailable items in the digest", () => {
    const email = staffDigestEmail({
      firmName: "Ledger & Co",
      groups: [
        {
          clientName: "Pat Client",
          requestTitle: "2026 tax documents",
          requestId: "r1",
          items: [
            { title: "Bank statement", unavailable: false },
            { title: "<b>Payslip</b>", unavailable: true },
          ],
        },
      ],
    });
    expect(email.html).toContain("<li>Bank statement</li>");
    expect(email.html).toContain("<li>&lt;b&gt;Payslip&lt;/b&gt; (not available)</li>");
    expect(email.text).toContain("<b>Payslip</b> (not available)");
  });

  it("sends a message email with the message escaped and its lines kept", () => {
    const email = itemMessageEmail({
      firmName: "Smith & Co",
      itemTitle: "Bank statement",
      message: "Hi <b>Pat</b>\nThe BDO one",
      requestId: "r1",
    });
    expect(email.subject).toBe("Smith & Co sent you a message about Bank statement");
    expect(email.html).toContain("Hi &lt;b&gt;Pat&lt;/b&gt;<br>The BDO one");
    expect(email.text).toContain("Hi <b>Pat</b>\nThe BDO one");
    expect(email.html).toContain('href="https://portal.example/portal/requests/r1"');
  });

  it("titles a digest of only new messages", () => {
    const email = staffDigestEmail({
      firmName: "Smith & Co",
      groups: [],
      messages: [{ clientName: "Pat Client", requestTitle: "2026 taxes", requestId: "r1", items: [{ title: "Bank statement", count: 2 }] }],
    });
    expect(email.subject).toBe("2 new messages at Smith & Co");
    expect(email.html).toContain("New messages");
    expect(email.text).toContain("Bank statement (2 new messages)");
  });

  it("titles a digest of items and messages together", () => {
    const email = staffDigestEmail({
      firmName: "Smith & Co",
      groups: [{ clientName: "Pat Client", requestTitle: "2026 taxes", requestId: "r1", items: [{ title: "Pay slip", unavailable: false }] }],
      messages: [{ clientName: "Pat Client", requestTitle: "2026 taxes", requestId: "r1", items: [{ title: "Bank statement", count: 1 }] }],
    });
    expect(email.subject).toBe("1 item submitted and 1 new message at Smith & Co");
  });

  it("fails clearly when the site URL is missing", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    expect(() => staffAddedEmail({ firmName: "A", adminName: "B" })).toThrow("NEXT_PUBLIC_SITE_URL is not set");
  });
});
