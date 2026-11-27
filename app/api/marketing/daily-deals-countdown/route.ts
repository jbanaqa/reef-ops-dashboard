import { dailyDealsCountdownGif } from "@/lib/marketing/daily-deals-countdown";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = {
  "Content-Type": "image/gif",
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};

function parseDeadline(value: string | null) {
  if (value === null) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return 0;
  const deadline = Date.parse(value);
  const canonical = value.includes(".") ? value : value.replace(/Z$/, ".000Z");
  return Number.isFinite(deadline) && new Date(deadline).toISOString() === canonical ? deadline : 0;
}

export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return new Response(dailyDealsCountdownGif(new Date(), {
    deadline: parseDeadline(params.get("deadline")),
    background: params.get("background") === "plum" ? "plum" : undefined,
  }), { headers });
}

export function HEAD() {
  return new Response(null, { headers });
}
