import { Resend } from "resend";
import { deliveryEvent, ingestShopify } from "@/lib/marketing/ingest";
import { date } from "@/lib/marketing/rules";
import { shop, signature } from "@/lib/marketing/store";
export async function POST(request: Request) {
  const source = new URL(request.url).searchParams.get("source");
  const raw = await request.text();
  if (raw.length > 1000000) return new Response("Payload too large", { status: 413 });
  try {
    if (source === "shopify") {
      if (request.headers.get("x-shopify-shop-domain") !== shop() || !signature(raw, request.headers.get("x-shopify-hmac-sha256"), process.env.SHOPIFY_CLIENT_SECRET)) return new Response("Invalid signature", { status: 401 });
      const topic = request.headers.get("x-shopify-topic") || "", id = request.headers.get("x-shopify-event-id") || request.headers.get("x-shopify-webhook-id");
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
        "orders/create",
        "checkouts/create",
      ];
      if (!id || !supportedTopics.includes(topic)) return new Response("Unsupported event", { status: 400 });
      await ingestShopify(topic, `shopify:${topic}:${id}`, JSON.parse(raw));
    } else if (source === "resend") {
      if (!process.env.RESEND_WEBHOOK_SECRET) return new Response("Not configured", { status: 503 });
      let event;
      try { event = new Resend(process.env.RESEND_API_KEY).webhooks.verify({ payload: raw, headers: { id: request.headers.get("svix-id") || "", timestamp: request.headers.get("svix-timestamp") || "", signature: request.headers.get("svix-signature") || "" }, webhookSecret: process.env.RESEND_WEBHOOK_SECRET }); }
      catch { return new Response("Invalid signature", { status: 401 }); }
      const types: Record<string, string> = { "email.delivered": "DELIVERED", "email.opened": "OPENED", "email.clicked": "CLICKED", "email.bounced": "BOUNCED", "email.complained": "COMPLAINED", "email.failed": "FAILED" };
      const p = event as unknown as { type: string; created_at: string; data: { email_id: string } };
      if (types[p.type]) await deliveryEvent(`resend:${request.headers.get("svix-id")}`, p.data.email_id, types[p.type], date(p.created_at), p.data);
    } else if (source === "sms" || source === "delivery") {
      const timestamp = request.headers.get("x-marketing-timestamp") || "";
      if (Math.abs(Date.now() - Number(timestamp) * 1000) > 300000 || !signature(`${timestamp}.${raw}`, request.headers.get("x-marketing-signature"), source === "sms" ? process.env.MARKETING_SMS_WEBHOOK_SECRET : process.env.MARKETING_DELIVERY_WEBHOOK_SECRET)) return new Response("Invalid signature", { status: 401 });
      const p = JSON.parse(raw); if (!p.id) return new Response("Event ID required", { status: 400 });
      if (source === "sms") await deliveryEvent(`sms:${p.id}`, `sms:${p.messageId}`, p.type, date(p.occurredAt), p);
      else await ingestShopify("delivery/scheduled", `delivery:${p.id}`, p);
    } else return new Response("Unknown source", { status: 400 });
    return Response.json({ ok: true });
  } catch (e) { console.error("Marketing webhook processing failed", e); return new Response("Event not accepted; retry delivery", { status: 500 }); }
}
