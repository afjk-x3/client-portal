import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runDailyJobs } from "@/lib/daily-jobs";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

// Equal-length digests, as timingSafeEqual requires.
const sha256 = (value: string) => createHash("sha256").update(value).digest();

/** Vercel Cron calls this once a day with Authorization: Bearer ${CRON_SECRET}. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron] CRON_SECRET is not set, so every call is refused");
    return new NextResponse("Unauthorized", { status: 401 });
  }
  if (!timingSafeEqual(sha256(request.headers.get("authorization") ?? ""), sha256(`Bearer ${secret}`))) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const summary = await runDailyJobs(createAdminClient());
  console.log(JSON.stringify({ job: "daily", ...summary }));
  // An error status marks the run as failed in Vercel's cron logs.
  const ok = summary.failedFirms === 0 && summary.failed === 0;
  return NextResponse.json(summary, { status: ok ? 200 : 500 });
}
