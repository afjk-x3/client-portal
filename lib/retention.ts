/** The typed confirmation equals the client's name once trimmed; case still matters. */
export function confirmsName(typed: string, name: string): boolean {
  return typed.trim() === name;
}

/** The retention periods a firm may pick, in years. */
export const RETENTION_YEARS = [1, 2, 3, 5, 7, 10] as const;

/** True when `next` is a period and `current` is Forever or a longer one. */
export function isShorterRetention(current: number | null, next: number | null): boolean {
  return next !== null && (current === null || next < current);
}

/** The next 02:00 UTC cleanup run, strictly after `now` (matches the cron in vercel.json). */
export function nextCleanupAt(now: Date): Date {
  const next = new Date(now);
  next.setUTCHours(2, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}
