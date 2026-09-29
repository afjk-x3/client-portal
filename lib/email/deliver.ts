import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { sendEmails, type EmailMessage } from "@/lib/email/send";

/**
 * Sends the outbox rows queued for this action, then records each outcome
 * (§5.4). A recording that fails is logged and never thrown: the send already
 * happened, and the row waits for the daily job's next attempt to learn it.
 */
export async function deliver(
  supabase: SupabaseClient<Database>,
  messages: (EmailMessage & { emailId: number })[],
): Promise<void> {
  if (messages.length === 0) return;
  const { results } = await sendEmails(messages);
  for (const [index, outcome] of results.entries()) {
    const emailId = messages[index].emailId;
    const { error } = await supabase.rpc(
      "record_email_result",
      outcome.ok ? { email_id: emailId } : { email_id: emailId, reason: outcome.reason, retry: outcome.retry },
    );
    if (error) console.error("Could not record the email result", error);
  }
}
