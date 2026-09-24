import { describe, expect, it } from "vitest";
import { requestSentEmail } from "@/lib/email/templates";

describe("email templates", () => {
  it("escapes every value a user typed", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://portal.example";
    const email = requestSentEmail({
      firmName: "Smith & <Co>",
      title: '<script>alert("x")</script>',
      dueDate: "2027-04-15",
      itemCount: 2,
      requestId: "r1",
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(email.html).toContain("Smith &amp; &lt;Co&gt;");
    expect(email.html).toContain('href="https://portal.example/portal/requests/r1"');
    expect(email.text).toContain("due Apr 15, 2027");
  });
});
