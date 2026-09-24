import "server-only";
import { Resend } from "resend";
import { APP_NAME } from "@/lib/constants";
import type { EmailContent } from "@/lib/email/templates";

export type EmailMessage = EmailContent & {
  to: string;
  /** Shown as "{fromName} via Client Portal". */
  fromName: string;
  replyTo?: string;
};

const BATCH_SIZE = 100; // Resend's per-call maximum
const PAUSE_MS = 600; // stay under Resend's default 2 requests per second

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
 * Sends emails in batches. Failures are logged and counted, never thrown.
 * Without RESEND_API_KEY each email is logged instead (development, tests);
 * in a Vercel production deployment a missing key is an error, never log mode.
 */
export async function sendEmails(messages: EmailMessage[]): Promise<{ sent: number; failed: number }> {
  if (messages.length === 0) return { sent: 0, failed: 0 };

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (process.env.VERCEL_ENV === "production") {
      console.error(`[email] RESEND_API_KEY is not set; ${messages.length} emails not sent`);
      return { sent: 0, failed: messages.length };
    }
    for (const m of messages) {
      console.log(`[email] to=${m.to} subject=${JSON.stringify(m.subject)}\n${m.text}`);
    }
    return { sent: messages.length, failed: 0 };
  }

  const address = senderAddress();
  if (!address) {
    console.error(`[email] EMAIL_FROM is not set; ${messages.length} emails not sent`);
    return { sent: 0, failed: messages.length };
  }

  const resend = new Resend(apiKey);
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
    const batch = messages.slice(i, i + BATCH_SIZE);
    try {
      // Permissive: Resend sends the valid messages even if one is rejected.
      const { data, error } = await resend.batch.send(
        batch.map((m) => ({
          from: fromHeader(m.fromName, address),
          to: m.to,
          subject: m.subject,
          html: m.html,
          text: m.text,
          replyTo: m.replyTo,
        })),
        { batchValidation: "permissive" },
      );
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
