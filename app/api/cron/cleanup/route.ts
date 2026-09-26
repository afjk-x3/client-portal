import { NextResponse, type NextRequest } from "next/server";
import { runCleanup } from "@/lib/cleanup";
import { refuseUnlessCron } from "@/lib/cron";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

/** Vercel Cron calls this once a day, an hour after the daily job. */
export async function GET(request: NextRequest) {
  const refused = refuseUnlessCron(request);
  if (refused) return refused;

  const summary = await runCleanup(createAdminClient());
  console.log(JSON.stringify({ job: "cleanup", ...summary }));
  // An error status marks the run as failed in Vercel's cron logs.
  return NextResponse.json(summary, { status: summary.failed === 0 ? 200 : 500 });
}
