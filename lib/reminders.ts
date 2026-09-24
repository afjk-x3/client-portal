import { daysBetween } from "@/lib/dates";

/**
 * Whether an open request gets a reminder today. All dates are YYYY-MM-DD
 * in UTC. Reminders go out 7 days before the due date, on the due date, and
 * every 3 days after it, but never on the day the request was sent.
 */
export function reminderDue({
  dueDate,
  sentOn,
  today,
}: {
  dueDate: string;
  sentOn: string;
  today: string;
}): boolean {
  if (sentOn === today) return false;
  const d = daysBetween(today, dueDate);
  return d === 7 || d === 0 || (d < 0 && -d % 3 === 0);
}
