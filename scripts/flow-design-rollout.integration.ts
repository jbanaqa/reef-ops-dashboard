import test from "node:test";
import assert from "node:assert/strict";
import { isolated, enrollCartFixture, type Context } from "./cart-launch.integration";
import { defaultContent, defaultMarketingSettings } from "../lib/marketing/rules";
import { threeStepCartDraft } from "../lib/marketing/cart-config";
import { runWithMarketingBrand } from "../lib/marketing/context";

type Harness = Parameters<Parameters<typeof isolated>[2]>[0];
const keys = ["welcome", "abandoned-cart", "b2b-welcome", "delivery-upsell"];
async function settings(h: Harness) {
  return h.prisma.marketingResource.upsert({ where: { shop_kind_key: { shop: h.shop, kind: "SETTINGS", key: "global" } },
    create: { shop: h.shop, kind: "SETTINGS", key: "global", name: "Settings", data: h.store.json({ ...defaultMarketingSettings,
      organizationName: "Saved organization", branding: { footerConfigured: true, logo: "https://images.example/global.png", logoScale: 1.7,
        footerText: "Saved global footer" } }) }, update: {} });
}
function withoutDesign(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutDesign);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "layout" && key !== "reefDesign").map(([key, child]) => [key, withoutDesign(child)]));
}
const post = (brand: string, body: unknown) => new Request("https://app.example/api/marketing?brand=" + brand,
  { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export function registerFlowDesignRolloutTests(context: () => Context) {
  test("flow design rollout: preview is read-only and all nine customer email paths preserve behavior and branding", async () => isolated(context(), "design-preview", async h => {
    const { previewCoralsFlowDesign, applyCoralsFlowDesign, coralsFlowDesignEvidence } = await import("../lib/marketing/flow-design-rollout");
    const savedSettings = await settings(h);
    const before = await h.prisma.marketingResource.findMany({ where: { shop: h.shop, kind: "FLOW" }, orderBy: { key: "asc" } });
    const preview = await previewCoralsFlowDesign();
    assert.equal(preview.flowCount, 4); assert.equal(preview.emailCount, 9); assert.equal(preview.samples.length, 9);
    assert.ok(preview.samples.every(sample => sample.html.includes("ca-reef-logo-v1.png")));
    assert.deepEqual(await h.prisma.marketingResource.findMany({ where: { shop: h.shop, kind: "FLOW" }, orderBy: { key: "asc" } }), before);
    assert.equal(await h.prisma.marketingResource.count({ where: { shop: h.shop, kind: "FLOW_DESIGN_ROLLOUT" } }), 0);
    const result = await applyCoralsFlowDesign(preview.fingerprint);
    assert.equal(result.done, true);
    const after = await h.prisma.marketingResource.findMany({ where: { shop: h.shop, kind: "FLOW" }, orderBy: { key: "asc" } });
    for (const row of before) {
      const updated = after.find(item => item.id === row.id)!;
      assert.equal(updated.name, row.name); assert.equal(updated.enabled, row.enabled);
      assert.deepEqual(withoutDesign(updated.data), withoutDesign(row.data));
      if (!keys.includes(row.key)) assert.deepEqual(updated, row, "staff stock alerts are excluded");
    }
    assert.deepEqual(await h.prisma.marketingResource.findUniqueOrThrow({ where: { id: savedSettings.id } }), savedSettings);
    const evidence = await coralsFlowDesignEvidence(result.operationId);
    assert.ok(evidence.rows.some(row => row.kind === "FLOW_DESIGN_AUDIT" && row.key.endsWith(":flows")));
    assert.equal(h.emails.length, 0);
  }));

  test("flow design rollout: a changed flow rejects the entire stale plan", async () => isolated(context(), "design-cas", async h => {
    const { previewCoralsFlowDesign, applyCoralsFlowDesign } = await import("../lib/marketing/flow-design-rollout");
    const preview = await previewCoralsFlowDesign();
    await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { enabled: false } });
    const changed = await h.prisma.marketingResource.findMany({ where: { shop: h.shop, kind: "FLOW" }, orderBy: { key: "asc" } });
    await assert.rejects(applyCoralsFlowDesign(preview.fingerprint), /changed after the preview/);
    assert.deepEqual(await h.prisma.marketingResource.findMany({ where: { shop: h.shop, kind: "FLOW" }, orderBy: { key: "asc" } }), changed);
    assert.equal(await h.prisma.marketingResource.count({ where: { shop: h.shop, kind: "FLOW_DESIGN_ROLLOUT" } }), 0);
  }));

  test("flow design rollout: only unattempted waiting emails change; prepared retries, history, campaigns and SMS stay intact", async () => isolated(context(), "design-messages", async h => {
    const { previewCoralsFlowDesign, applyCoralsFlowDesign } = await import("../lib/marketing/flow-design-rollout");
    await settings(h); const p = await h.make("design-scope@example.com");
    const make = (key: string, extra: Record<string, unknown> = {}) => h.prisma.marketingMessage.create({ data: {
      shop: h.shop, key, profileId: p.id, flowKey: "b2b-welcome", channel: "EMAIL", subject: "Saved subject",
      content: { ...defaultContent, body: "Saved waiting copy", url: "https://store.example/saved-destination" }, dueAt: new Date(Date.now() + 86400000), ...extra,
    } });
    const waiting = await make("design-waiting");
    const prepared = await make("design-ready", { flowKey: "welcome" });
    await h.prisma.marketingResource.create({ data: { shop: h.shop, kind: "WELCOME_READY", key: prepared.id, name: "Prepared retry", data: { content: prepared.content } } });
    const kept = [prepared, await make("design-attempted", { attempts: 1 }),
      await make("design-sent", { status: "SENT", sentAt: new Date() }), await make("design-unknown", { status: "UNKNOWN" }),
      await make("design-sms", { channel: "SMS_MARKETING" }), await make("design-stock", { flowKey: "low-stock" })];
    const campaign = await h.prisma.marketingCampaign.create({ data: { shop: h.shop, name: "Campaign", subject: "Campaign", content: defaultContent, audience: {} } });
    kept.push(await make("design-campaign", { flowKey: null, campaignId: campaign.id }));
    const preview = await previewCoralsFlowDesign(); await applyCoralsFlowDesign(preview.fingerprint);
    const updated = await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: waiting.id } });
    assert.equal((updated.content as { layout: string }).layout, "corals-reef");
    assert.deepEqual(withoutDesign(updated.content), withoutDesign(waiting.content));
    assert.deepEqual({ ...updated, content: waiting.content, updatedAt: waiting.updatedAt }, waiting);
    for (const original of kept) assert.deepEqual(await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: original.id } }), original);
    assert.equal(h.emails.length, 0);
  }));

  test("flow design rollout: legacy cart runs share a new immutable config without adding or rescheduling steps", async () => isolated(context(), "design-legacy", async h => {
    const { previewCoralsFlowDesign, applyCoralsFlowDesign } = await import("../lib/marketing/flow-design-rollout");
    const { cartRunKey, loadCart } = await import("../lib/marketing/cart");
    const { resolveCartConfig } = await import("../lib/marketing/cart-storage");
    const runRows = [], messages = [];
    for (const suffix of ["one", "two"]) {
      const p = await h.make(`design-legacy-${suffix}@example.com`);
      await h.store.atomic(tx => enrollCartFixture(tx, p.id, suffix, new Date(Date.now() - 60000), h.f,
        "https://store.example/checkouts/" + suffix, [{ product_id: 1 }]));
      const first = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, flowCondition: "cart-v1:first" } });
      runRows.push(await h.prisma.marketingResource.findUniqueOrThrow({ where: { shop_kind_key: { shop: h.shop, kind: "CART_RUN", key: cartRunKey(first.key) } } }));
      messages.push(...await h.prisma.marketingMessage.findMany({ where: { profileId: p.id } }));
    }
    const oldRef = (runRows[0].data as { configRef: string }).configRef;
    const oldConfig = await resolveCartConfig(h.prisma, h.shop, oldRef);
    await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { data: h.store.json(threeStepCartDraft(h.f)) } });
    const preview = await previewCoralsFlowDesign(); const result = await applyCoralsFlowDesign(preview.fingerprint);
    assert.equal(result.runs, 2);
    const updated = await Promise.all(runRows.map(row => h.prisma.marketingResource.findUniqueOrThrow({ where: { id: row.id } })));
    const refs = updated.map(row => (row.data as { configRef: string }).configRef);
    assert.notEqual(refs[0], oldRef); assert.equal(refs[0], refs[1]);
    assert.deepEqual(await resolveCartConfig(h.prisma, h.shop, oldRef), oldConfig, "the original immutable snapshot remains unchanged");
    const newConfig = await resolveCartConfig(h.prisma, h.shop, refs[0]);
    assert.deepEqual(withoutDesign(newConfig), withoutDesign(oldConfig));
    assert.equal(newConfig.steps[0].content.layout, "corals-reef");
    for (const original of messages) {
      const row = await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: original.id } });
      assert.equal(row.dueAt.toISOString(), original.dueAt.toISOString()); assert.equal(row.subject, original.subject);
      assert.equal((await loadCart(row.key)).sequenceVersion, undefined);
    }
    assert.equal(await h.prisma.marketingMessage.count({ where: { shop: h.shop } }), 4);
    assert.equal(h.emails.length, 0);
  }));

  test("flow design rollout: bounded batches resume after reload and completed operations are idempotent", async () => isolated(context(), "design-batches", async h => {
    const { previewCoralsFlowDesign, applyCoralsFlowDesign } = await import("../lib/marketing/flow-design-rollout");
    const p = await h.make("design-batches@example.com");
    await h.prisma.marketingMessage.createMany({ data: Array.from({ length: 105 }, (_, index) => ({ shop: h.shop,
      key: "design-batch-" + index, profileId: p.id, flowKey: "delivery-upsell", channel: "EMAIL", subject: "Saved notice", content: defaultContent, dueAt: new Date() })) });
    const preview = await previewCoralsFlowDesign(), first = await applyCoralsFlowDesign(preview.fingerprint);
    assert.equal(first.done, false); assert.equal(first.messages, 100);
    assert.equal((await previewCoralsFlowDesign()).fingerprint, preview.fingerprint, "reload resumes the existing bounded operation");
    const second = await applyCoralsFlowDesign(preview.fingerprint);
    assert.equal(second.done, true); assert.equal(second.messages, 105);
    const auditCount = await h.prisma.marketingResource.count({ where: { shop: h.shop, kind: "FLOW_DESIGN_AUDIT" } });
    assert.deepEqual(await applyCoralsFlowDesign(preview.fingerprint), second);
    assert.equal(await h.prisma.marketingResource.count({ where: { shop: h.shop, kind: "FLOW_DESIGN_AUDIT" } }), auditCount);
  }));

  test("flow design rollout routes require staff authorization and reject Macro without writes", async () => isolated(context(), "design-routes", async h => {
    const api = await import("../app/api/marketing/route");
    const previous = process.env.DASHBOARD_AUTH_DISABLED;
    process.env.DASHBOARD_AUTH_DISABLED = "true";
    try {
      const before = await h.prisma.marketingResource.count();
      assert.equal((await api.GET(new Request("https://app.example/api/marketing?brand=macroalgae-farms&view=flow-design-preview"))).status, 400);
      assert.equal((await api.POST(post("macroalgae-farms", { action: "apply-flow-design", fingerprint: "a".repeat(64) }))).status, 400);
      assert.equal(await h.prisma.marketingResource.count(), before);
      await assert.rejects(runWithMarketingBrand("macroalgae-farms", () => import("../lib/marketing/flow-design-rollout").then(module => module.previewCoralsFlowDesign())), /Corals Anonymous/);
      const response = await api.GET(new Request("https://app.example/api/marketing?view=flow-design-preview"));
      assert.equal(response.status, 200); const preview = await response.json();
      const applied = await api.POST(post("corals-anonymous", { action: "apply-flow-design", fingerprint: preview.fingerprint }));
      assert.equal(applied.status, 200);
    } finally { if (previous === undefined) delete process.env.DASHBOARD_AUTH_DISABLED; else process.env.DASHBOARD_AUTH_DISABLED = previous; }
  }));
}
