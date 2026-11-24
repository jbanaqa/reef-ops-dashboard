import { dailyDealsCountdownGif } from "@/lib/marketing/daily-deals-countdown";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = {
  "Content-Type": "image/gif",
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};

export function GET() {
  return new Response(dailyDealsCountdownGif(), { headers });
}

export function HEAD() {
  return new Response(null, { headers });
}
