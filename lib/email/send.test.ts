import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emailConfigError, sendEmails, type EmailMessage } from "@/lib/email/send";

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

    expect(result).toEqual({ sent: 2, failed: 0 });
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

  it("counts a message the server refuses as failed and still sends the rest", async () => {
    sendMail.mockRejectedValueOnce(new Error("550 5.1.1 No such user")).mockResolvedValueOnce({});

    expect(await sendEmails([message("gone@example.com"), message("b@example.com")])).toEqual({ sent: 1, failed: 1 });
    expect(closeTransport).toHaveBeenCalledTimes(1);
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

    expect(await result).toEqual({ sent: 148, failed: 2 });
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

    expect(await result).toEqual({ sent: 1, failed: 0 });
    expect(batchSend).toHaveBeenCalledTimes(2);
  });

  it("counts a batch Resend refuses as failed, without throwing", async () => {
    batchSend.mockResolvedValue({ data: null, error: { name: "validation_error", statusCode: 422, message: "Bad" } });
    const result = sendEmails([message("a@example.com"), message("b@example.com")]);
    await vi.runAllTimersAsync();

    expect(await result).toEqual({ sent: 0, failed: 2 });
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
