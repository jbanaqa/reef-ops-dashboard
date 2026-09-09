import { prisma } from "@/lib/prisma";
import { atomic, consent, shop } from "@/lib/marketing/store";
export const dynamic = "force-dynamic";
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
  return new Response(
    `<html><body><h1>Unsubscribe</h1><p>Stop receiving marketing messages on this channel from Corals Anonymous.</p><form method="post"><button>Confirm unsubscribe</button></form></body></html>`,
    {
      headers: {
        "Content-Type": "text/html",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("token") || "";
  const message = await prisma.marketingMessage.findFirst({
    where: { token, shop: shop() },
  });
  if (!message) return new Response("Invalid link", { status: 404 });
  await atomic((tx) =>
    consent(
      tx,
      message.profileId,
      message.channel as "EMAIL" | "SMS_MARKETING" | "SMS_TRANSACTIONAL",
      "UNSUBSCRIBED",
      "unsubscribe-link",
      new Date(),
    ),
  );
  return new Response("You are unsubscribed from this channel.", {
    headers: { "Cache-Control": "no-store" },
  });
}
