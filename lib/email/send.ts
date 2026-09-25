import "server-only";
import { Resend } from "resend";
import { APP_NAME } from "@/lib/constants";
import type { EmailContent } from "@/lib/email/templates";

export type EmailMessage = EmailContent & {
  to: string;
  /** Shown as "{fromName} via {APP_NAME}". */
  fromName: string;
  replyTo?: string;
};

export const EMAIL_BATCH_SIZE = 100; // Resend's per-call maximum
const PAUSE_MS = 600; // stay under Resend's default 2 requests per second

let nextCallAt = 0;

/** Waits for this process's next Resend slot, so concurrent callers stay under the rate limit too. */
async function waitForSlot() {
  const now = Date.now();
  const at = Math.max(now, nextCallAt);
  nextCallAt = at + PAUSE_MS;
  if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now));
}

/** The sender address from EMAIL_FROM, given as "addr" or "Name <addr>". */
function senderAddress(): string | null {
  const value = process.env.EMAIL_FROM?.trim();
  if (!value) return null;
  return value.match(/<([^<>\s]+@[^<>\s]+)>/)?.[1] ?? value;
}

function fromHeader(fromName: string, address: string): string {
  const name = `${fromName} via ${APP_NAME}`.replace(/["<>\r\n]/g, "");
  return `"${name}" <${address}>`;
}

/**
 * Why emails cannot be sent, or null. Without RESEND_API_KEY emails are logged
 * instead (development, tests), except in a Vercel production deployment.
 */
export function emailConfigError(): string | null {
  if (!process.env.RESEND_API_KEY) {
    return process.env.VERCEL_ENV === "production" ? "RESEND_API_KEY is not set" : null;
  }
  return senderAddress() ? null : "EMAIL_FROM is not set";
}

/** Sends emails in batches. Failures are logged and counted, never thrown. */
export async function sendEmails(messages: EmailMessage[]): Promise<{ sent: number; failed: number }> {
  if (messages.length === 0) return { sent: 0, failed: 0 };

  const configError = emailConfigError();
  if (configError) {
    console.error(`[email] ${configError}; ${messages.length} emails not sent`);
    return { sent: 0, failed: messages.length };
  }

  const apiKey = process.env.RESEND_API_KEY;
  const address = senderAddress();
  if (!apiKey || !address) {
    for (const m of messages) {
      console.log(`[email] to=${m.to} subject=${JSON.stringify(m.subject)}\n${m.text}`);
    }
    return { sent: messages.length, failed: 0 };
  }

  const resend = new Resend(apiKey);
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < messages.length; i += EMAIL_BATCH_SIZE) {
    await waitForSlot();
    const batch = messages.slice(i, i + EMAIL_BATCH_SIZE);
    const payload = batch.map((m) => ({
      from: fromHeader(m.fromName, address),
      to: m.to,
      subject: m.subject,
      html: m.html,
      text: m.text,
      replyTo: m.replyTo,
    }));
    // Permissive: Resend sends the valid messages even if one is rejected.
    const sendBatch = () => resend.batch.send(payload, { batchValidation: "permissive" });
    try {
      let result = await sendBatch();
      if (result.error?.name === "rate_limit_exceeded") {
        // Another instance can share the limit, which Resend counts per second.
        await new Promise((resolve) => setTimeout(resolve, 1000));
        result = await sendBatch();
      }
      const { data, error } = result;
      if (error) throw error;
      for (const rejected of data.errors) {
        console.error("[email] rejected", batch[rejected.index]?.to, rejected.message);
      }
      failed += data.errors.length;
      sent += batch.length - data.errors.length;
    } catch (error) {
      failed += batch.length;
      console.error("[email] batch failed", error);
    }
  }
  return { sent, failed };
}
