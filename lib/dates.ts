// ponytail: dates, due dates, and "overdue" use UTC. Upgrade path: add
// firms.timezone and compute "today" per firm.

const DAY_MS = 86_400_000;

/** Today's date in UTC as YYYY-MM-DD. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; both are YYYY-MM-DD. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export function isOverdue(dueDate: string, today: string = todayUtc()): boolean {
  return dueDate < today;
}

/** "Mar 5, 2027" for a YYYY-MM-DD date. */
export function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "Mar 5, 2027, 2:30 PM UTC" for a timestamp. */
export function formatDateTime(timestamp: string): string {
  const formatted = new Date(timestamp).toLocaleString("en-US", {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  });
  return `${formatted} UTC`;
}

/** YYYY-MM-DD for a date picked in the browser (local calendar day). */
export function toDateString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A local Date for a YYYY-MM-DD string, for date pickers. */
export function fromDateString(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}
