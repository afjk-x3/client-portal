import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emailConfigError, resendOutcome, sendEmails, smtpOutcome, type EmailMessage } from "@/lib/email/send";

vi.mock("server-only", () => ({}));
const { batchSend, sendMail, closeTransport, createTransport } = vi.hoisted(() => {
  const sendMail = vi.fn();
  const closeTransport = vi.fn();
  return { batchSend: vi.fn(), sendMail, closeTransport, createTransport: vi.fn(() => ({ sendMail, close: closeTransport })) };
});
vi.mock("resend", () => ({
  Resend: class {
    batch = { send: batchSend };
  },
}));
vi.mock("nodemailer", () => ({ createTransport }));

const message = (to: string): EmailMessage => ({ subject: "S", html: "<p>H</p>", text: "H", to, fromName: "Ledger & Co" });
const accepted = (errors: { index: number; message: string }[] = []) => ({ data: { data: [], errors }, error: null });

beforeEach(() => {
  vi.useFakeTimers();
  batchSend.mockReset();
  sendMail.mockReset();
  closeTransport.mockClear();
  createTransport.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("emailConfigError", () => {
  it("allows log mode outside production only", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("VERCEL_ENV", "");
    expect(emailConfigError()).toBeNull();
    vi.stubEnv("VERCEL_ENV", "production");
    expect(emailConfigError()).toBe("RESEND_API_KEY or SMTP_HOST is not set");
  });

  it("accepts SMTP settings instead of a Resend key, with a login", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("SMTP_HOST", "smtp.gmail.com");
    vi.stubEnv("SMTP_USER", "");
    vi.stubEnv("SMTP_PASS", "app-password");
    vi.stubEnv("EMAIL_FROM", "paperline@gmail.com");
    expect(emailConfigError()).toBe("SMTP_USER and SMTP_PASS must be set with SMTP_HOST");
    vi.stubEnv("SMTP_USER", "paperline@gmail.com");
    expect(emailConfigError()).toBeNull();
  });

  it("needs a sender address with a key", () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "");
    expect(emailConfigError()).toBe("EMAIL_FROM is not set");
    vi.stubEnv("EMAIL_FROM", "Portal <notify@example.com>");
    expect(emailConfigError()).toBeNull();
  });
});

describe("sendEmails over SMTP", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "re_test"); // SMTP_HOST takes precedence
    vi.stubEnv("SMTP_HOST", "smtp.gmail.com");
    vi.stubEnv("SMTP_PORT", "");
    vi.stubEnv("SMTP_USER", "paperline@gmail.com");
    vi.stubEnv("SMTP_PASS", "app-password");
    vi.stubEnv("EMAIL_FROM", "paperline@gmail.com");
  });

  it("sends each message through one pooled TLS connection, then closes it", async () => {
    sendMail.mockResolvedValue({});
    const result = await sendEmails([message("a@example.com"), { ...message("b@example.com"), replyTo: "staff@firm.example" }]);

    expect(result).toMatchObject({ sent: 2, failed: 0 });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        pool: true,
        auth: { user: "paperline@gmail.com", pass: "app-password" },
      }),
    );
    expect(sendMail.mock.calls.map(([mail]) => [mail.to, mail.replyTo])).toEqual([
      ["a@example.com", undefined],
      ["b@example.com", "staff@firm.example"],
    ]);
    expect(sendMail.mock.calls[0][0]).toMatchObject({
      from: '"Ledger & Co via PaperLine" <paperline@gmail.com>',
      subject: "S",
      html: "<p>H</p>",
      text: "H",
    });
    expect(closeTransport).toHaveBeenCalledTimes(1);
    expect(batchSend).not.toHaveBeenCalled();
  });

  it("uses STARTTLS on port 587", async () => {
    vi.stubEnv("SMTP_PORT", "587");
    sendMail.mockResolvedValue({});
    await sendEmails([message("a@example.com")]);

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ port: 587, secure: false }));
  });

  it("counts a message the server refuses as failed, without retrying it, and still sends the rest", async () => {
    const refused = Object.assign(new Error("550 5.1.1 No such user"), { responseCode: 550 });
    sendMail.mockRejectedValueOnce(refused).mockResolvedValueOnce({});

    expect(await sendEmails([message("gone@example.com"), message("b@example.com")])).toMatchObject({ sent: 1, failed: 1 });
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(closeTransport).toHaveBeenCalledTimes(1);
  });

  it("retries a deferred message or a dropped connection, up to 3 attempts", async () => {
    const attempts = (to: string) => sendMail.mock.calls.filter(([mail]) => mail.to === to).length;
    sendMail.mockImplementation(async (mail: { to: string }) => {
      if (mail.to === "busy@example.com" && attempts(mail.to) < 3) {
        throw Object.assign(new Error("421 Try again later"), { responseCode: 421 });
      }
      if (mail.to === "down@example.com") throw Object.assign(new Error("Connection closed"), { code: "ECONNECTION" });
      return {};
    });
    const result = sendEmails([message("busy@example.com"), message("down@example.com")]);
    await vi.runAllTimersAsync();

    expect(await result).toMatchObject({ sent: 1, failed: 1 });
    expect(attempts("busy@example.com")).toBe(3);
    expect(attempts("down@example.com")).toBe(3);
  });
});

