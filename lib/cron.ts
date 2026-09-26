import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

// Equal-length digests, as timingSafeEqual requires.
const sha256 = (value: string) => createHash("sha256").update(value).digest();

/** A 401 unless the request carries Authorization: Bearer ${CRON_SECRET}, as Vercel Cron sends; otherwise null. */
export function refuseUnlessCron(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron] CRON_SECRET is not set, so every call is refused");
    return new NextResponse("Unauthorized", { status: 401 });
  }
  if (!timingSafeEqual(sha256(request.headers.get("authorization") ?? ""), sha256(`Bearer ${secret}`))) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  return null;
}
