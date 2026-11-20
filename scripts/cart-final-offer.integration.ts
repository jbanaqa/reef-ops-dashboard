import test from "node:test";
import assert from "node:assert/strict";
import { isolated, enrollCartFixture, type Context } from "./cart-launch.integration";
import { threeStepCartDraft, CART_FINAL_OFFER_DISABLED } from "../lib/marketing/cart-config";
import { validateFlow, flowSequence } from "../lib/marketing/flow-config";
import { defaultContent } from "../lib/marketing/rules";

const hour = 3600000;
export function registerCartFinalOfferTests(context: () => Context) {
  test("cart final removal: new entries retain saved artwork but schedule only the reminder and 10% offer", async () => isolated(context(), "final-new", async h => {
    const { advanceCart } = await import("../lib/marketing/cart");
    const draft = threeStepCartDraft(h.f);
    draft.cart!.finalOfferEnabled = false;
    draft.steps[0].minutes = 180;
    draft.steps[2].minutes = 71 * 60;
    draft.steps[2].content.bodyHtml = "<p>Retained historical 15% artwork</p>";
    const config = validateFlow("abandoned-cart", draft), at = new Date(Date.now() - hour);
    assert.equal(config.steps.length, 3);
    assert.equal(config.steps[2].content.bodyHtml, draft.steps[2].content.bodyHtml);
    assert.deepEqual(flowSequence("abandoned-cart", config).map(step => step.target), [{ kind: "step", index: 0 }, { kind: "step", index: 1 }]);
    assert.throws(() => validateFlow("abandoned-cart", { ...draft, steps: draft.steps.map((step, index) =>
      index === 2 ? { ...step, minutes: 720 } : step), cart: { ...draft.cart, finalOfferEnabled: "false" } }), /products/);
    await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { data: h.store.json(config) } });
    const p = await h.make("two-step-new@example.com");
    await h.store.atomic(tx => enrollCartFixture(tx, p.id, "two", at, config, "https://store.example/checkouts/two", [{ product_id: 1 }]));
    const messages = await h.prisma.marketingMessage.findMany({ where: { shop: h.shop, profileId: p.id }, orderBy: { dueAt: "asc" } });
    assert.deepEqual(messages.map(message => message.flowCondition), ["cart-v2:first", "cart-v2:discount10"]);
    assert.equal(+messages[0].dueAt, +at + 3 * hour);
    const firstSentAt = new Date();
    await h.prisma.marketingMessage.update({ where: { id: messages[0].id }, data: { status: "SENT", sentAt: firstSentAt } });
    await h.store.atomic(tx => advanceCart(tx, messages[0]));
    assert.equal(+(await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: messages[1].id } })).dueAt, +firstSentAt + 4 * hour);
    assert.equal(config.cart!.couponHours, 168);
    assert.equal(h.emails.length, 0);
  }));

  test("cart final removal: normal flow save atomically cancels only pending 15% emails and stale clients cannot restore them", async () => isolated(context(), "final-save", async h => {
    const previousAuth = process.env.DASHBOARD_AUTH_DISABLED;
    process.env.DASHBOARD_AUTH_DISABLED = "true";
    try {
      const api = await import("../app/api/marketing/route");
      const config = validateFlow("abandoned-cart", threeStepCartDraft(h.f));
      await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { data: h.store.json(config) } });
      const p = await h.make("final-save@example.com"), cancelled: string[] = [], retained: string[] = [];
      const make = async (key: string, status: string, extra: object = {}) => h.prisma.marketingMessage.create({ data: {
        shop: h.shop, profileId: p.id, key: `${h.shop}:${key}`, flowKey: "abandoned-cart", channel: "EMAIL",
        flowCondition: "cart-v2:discount15", flowStep: 2, subject: "Historical final", content: defaultContent,
        status, dueAt: new Date(Date.now() + hour), ...extra,
      } });
      for (const kind of ["ordinary", "attempted", "ready", "restricted"]) {
        const message = await make(kind, "PENDING", kind === "attempted" ? { attempts: 2, attemptedAt: new Date() } : {});
        cancelled.push(message.id);
        if (kind === "ready") await h.prisma.marketingResource.create({ data: { shop: h.shop, kind: "CART_READY", key: message.id,
          name: "Prepared final", data: defaultContent } });
      }
      for (const status of ["SENDING", "UNKNOWN", "SENT", "FAILED", "CANCELLED"])
        retained.push((await make(status, status, status === "SENT" ? { sentAt: new Date(), providerId: "old-provider" } : {})).id);
      for (const [name, extra] of Object.entries({ first: { flowCondition: "cart-v2:first", flowStep: 0 },
        second: { flowCondition: "cart-v2:discount10", flowStep: 1 }, legacy: { flowCondition: "cart-v1:final-no" },
        welcome: { flowKey: "welcome", flowCondition: "welcome-v1:2" }, sms: { channel: "SMS_MARKETING" } }))
        retained.push((await make(name, "PENDING", extra)).id);
      retained.push((await make("other-store", "PENDING", { shop: "other-final-store.myshopify.com" })).id);
      const before = await h.prisma.marketingMessage.findMany({ where: { id: { in: retained } }, orderBy: { id: "asc" } });
      const beforeReady = await h.prisma.marketingResource.findMany({ where: { shop: h.shop, kind: "CART_READY" } });
      const disabled = { ...config, cart: { ...config.cart!, finalOfferEnabled: false } };
      const request = (data: unknown) => new Request("https://dashboard.example/api/marketing?brand=corals-anonymous", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "save-resource",
          kind: "FLOW", key: "abandoned-cart", name: "Abandoned Cart", enabled: true, data }),
      });
      assert.equal((await api.POST(request(disabled))).status, 200);
      for (const row of await h.prisma.marketingMessage.findMany({ where: { id: { in: cancelled } } })) {
        assert.equal(row.status, "CANCELLED"); assert.equal(row.error, CART_FINAL_OFFER_DISABLED);
      }
      assert.deepEqual(await h.prisma.marketingMessage.findMany({ where: { id: { in: retained } }, orderBy: { id: "asc" } }), before);
      assert.deepEqual(await h.prisma.marketingResource.findMany({ where: { shop: h.shop, kind: "CART_READY" } }), beforeReady);
      const audit = await h.prisma.marketingEvent.findFirstOrThrow({ where: { shop: h.shop, type: "CONFIG_CHANGED" }, orderBy: { occurredAt: "desc" } });
      assert.equal((audit.payload as { cancelledCartFinalOffers?: number }).cancelledCartFinalOffers, 4);
      assert.equal((await api.POST(request(config))).status, 200, "a client that omits the new flag can still save its copy");
      let saved = await h.prisma.marketingResource.findUniqueOrThrow({ where: { id: h.flowId } });
      assert.equal((saved.data as unknown as typeof config).cart!.finalOfferEnabled, false);
      assert.equal(saved.enabled, true);
      assert.deepEqual((saved.data as unknown as typeof config).steps, h.store.json(config.steps));
      assert.equal((await api.POST(request({ ...config, cart: { ...config.cart!, finalOfferEnabled: true } }))).status, 200);
      saved = await h.prisma.marketingResource.findUniqueOrThrow({ where: { id: h.flowId } });
      assert.equal((saved.data as unknown as typeof config).cart!.finalOfferEnabled, true, "only an explicit new control can restore the offer for future entries");
      assert.equal(await h.prisma.marketingMessage.count({ where: { id: { in: cancelled }, status: "PENDING" } }), 0,
        "re-enabling cannot resurrect cancelled historical queue rows");
      assert.equal(h.emails.length, 0);
    } finally {
      if (previousAuth === undefined) delete process.env.DASHBOARD_AUTH_DISABLED;
      else process.env.DASHBOARD_AUTH_DISABLED = previousAuth;
    }
  }));

  test("cart final removal: existing prepared retries and out-of-order deadlines cannot send or cancel the first two emails", async () => isolated(context(), "final-worker", async h => {
    const { loadCart, advanceCart } = await import("../lib/marketing/cart");
    const config = validateFlow("abandoned-cart", threeStepCartDraft(h.f)), p = await h.make("final-worker@example.com");
    await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { data: h.store.json(config) } });
    await h.store.atomic(tx => enrollCartFixture(tx, p.id, "existing", new Date(), config,
      "https://store.example/checkouts/existing", [{ product_id: 1 }]));
    const first = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, flowCondition: "cart-v2:first" } });
    const second = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, flowCondition: "cart-v2:discount10" } });
    const final = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, flowCondition: "cart-v2:discount15" } });
    await h.prisma.marketingMessage.update({ where: { id: final.id }, data: { attempts: 2, attemptedAt: new Date(), dueAt: new Date(Date.now() - hour) } });
    await h.prisma.marketingResource.create({ data: { shop: h.shop, kind: "CART_READY", key: final.id, name: "Prepared final", data: defaultContent } });
    await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { data: h.store.json({ ...config, cart: { ...config.cart!, finalOfferEnabled: false } }) } });
    assert.equal((await loadCart(final.key)).config.cart!.finalOfferEnabled, false, "live removal overrides the captured enabled configuration");
    await h.worker.runMarketing(final.id);
    const stopped = await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: final.id } });
    assert.equal(stopped.status, "CANCELLED"); assert.equal(stopped.error, CART_FINAL_OFFER_DISABLED); assert.equal(stopped.attempts, 2);
    assert.deepEqual(await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: first.id } }), first);
    assert.deepEqual(await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: second.id } }), second);
    await h.prisma.marketingMessage.update({ where: { id: second.id }, data: { status: "SENT", sentAt: new Date() } });
    await h.store.atomic(tx => advanceCart(tx, second));
    assert.equal(await h.prisma.marketingResource.count({ where: { shop: h.shop, kind: "CART_WAIT", key: final.id } }), 0);
    assert.equal(h.emails.length, 0);
  }));

  test("cart final removal: final handoff blocks an already-sending third email without touching other pending steps", async () => isolated(context(), "final-handoff", async h => {
    const { loadCart } = await import("../lib/marketing/cart"), { authorizeDelivery } = await import("../lib/marketing/send-guard");
    const config = validateFlow("abandoned-cart", threeStepCartDraft(h.f)), p = await h.make("final-handoff@example.com");
    await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { data: h.store.json(config) } });
    await h.store.atomic(tx => enrollCartFixture(tx, p.id, "handoff", new Date(), config,
      "https://store.example/checkouts/handoff", [{ product_id: 1 }]));
    const final = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, flowCondition: "cart-v2:discount15" } });
    const before = await h.prisma.marketingMessage.findMany({ where: { profileId: p.id, id: { not: final.id } }, orderBy: { id: "asc" } });
    const cartRun = await loadCart(final.key), attemptedAt = new Date();
    await h.prisma.marketingMessage.update({ where: { id: final.id }, data: { status: "SENDING", attemptedAt } });
    await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { data: h.store.json({ ...config, cart: { ...config.cart!, finalOfferEnabled: false } }) } });
    assert.equal(await authorizeDelivery({ id: final.id, attemptedAt, recipient: p.email!, cartRun }), false);
    const stopped = await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: final.id } });
    assert.equal(stopped.status, "CANCELLED"); assert.equal(stopped.error, CART_FINAL_OFFER_DISABLED);
    assert.deepEqual(await h.prisma.marketingMessage.findMany({ where: { profileId: p.id, id: { not: final.id } }, orderBy: { id: "asc" } }), before);
    assert.equal(h.emails.length, 0);
  }));
}
