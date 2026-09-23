import { prisma } from "@/lib/prisma";
import { atomic, consent, shop } from "@/lib/marketing/store";
import { queueShopifyEmailUnsubscribe, syncShopifyEmailUnsubscribes } from "@/lib/marketing/unsubscribe";
export const dynamic = "force-dynamic";
const headers = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};
const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Corals Anonymous</title></head><body style="margin:0;background:#f3f8fb;color:#12304c;font:16px Arial,sans-serif"><main style="box-sizing:border-box;max-width:520px;margin:12vh auto;padding:32px;background:white;border-radius:12px;text-align:center;box-shadow:0 4px 24px #12304c18"><h1>${title}</h1>${body}</main></body></html>`;
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (params.get("preview") === "1" && !params.has("token"))
    return new Response(
      "This is an internal preview email. No subscription was changed. Use an actual workflow email to test unsubscribe.",
      {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      },
    );
  const token = params.get("token");
  if (!token || !/^[a-f0-9-]{36}$/i.test(token))
    return new Response("Invalid link", { status: 400 });
  const message = await prisma.marketingMessage.findFirst({
    where: { token, shop: shop() }, select: { channel: true },
  });
  if (!message) return new Response("Invalid link", { status: 404, headers });
  const label = message.channel === "EMAIL" ? "emails" : "messages";
  return new Response(page("Marketing preferences", `<p style="line-height:1.5">Stop receiving marketing ${label} from Corals Anonymous.</p><form method="post" style="margin-top:24px"><button style="background:#134d78;color:white;border:0;border-radius:6px;padding:13px 22px;font-size:16px;cursor:pointer">Unsubscribe from ${label}</button></form>`), { headers });
}
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("token") || "";
  const message = await prisma.marketingMessage.findFirst({
    where: { token, shop: shop() },
  });
  if (!message) return new Response("Invalid link", { status: 404 });
  await atomic(async (tx) => {
    const at = new Date();
    await consent(
      tx,
      message.profileId,
      message.channel as "EMAIL" | "SMS_MARKETING" | "SMS_TRANSACTIONAL",
      "UNSUBSCRIBED",
      "unsubscribe-link",
      at,
    );
    if (message.channel === "EMAIL")
      await queueShopifyEmailUnsubscribe(tx, message.profileId, at);
  });
  // Local suppression succeeds even if Shopify is temporarily unavailable.
  // The scheduled worker retries the durable sync request.
  if (message.channel === "EMAIL")
    await syncShopifyEmailUnsubscribes(1, message.profileId).catch(() => {});
  return new Response(page("You’re unsubscribed", `<p style="line-height:1.5">You will no longer receive Corals Anonymous marketing ${message.channel === "EMAIL" ? "emails" : "messages"}.${message.channel === "EMAIL" ? " Your preference is being synchronized with our store." : ""}</p>`), { headers });
}
