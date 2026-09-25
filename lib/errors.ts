import type { z } from "zod";

/** What every Server Action returns. */
export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

type SupabaseError = { message: string; code?: string } | null | undefined;

const MESSAGES: Record<string, string> = {
  not_allowed: "That isn't available to you. It may have been removed.",
  invalid_state: "This has changed since the page loaded. Refresh and try again.",
  invalid_time_zone: "Pick a time zone from the list.",
};

/**
 * User-facing text for a Supabase error. RPCs raise `not_allowed` or
 * `invalid_state`; Postgres errors arrive as SQLSTATE codes. `overrides`
 * maps a SQLSTATE code to a message for one call site.
 */
export function errorMessage(error: SupabaseError, overrides: Record<string, string> = {}): string {
  if (error?.code && Object.hasOwn(overrides, error.code)) return overrides[error.code];
  if (error && Object.hasOwn(MESSAGES, error.message)) return MESSAGES[error.message];
  if (error?.code === "42501" || error?.code === "23503") return MESSAGES.not_allowed;
  if (error?.code === "23505") return "That already exists.";
  if (error?.code === "23514") return "A value is empty or too long.";
  console.error("Unexpected Supabase error", error);
  return "Something went wrong. Try again.";
}

export function fail(error: SupabaseError, overrides?: Record<string, string>): { ok: false; error: string } {
  return { ok: false, error: errorMessage(error, overrides) };
}

/** A failed guarded update: no row matched the expected state. */
export const staleState = { message: "invalid_state" };
/** No row visible to the caller. */
export const notFound = { message: "not_allowed" };

export function invalid(error: z.ZodError): { ok: false; error: string } {
  return { ok: false, error: error.issues[0]?.message ?? "Check the form and try again." };
}
