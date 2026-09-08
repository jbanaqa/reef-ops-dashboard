import { isDashboardRequestAuthorized } from "@/lib/dashboard-request-auth";
import { prisma } from "@/lib/prisma";
import { audienceWhere, atomic, consent, json, record, seed, shop } from "@/lib/marketing/store";
import { content, date, defaultContent, email, render, segment } from "@/lib/marketing/rules";
import { resendProvider, setup } from "@/lib/marketing/delivery";
import { importProfiles } from "@/lib/marketing/ingest";
import { FlowConfig } from "@/lib/marketing/flows";

export const dynamic = "force-dynamic";
function authorize(request: Request) {
  if (!isDashboardRequestAuthorized(request)) return Response.json({ error: "Login required" }, { status: 401 });
  const origin = request.headers.get("origin");
  if (request.method !== "GET" && origin && origin !== new URL(request.url).origin) return Response.json({ error: "Invalid origin" }, { status: 403 });
}
export async function GET(request: Request) {
  const denied = authorize(request); if (denied) return denied;
  try {
    const url = new URL(request.url), view = url.searchParams.get("view") || "overview";
    if (view === "preview") return new Response(render(defaultContent, "#unsubscribe", process.env.MARKETING_POSTAL_ADDRESS || "Your business mailing address"), { headers: { "Content-Type": "text/html", "Cache-Control": "no-store" } });
    if (view === "profile") {
      const profile = await prisma.marketingProfile.findFirst({ where: { shop: shop(), id: url.searchParams.get("id") || "" }, include: { consents: true, events: { orderBy: { occurredAt: "desc" }, take: 100 }, messages: { orderBy: { createdAt: "desc" }, take: 100 } } });
      return Response.json({ profile });
    }
    const [profiles, campaigns, resources, counts, messageCounts, eventCounts, orders] = await Promise.all([
      prisma.marketingProfile.findMany({ where: { shop: shop(), ...(url.searchParams.get("q") ? { OR: [{ email: { contains: url.searchParams.get("q")!, mode: "insensitive" as const } }, { name: { contains: url.searchParams.get("q")!, mode: "insensitive" as const } }] } : {}) }, orderBy: { id: "asc" }, take: 100, ...(url.searchParams.get("cursor") ? { cursor: { id: url.searchParams.get("cursor")! }, skip: 1 } : {}), include: { consents: true } }),
      prisma.marketingCampaign.findMany({ where: { shop: shop() }, orderBy: { createdAt: "desc" }, take: 100, include: { _count: { select: { messages: true } } } }),
      prisma.marketingResource.findMany({ where: { shop: shop(), kind: { not: "STOCK" } }, orderBy: { updatedAt: "desc" }, take: 200 }),
      Promise.all([prisma.marketingProfile.count({ where: { shop: shop() } }), prisma.marketingProfile.count({ where: audienceWhere({ openedDays: 365 }) }), prisma.marketingConsent.count({ where: { suppressed: true, profile: { shop: shop() } } })]),
      prisma.marketingMessage.groupBy({ by: ["status", "channel", "campaignId", "flowKey"], where: { shop: shop() }, _count: true }),
      prisma.marketingEvent.groupBy({ by: ["type"], where: { shop: shop() }, _count: true }),
      prisma.marketingEvent.findMany({ where: { shop: shop(), type: "ORDER", messageId: { not: null } }, select: { payload: true, messageId: true }, take: 10000 }),
    ]);
    const revenue: Record<string, number> = {};
    for (const order of orders) { const p = order.payload as { currency: string; revenue: string }; revenue[p.currency] = (revenue[p.currency] || 0) + Number(p.revenue || 0); }
    return Response.json({ profiles, nextCursor: profiles.length === 100 ? profiles[99].id : null, campaigns, resources, counts: { profiles: counts[0], mailable: counts[1], suppressions: counts[2] }, messageCounts, eventCounts, revenue, revenueCapped: orders.length === 10000, setup: setup() }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { console.error("Marketing read failed", e); return Response.json({ error: "Marketing data is unavailable. Apply the marketing migration and configure DATABASE_URL and SHOPIFY_SHOP_DOMAIN." }, { status: 503 }); }
}
export async function POST(request: Request) {
  const denied = authorize(request); if (denied) return denied;
  try {
    const raw = await request.text(); if (raw.length > 1000000) throw new Error("Request too large.");
    const b = JSON.parse(raw);
    if (b.action === "initialize") { await seed(); return Response.json({ ok: true }); }
    if (b.action === "preview") return Response.json({ html: render(content(b.content), "#unsubscribe", process.env.MARKETING_POSTAL_ADDRESS || "Your business mailing address") });
    if (b.action === "test-email") {
      const to = email(b.to);
      const allowed = (process.env.MARKETING_TEST_EMAILS || "").split(",").map(v => v.trim().toLowerCase());
      if (!allowed.includes(to)) throw new Error("Test recipient must be listed in MARKETING_TEST_EMAILS.");
      if (!setup().emailReady) throw new Error("Complete email provider setup first.");
      const id = crypto.randomUUID();
      await resendProvider.send({ id, to, channel: "EMAIL", subject: `[TEST] ${String(b.subject || "Campaign preview").slice(0, 190)}`, content: content(b.content), unsubscribe: `${process.env.APP_BASE_URL}/our-klaviyo/settings` });
      await atomic(tx => record(tx, { key: `test:${id}`, type: "TEST_SENT", payload: { to } }));
      return Response.json({ ok: true });
    }
    if (b.action === "import") return Response.json({ results: await importProfiles(b.rows, b.dryRun !== false) });
    if (b.action === "audience-count") return Response.json({ count: await prisma.marketingProfile.count({ where: audienceWhere(segment(b.audience)) }) });
    if (b.action === "suppress") {
      const p = await prisma.marketingProfile.findFirst({ where: { id: b.id, shop: shop() } }); if (!p) throw new Error("Profile not found.");
      if (!["EMAIL", "SMS_MARKETING", "SMS_TRANSACTIONAL"].includes(b.channel)) throw new Error("Invalid channel.");
      await atomic(tx => consent(tx, p.id, b.channel, "UNSUBSCRIBED", "staff", new Date(), "Staff suppression"));
      return Response.json({ ok: true });
    }
    if (b.action === "save-campaign") {
      if (!String(b.name || "").trim() || !String(b.subject || "").trim()) throw new Error("Campaign name and subject are required.");
      const data = { name: String(b.name).slice(0, 200), subject: String(b.subject).slice(0, 200), content: json(content(b.content)), audience: json(segment(b.audience)) };
      if (b.id) { const result = await prisma.marketingCampaign.updateMany({ where: { id: b.id, shop: shop(), status: "DRAFT" }, data }); if (!result.count) throw new Error("Only drafts can be edited."); return Response.json({ id: b.id }); }
      const result = await prisma.marketingCampaign.create({ data: { shop: shop(), ...data } }); return Response.json({ id: result.id });
    }
    if (b.action === "schedule") {
      const scheduledAt = date(b.at); if (scheduledAt < new Date()) throw new Error("Choose a future send time.");
      const result = await prisma.marketingCampaign.updateMany({ where: { id: b.id, shop: shop(), status: "DRAFT" }, data: { status: "SCHEDULED", scheduledAt } });
      if (!result.count) throw new Error("Only drafts can be scheduled."); return Response.json({ ok: true, sendingEnabled: setup().sendingEnabled });
    }
    if (b.action === "cancel") {
      await atomic(async tx => {
        const c = await tx.marketingCampaign.findFirst({ where: { id: b.id, shop: shop() } }); if (!c) throw new Error("Campaign not found.");
        await tx.marketingCampaign.update({ where: { id: c.id }, data: { status: "CANCELLED" } });
        await tx.marketingMessage.updateMany({ where: { campaignId: c.id, status: "PENDING" }, data: { status: "CANCELLED" } });
      }); return Response.json({ ok: true });
    }
    if (b.action === "save-resource") {
      if (!["SEGMENT", "TEMPLATE", "FLOW"].includes(b.kind)) throw new Error("Unsupported resource.");
      let data;
      if (b.kind === "FLOW") {
        const f = b.data as FlowConfig;
        if (!Array.isArray(f.steps) || !f.steps.length || f.steps.length > 10) throw new Error("Use 1–10 flow steps.");
        for (const step of f.steps) { if (!Number.isInteger(step.minutes) || step.minutes < 0 || step.minutes > 525600) throw new Error("Invalid delay."); if (!["EMAIL", "SMS_MARKETING", "SMS_TRANSACTIONAL"].includes(step.channel)) throw new Error("Invalid channel."); step.content = content(step.content); }
        if (f.smsContent) f.smsContent = content(f.smsContent);
        if (b.enabled && f.reviewed !== true) throw new Error("Review the flow configuration before enabling.");
        data = json(f);
      } else data = json(b.kind === "SEGMENT" ? segment(b.data) : content(b.data));
      const key = String(b.key || crypto.randomUUID()).slice(0, 100);
      const result = await prisma.marketingResource.upsert({ where: { shop_kind_key: { shop: shop(), kind: b.kind, key } }, create: { shop: shop(), kind: b.kind, key, name: String(b.name).slice(0, 200), data, enabled: !!b.enabled }, update: { name: String(b.name).slice(0, 200), data, enabled: !!b.enabled } });
      await atomic(tx => record(tx, { key: `staff:${crypto.randomUUID()}`, type: "CONFIG_CHANGED", payload: { kind: b.kind, key, enabled: !!b.enabled } }));
      return Response.json(result);
    }
    throw new Error("Unknown action.");
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Request failed" }, { status: 400 }); }
}
