"use server";

import { homePath } from "@/lib/auth";
import { safeNextPath } from "@/lib/safe-next-path";

/** Where to go after a successful sign-in. */
export async function signInDestination(next: string | null): Promise<string> {
  return safeNextPath(next) ?? (await homePath());
}
