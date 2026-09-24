import { NextResponse, type NextRequest } from "next/server";
import { runDailyJobs } from "@/lib/daily-jobs";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

/** Vercel Cron calls this once a day with Authorization: Bearer ${CRON_SECRET}. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const summary = await runDailyJobs(createAdminClient());
  console.log(JSON.stringify({ job: "daily", ...summary }));
  return NextResponse.json(summary);
}
