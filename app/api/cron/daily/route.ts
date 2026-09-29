import { NextResponse, type NextRequest } from "next/server";
import { refuseUnlessCron } from "@/lib/cron";
import { runDailyJobs } from "@/lib/daily-jobs";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

/** Vercel Cron calls this once a day with Authorization: Bearer ${CRON_SECRET}. */
export async function GET(request: NextRequest) {
  const refused = refuseUnlessCron(request);
  if (refused) return refused;

  const summary = await runDailyJobs(createAdminClient());
  console.log(JSON.stringify({ job: "daily", ...summary }));
  // An error status marks the run as failed in Vercel's cron logs.
  const ok =
    summary.failedFirms === 0 &&
    !summary.outboxFailed &&
    summary.outbox.retrying === 0 &&
    summary.outbox.gaveUp === 0;
  return NextResponse.json(summary, { status: ok ? 200 : 500 });
}