describe("sendEmails", () => {
  beforeEach(() => {
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "Portal <notify@example.com>");
  });

  it("sends batches of 100 and counts rejected addresses", async () => {
    batchSend.mockResolvedValue(accepted([{ index: 1, message: "Invalid `to` field" }]));
    const result = sendEmails(Array.from({ length: 150 }, (_, i) => message(`c${i}@example.com`)));
    await vi.runAllTimersAsync();

    expect(await result).toMatchObject({ sent: 148, failed: 2 });
    expect(batchSend.mock.calls.map(([payload]) => payload.length)).toEqual([100, 50]);
    expect(batchSend.mock.calls[0][0][0].from).toBe('"Ledger & Co via PaperLine" <notify@example.com>');
    expect(batchSend.mock.calls[0][1]).toEqual({ batchValidation: "permissive" });
  });

  it("retries a rate-limited batch once", async () => {
    batchSend
      .mockResolvedValueOnce({ data: null, error: { name: "rate_limit_exceeded", statusCode: 429, message: "Too many requests" } })
      .mockResolvedValueOnce(accepted());
    const result = sendEmails([message("c@example.com")]);
    await vi.runAllTimersAsync();

    expect(await result).toMatchObject({ sent: 1, failed: 0 });
    expect(batchSend).toHaveBeenCalledTimes(2);
  });

  it("retries a batch that fails with a server error", async () => {
    batchSend
      .mockResolvedValueOnce({ data: null, error: { name: "internal_server_error", statusCode: 500, message: "Oops" } })
      .mockResolvedValueOnce(accepted());
    const result = sendEmails([message("c@example.com")]);
    await vi.runAllTimersAsync();

    expect(await result).toMatchObject({ sent: 1, failed: 0 });
    expect(batchSend).toHaveBeenCalledTimes(2);
  });

  it("counts a batch Resend refuses as failed, without throwing", async () => {
    batchSend.mockResolvedValue({ data: null, error: { name: "validation_error", statusCode: 422, message: "Bad" } });
    const result = sendEmails([message("a@example.com"), message("b@example.com")]);
    await vi.runAllTimersAsync();

    expect(await result).toMatchObject({ sent: 0, failed: 2 });
    expect(batchSend).toHaveBeenCalledTimes(1);
  });

  it("spaces calls 600 ms apart, even across concurrent callers", async () => {
    const started: number[] = [];
    batchSend.mockImplementation(async () => {
      started.push(Date.now());
      return accepted();
    });
    const results = Promise.all([sendEmails([message("a@example.com")]), sendEmails([message("b@example.com")])]);
    await vi.runAllTimersAsync();
    await results;

    expect(started).toHaveLength(2);
    expect(started[1] - started[0]).toBeGreaterThanOrEqual(600);
  });
});


describe("smtpOutcome", () => {
  it("treats Gmail's daily sending limit as retryable", () => {
    expect(smtpOutcome({ responseCode: 550, response: "550-5.4.5 Daily user sending limit exceeded." })).toEqual({
      ok: false,
      reason: "daily sending limit reached",
      retry: true,
    });
  });

  it("treats a dropped connection as retryable", () => {
    expect(smtpOutcome({ code: "ECONNECTION" })).toEqual({ ok: false, reason: "connection problem", retry: true });
    expect(smtpOutcome({ code: "ETIMEDOUT" })).toEqual({ ok: false, reason: "connection problem", retry: true });
  });

  it("retries a failed login with the server's reply", () => {
    expect(
      smtpOutcome({ code: "EAUTH", responseCode: 535, response: "535 5.7.8 Username and Password not accepted" }),
    ).toEqual({
      ok: false,
      reason: "535 5.7.8 Username and Password not accepted",
      retry: true,
    });
  });

  it("retries a 4xx reply, but not a 5xx reply or an envelope error", () => {
    expect(smtpOutcome({ responseCode: 451, response: "451 4.3.0 Try later" })).toEqual({
      ok: false,
      reason: "451 4.3.0 Try later",
      retry: true,
    });
    expect(
      smtpOutcome({ responseCode: 550, response: "550 5.1.1 The email account that you tried to reach does not exist" }),
    ).toEqual({
      ok: false,
      reason: "550 5.1.1 The email account that you tried to reach does not exist",
      retry: false,
    });
    expect(smtpOutcome({ code: "EENVELOPE", message: "No recipients defined" })).toEqual({
      ok: false,
      reason: "No recipients defined",
      retry: false,
    });
  });

  it("cuts a long reply to 200 characters", () => {
    const outcome = smtpOutcome({ responseCode: 550, response: "x".repeat(300) });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toHaveLength(200);
  });
});

