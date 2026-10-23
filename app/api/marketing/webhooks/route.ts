import { ingestionEnabled, queueShopify } from "@/lib/marketing/inbox";
import { Resend } from "resend";
import { deliveryEvent, ingestShopify } from "@/lib/marketing/ingest";
import { date } from "@/lib/marketing/rules";
import { shop, signature } from "@/lib/marketing/store";
import { prisma } from "@/lib/prisma";
import { currentMarketingBrand, marketingBrandForShop, marketingEnv, runWithMarketingBrand } from "@/lib/marketing/context";
export async function POST(request: Request) {
  const url = new URL(request.url);
  const requested = url.searchParams.get("brand");
  if (requested && !["corals-anonymous", "macroalgae-farms"].includes(requested)) return new Response("Unknown brand", { status: 400 });
  const brand = url.searchParams.get("source") === "shopify"
    ? marketingBrandForShop(request.headers.get("x-shopify-shop-domain") || "")
    : requested === "macroalgae-farms" ? "macroalgae-farms" : "corals-anonymous";
  if (!brand || (requested && requested !== brand)) return new Response("Unknown store", { status: 401 });
  return runWithMarketingBrand(brand, () => receiveWebhook(request));
}
async function receiveWebhook(request: Request) {
  const source = new URL(request.url).searchParams.get("source");
  const raw = await request.text();
  if (raw.length > 1000000)
    return new Response("Payload too large", { status: 413 });
  try {
    if (source === "shopify") {
      if (
        request.headers.get("x-shopify-shop-domain") !== shop() ||
        !signature(
          raw,
          request.headers.get("x-shopify-hmac-sha256"),
          marketingEnv("SHOPIFY_CLIENT_SECRET"),
        )
      )
        return new Response("Invalid signature", { status: 401 });
      const topic = request.headers.get("x-shopify-topic") || "",
        id =
          request.headers.get("x-shopify-event-id") ||
          request.headers.get("x-shopify-webhook-id");
      // Shopify API versions that moved customer tags out of the customer
      // payload deliver these dedicated topics instead of a `tags` field on
      // customers/update. Keep both spellings so existing subscriptions and
      // GraphQL-created subscriptions are accepted.
      const supportedTopics = [
        "customers/create",
        "customers/update",
        "customer.tags_added",
        "customer.tags_removed",
        "customers/tags_added",
        "customers/tags_removed",
        "customers_email_marketing_consent/update",
        "customers_marketing_consent/update",
        "orders/create",
        "orders/updated",
        "checkouts/create",
        "checkouts/update",
      ];
      if (!id || !supportedTopics.includes(topic))
        return new Response("Unsupported event", { status: 400 });
      if (currentMarketingBrand() === "macroalgae-farms" && !["customers/create", "customers/update", "customers_email_marketing_consent/update", "customers_marketing_consent/update", "orders/create", "orders/updated"].includes(topic))
        return new Response("Unsupported Macroalgae Farms event", { status: 400 });
      if (!(await ingestionEnabled()))
        return new Response("Marketing ingestion paused; retry later", {
          status: 503,
        });
      await queueShopify(topic, `shopify:${topic}:${id}`, JSON.parse(raw));
    } else if (source === "resend") {
      if (!marketingEnv("RESEND_WEBHOOK_SECRET"))
        return new Response("Not configured", { status: 503 });
      let event;
      try {
        event = new Resend(marketingEnv("RESEND_API_KEY")).webhooks.verify({
          payload: raw,
          headers: {
            id: request.headers.get("svix-id") || "",
            timestamp: request.headers.get("svix-timestamp") || "",
            signature: request.headers.get("svix-signature") || "",
          },
          webhookSecret: marketingEnv("RESEND_WEBHOOK_SECRET")!,
        });
      } catch {
        return new Response("Invalid signature", { status: 401 });
      }
      const types: Record<string, string> = {
        "email.delivered": "DELIVERED",
        "email.opened": "OPENED",
        "email.clicked": "CLICKED",
        "email.bounced": "BOUNCED",
        "email.complained": "COMPLAINED",
        "email.failed": "FAILED",
      };
      const p = event as unknown as {
        type: string;
        created_at: string;
        data: { email_id: string };
      };
      if (types[p.type]) {
        const message = await prisma.marketingMessage.findUnique({ where: { providerId: p.data.email_id }, select: { shop: true } });
        const test = message ? null : await prisma.marketingEvent.findFirst({ where: { key: `test-provider:${p.data.email_id}`, type: "TEST_SENT" }, select: { shop: true } });
        const owner = marketingBrandForShop(message?.shop || test?.shop || "");
        if (!owner) throw Error("Message not recorded yet; retry event.");
        const requested = new URL(request.url).searchParams.get("brand");
        if (requested && requested !== owner) return new Response("Message belongs to another store", { status: 403 });
        await runWithMarketingBrand(owner, () => deliveryEvent(
          `resend:${request.headers.get("svix-id")}`,
          p.data.email_id,
          types[p.type],
          date(p.created_at),
          p.data,
        ));
      }
    } else if (source === "sms" || source === "delivery") {
      if (currentMarketingBrand() !== "corals-anonymous") return new Response("Unsupported source", { status: 400 });
      const timestamp = request.headers.get("x-marketing-timestamp") || "";
      if (
        !/^\d+$/.test(timestamp) ||
        Math.abs(Date.now() - Number(timestamp) * 1000) > 300000 ||
        !signature(
          `${timestamp}.${raw}`,
          request.headers.get("x-marketing-signature"),
          source === "sms"
            ? process.env.MARKETING_SMS_WEBHOOK_SECRET
            : process.env.MARKETING_DELIVERY_WEBHOOK_SECRET,
        )
      )
        return new Response("Invalid signature", { status: 401 });
      const p = JSON.parse(raw);
      if (!p.id) return new Response("Event ID required", { status: 400 });
      if (source === "sms")
        await deliveryEvent(
          `sms:${p.id}`,
          `sms:${p.messageId}`,
          p.type,
          date(p.occurredAt),
          p,
        );
      else await ingestShopify("delivery/scheduled", `delivery:${p.id}`, p);
    } else return new Response("Unknown source", { status: 400 });
    return Response.json({ ok: true });
  } catch (e) {
    console.error("Marketing webhook processing failed", e);
    return new Response("Event not accepted; retry delivery", { status: 500 });
  }
}
