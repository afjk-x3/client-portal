import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emailConfigError, sendEmails, type EmailMessage } from "@/lib/email/send";

vi.mock("server-only", () => ({}));
const { batchSend } = vi.hoisted(() => ({ batchSend: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class {
    batch = { send: batchSend };
  },
}));

const message = (to: string): EmailMessage => ({ subject: "S", html: "<p>H</p>", text: "H", to, fromName: "Ledger & Co" });
const accepted = (errors: { index: number; message: string }[] = []) => ({ data: { data: [], errors }, error: null });

beforeEach(() => {
  vi.useFakeTimers();
  batchSend.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("emailConfigError", () => {
  it("allows log mode outside production only", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("VERCEL_ENV", "");
    expect(emailConfigError()).toBeNull();
    vi.stubEnv("VERCEL_ENV", "production");
    expect(emailConfigError()).toBe("RESEND_API_KEY is not set");
  });

  it("needs a sender address with a key", () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "");
    expect(emailConfigError()).toBe("EMAIL_FROM is not set");
    vi.stubEnv("EMAIL_FROM", "Portal <notify@example.com>");
    expect(emailConfigError()).toBeNull();
  });
});

describe("sendEmails", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "Portal <notify@example.com>");
  });

  it("sends batches of 100 and counts rejected addresses", async () => {
    batchSend.mockResolvedValue(accepted([{ index: 1, message: "Invalid `to` field" }]));
    const result = sendEmails(Array.from({ length: 150 }, (_, i) => message(`c${i}@example.com`)));
    await vi.runAllTimersAsync();

    expect(await result).toEqual({ sent: 148, failed: 2 });
    expect(batchSend.mock.calls.map(([payload]) => payload.length)).toEqual([100, 50]);
    expect(batchSend.mock.calls[0][0][0].from).toBe('"Ledger & Co via Client Portal" <notify@example.com>');
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
