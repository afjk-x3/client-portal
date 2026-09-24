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

function fromHeader(fromName: string): string {
  const name = `${fromName} via ${APP_NAME}`.replace(/["<>\r\n]/g, "");
  return `"${name}" <${process.env.EMAIL_FROM}>`;
}

/**
 * Sends emails in batches. Failures are logged and counted, never thrown.
 * Without RESEND_API_KEY (development, tests) each email is logged instead.
 */
export async function sendEmails(messages: EmailMessage[]): Promise<{ sent: number; failed: number }> {
  if (messages.length === 0) return { sent: 0, failed: 0 };

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    for (const m of messages) {
      console.log(`[email] to=${m.to} subject=${JSON.stringify(m.subject)}\n${m.text}`);
    }
    return { sent: messages.length, failed: 0 };
  }

  const resend = new Resend(apiKey);
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
    const batch = messages.slice(i, i + BATCH_SIZE);
    try {
      const { error } = await resend.batch.send(
        batch.map((m) => ({
          from: fromHeader(m.fromName),
          to: m.to,
          subject: m.subject,
          html: m.html,
          text: m.text,
          replyTo: m.replyTo,
        })),
      );
      if (error) throw error;
      sent += batch.length;
    } catch (error) {
      failed += batch.length;
      console.error("[email] batch failed", error);
    }
  }
  return { sent, failed };
}