describe("resendOutcome", () => {
  it("treats the daily quota as the daily limit", () => {
    expect(resendOutcome({ name: "daily_quota_exceeded", message: "Daily quota exceeded" })).toEqual({
      ok: false,
      reason: "daily sending limit reached",
      retry: true,
    });
  });

  it("retries a rate limit, a server error, and a key error", () => {
    expect(resendOutcome({ name: "rate_limit_exceeded", message: "Too many requests" })).toEqual({
      ok: false,
      reason: "Too many requests",
      retry: true,
    });
    expect(resendOutcome({ statusCode: 500, message: "Oops" })).toEqual({ ok: false, reason: "Oops", retry: true });
    expect(resendOutcome({ name: "invalid_api_key", message: "Invalid API key" })).toEqual({
      ok: false,
      reason: "Invalid API key",
      retry: true,
    });
  });

  it("does not retry a rejected message", () => {
    expect(resendOutcome({ name: "validation_error", message: "Bad" })).toEqual({
      ok: false,
      reason: "Bad",
      retry: false,
    });
  });

  it("treats a network failure as a connection problem", () => {
    expect(resendOutcome(new TypeError("fetch failed"))).toEqual({
      ok: false,
      reason: "connection problem",
      retry: true,
    });
  });
});

describe("sendEmails outcomes", () => {
  it("reports one outcome per message over SMTP", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("SMTP_HOST", "smtp.gmail.com");
    vi.stubEnv("SMTP_PORT", "");
    vi.stubEnv("SMTP_USER", "paperline@gmail.com");
    vi.stubEnv("SMTP_PASS", "app-password");
    vi.stubEnv("EMAIL_FROM", "paperline@gmail.com");
    const refused = Object.assign(new Error("550 5.1.1 unknown"), { responseCode: 550 });
    sendMail.mockRejectedValueOnce(refused).mockResolvedValueOnce({}).mockResolvedValueOnce({});

    const { sent, failed, results } = await sendEmails([
      message("gone@example.com"),
      message("b@example.com"),
      message("c@example.com"),
    ]);

    expect({ sent, failed }).toEqual({ sent: 2, failed: 1 });
    expect(results).toEqual([
      { ok: false, reason: "550 5.1.1 unknown", retry: false },
      { ok: true },
      { ok: true },
    ]);
  });

  it("reports a rejected address and a refused batch through Resend", async () => {
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "Portal <notify@example.com>");

    batchSend.mockResolvedValueOnce(accepted([{ index: 1, message: "Invalid `to` field" }]));
    const first = sendEmails([message("a@example.com"), message("b@example.com")]);
    await vi.runAllTimersAsync();
    expect((await first).results).toEqual([
      { ok: true },
      { ok: false, reason: "Invalid `to` field", retry: false },
    ]);

    batchSend.mockResolvedValue({ data: null, error: { name: "rate_limit_exceeded", statusCode: 429, message: "Too many requests" } });
    const second = sendEmails([message("c@example.com"), message("d@example.com")]);
    await vi.runAllTimersAsync();
    const report = await second;
    expect(report).toMatchObject({ sent: 0, failed: 2 });
    expect(report.results).toEqual([
      { ok: false, reason: "Too many requests", retry: true },
      { ok: false, reason: "Too many requests", retry: true },
    ]);
  });

  it("reports every message as not set up when the email config is broken", async () => {
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "");

    const report = await sendEmails([message("a@example.com"), message("b@example.com")]);
    expect(report).toMatchObject({ sent: 0, failed: 2 });
    expect(report.results).toEqual([
      { ok: false, reason: "email is not set up", retry: true },
      { ok: false, reason: "email is not set up", retry: true },
    ]);
  });

  it("reports success for every message in log mode", async () => {
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("EMAIL_FROM", "");

    const report = await sendEmails([message("a@example.com")]);
    expect(report).toMatchObject({ sent: 1, failed: 0 });
    expect(report.results).toEqual([{ ok: true }]);
  });
});
