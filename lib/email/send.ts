import "server-only";
import { createTransport } from "nodemailer";
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

/** SMTP settings when SMTP_HOST is set, for example Gmail with an app password. */
function smtpSettings() {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT) || 465;
  return { host, port, user: process.env.SMTP_USER?.trim(), pass: process.env.SMTP_PASS };
}

/**
 * Why emails cannot be sent, or null. SMTP_HOST sends over SMTP, RESEND_API_KEY
 * through Resend. With neither, emails are logged instead (development, tests),
 * except in a Vercel production deployment.
 */
export function emailConfigError(): string | null {
  const smtp = smtpSettings();
  if (smtp && (!smtp.user || !smtp.pass)) return "SMTP_USER and SMTP_PASS must be set with SMTP_HOST";
  if (!smtp && !process.env.RESEND_API_KEY) {
    return process.env.VERCEL_ENV === "production" ? "RESEND_API_KEY or SMTP_HOST is not set" : null;
  }
  return senderAddress() ? null : "EMAIL_FROM is not set";
}

/**
 * One pooled connection for the whole call, so the server sees one login.
 * ponytail: Gmail allows about 500 emails a day. Upgrade path: a domain verified
 * in Resend, with RESEND_API_KEY set and SMTP_HOST removed.
 */
async function sendOverSmtp(
  smtp: NonNullable<ReturnType<typeof smtpSettings>>,
  address: string,
  messages: EmailMessage[],
): Promise<{ sent: number; failed: number }> {
  const transport = createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465, // TLS from the start; 587 upgrades with STARTTLS
    pool: true,
    auth: { user: smtp.user, pass: smtp.pass },
  });
  const results = await Promise.allSettled(
    messages.map((m) =>
      transport.sendMail({
        from: fromHeader(m.fromName, address),
        to: m.to,
        subject: m.subject,
        html: m.html,
        text: m.text,
        replyTo: m.replyTo,
      }),
    ),
  );
  transport.close();

  let failed = 0;
  results.forEach((result, index) => {
    if (result.status === "fulfilled") return;
    failed++;
    console.error("[email] rejected", messages[index].to, result.reason);
  });
  return { sent: messages.length - failed, failed };
}

/** Sends emails over SMTP, or through Resend in batches. Failures are logged and counted, never thrown. */
export async function sendEmails(messages: EmailMessage[]): Promise<{ sent: number; failed: number }> {
  if (messages.length === 0) return { sent: 0, failed: 0 };

  const configError = emailConfigError();
  if (configError) {
    console.error(`[email] ${configError}; ${messages.length} emails not sent`);
    return { sent: 0, failed: messages.length };
  }

  const smtp = smtpSettings();
  const apiKey = process.env.RESEND_API_KEY;
  const address = senderAddress();
  if (smtp && address) return sendOverSmtp(smtp, address, messages);
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
