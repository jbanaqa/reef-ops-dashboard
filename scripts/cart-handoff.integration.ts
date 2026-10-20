import test from "node:test";
import assert from "node:assert/strict";
import { Resolver } from "node:dns/promises";
import { isolated, enrollCartFixture as enrollCart, cartAbandonmentFixture, type Context } from "./cart-launch.integration";
import { validateFlow } from "../lib/marketing/flow-config";
import { defaultContent } from "../lib/marketing/rules";

export function registerCartHandoffTests(context: () => Context) {
  for (const action of ["unsubscribe", "suppression", "missing-consent", "flow-pause", "global-pause", "purchase", "quiet-hours", "claim-lost", "claim-replaced"] as const) {
    test(`cart handoff: ${action} during the final stock lookup blocks provider delivery`, async () => isolated(context(), `handoff-${action}`, async h => {
      const p = await h.make(`${action}@example.com`), start = new Date(Date.now() - 60000);
      await h.store.atomic(tx => enrollCart(tx, p.id, action, start, h.f, `https://store.example/checkouts/${action}`, [{ variant_id: 11 }]));
      const first = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, flowCondition: "cart-v1:first" } });
      const fetchBefore = globalThis.fetch; let checks = 0;
      globalThis.fetch = async (input, init) => {
        if (String(init?.body).includes("CartAvailability") && ++checks === 2) {
          if (action === "unsubscribe") await h.store.atomic(tx => h.store.consent(tx, p.id, "EMAIL", "UNSUBSCRIBED", "unsubscribe", new Date()));
          if (action === "suppression") await h.store.atomic(tx => h.store.consent(tx, p.id, "EMAIL", "SUBSCRIBED", "resend", new Date(), "Hard bounce"));
          if (action === "missing-consent") await h.prisma.marketingConsent.deleteMany({ where: { profileId: p.id, channel: "EMAIL" } });
          if (action === "flow-pause") await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { enabled: false } });
          if (action === "global-pause") await h.prisma.marketingResource.upsert({
            where: { shop_kind_key: { shop: h.shop, kind: "SETTINGS", key: "global" } },
            create: { shop: h.shop, kind: "SETTINGS", key: "global", name: "Settings", data: { operations: { sendingEnabled: false } } },
            update: { data: { operations: { sendingEnabled: false } } },
          });
          if (action === "purchase") await h.ingest.ingestShopify("orders/create", "purchase-at-handoff", {
            id: 991, email: p.email!, created_at: new Date().toISOString(), total_price: "20", currency: "USD", checkout_token: "another-checkout", line_items: [],
          });
          if (action === "quiet-hours") {
            const startHour = (new Date().getUTCHours() + 2) % 24;
            h.f.cart!.sendStartHour = startHour; h.f.cart!.sendEndHour = startHour + 1;
            await h.prisma.marketingProfile.update({ where: { id: p.id }, data: { properties: { timezone: "UTC" } } });
            await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { data: h.store.json(h.f) } });
          }
          if (action === "claim-lost") await h.prisma.marketingMessage.update({ where: { id: first.id }, data: { status: "UNKNOWN", error: "Another process owns delivery review" } });
          if (action === "claim-replaced") {
            const current = await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: first.id } });
            await h.prisma.marketingMessage.update({ where: { id: first.id }, data: { attemptedAt: new Date(+current.attemptedAt! + 1) } });
          }
        }
        return fetchBefore(input, init);
      };
      await h.worker.runMarketing(first.id);
      assert.equal(h.emails.length, 0);
      const stopped = await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: first.id } });
      const terminal = ["unsubscribe", "suppression", "purchase"].includes(action);
      assert.equal(stopped.status, action === "claim-lost" ? "UNKNOWN" : action === "claim-replaced" ? "SENDING" : terminal ? "CANCELLED" : "PENDING");
      if (terminal) assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id, status: "PENDING" } }), 0);
      if (action === "unsubscribe" || action === "suppression") {
        assert.equal((await h.prisma.marketingConsent.findUniqueOrThrow({ where: { profileId_channel: { profileId: p.id, channel: "EMAIL" } } })).suppressed, true);
      }
    }));
  }

  test("cart handoff: authorization database errors are known non-sends and can safely retry", async () => isolated(context(), "handoff-outage", async h => {
    const p = await h.make("authorization-outage@example.com");
    await h.store.atomic(tx => enrollCart(tx, p.id, "outage", new Date(Date.now() - 60000), h.f, "https://store.example/checkouts/outage", [{ variant_id: 11 }]));
    const first = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, flowCondition: "cart-v1:first" } });
    const fetchBefore = globalThis.fetch, originalTransaction = h.prisma.$transaction.bind(h.prisma);
    let checks = 0, fail = false;
    globalThis.fetch = async (input, init) => {
      if (String(init?.body).includes("CartAvailability") && ++checks === 2) fail = true;
      return fetchBefore(input, init);
    };
    h.prisma.$transaction = ((...args: Parameters<typeof originalTransaction>) => {
      if (fail) { fail = false; return Promise.reject(new Error("Temporary database outage")); }
      return originalTransaction(...args);
    }) as typeof h.prisma.$transaction;
    try {
      await h.worker.runMarketing(first.id);
      const deferred = await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: first.id } });
      assert.equal(deferred.status, "PENDING"); assert.match(deferred.error!, /Final delivery checks unavailable/);
      assert.equal(h.emails.length, 0);
    } finally { h.prisma.$transaction = originalTransaction; }
    globalThis.fetch = fetchBefore;
    await h.prisma.marketingMessage.update({ where: { id: first.id }, data: { dueAt: new Date(Date.now() - 1000) } });
    await h.worker.runMarketing(first.id);
    assert.equal(h.emails.length, 1);
  }));

  for (const kind of ["cart", "campaign"] as const) test(`delivery handoff: ${kind} unsubscribe during DNS checks blocks delivery`, async () => isolated(context(), `dns-${kind}`, async h => {
    const { loadCart } = await import("../lib/marketing/cart");
    const { authorizeDelivery } = await import("../lib/marketing/send-guard");
    const { resendProvider, DeliveryStopped } = await import("../lib/marketing/delivery");
    const p = await h.make(`late-dns@${kind}-dns-check.example`);
    let message;
    if (kind === "cart") {
      await h.store.atomic(tx => enrollCart(tx, p.id, "dns", new Date(Date.now() - 60000), h.f, "https://store.example/checkouts/dns", [{ variant_id: 11 }]));
      message = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, flowCondition: "cart-v1:first" } });
    } else {
      const campaign = await h.prisma.marketingCampaign.create({ data: { shop: h.shop, name: "Boundary test", subject: "Campaign", status: "SENDING", audience: {}, content: defaultContent } });
      message = await h.prisma.marketingMessage.create({ data: { shop: h.shop, key: "dns-campaign", profileId: p.id, campaignId: campaign.id, channel: "EMAIL", subject: "Campaign", content: defaultContent, dueAt: new Date() } });
    }
    const attemptedAt = new Date();
    await h.prisma.marketingMessage.update({ where: { id: message.id }, data: { status: "SENDING", attemptedAt } });
    const resolveMx = Resolver.prototype.resolveMx;
    Resolver.prototype.resolveMx = async () => {
      await h.store.atomic(tx => h.store.consent(tx, p.id, "EMAIL", "UNSUBSCRIBED", "unsubscribe", new Date()));
      return [{ exchange: "mx.fixture.example", priority: 10 }];
    };
    try {
      const cartRun = kind === "cart" ? await loadCart(message.key) : null;
      await assert.rejects(resendProvider.send({ id: message.id, to: p.email!, channel: "EMAIL", subject: message.subject, content: defaultContent, unsubscribe: "https://app.example/unsubscribe",
        beforeSend: async () => { if (!(await authorizeDelivery({ id: message.id, attemptedAt, recipient: p.email!, cartRun }))) throw new DeliveryStopped("Stopped before provider request"); },
      }), DeliveryStopped);
      assert.equal(h.emails.length, 0);
      assert.equal((await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: message.id } })).status, "CANCELLED");
    } finally { Resolver.prototype.resolveMx = resolveMx; }
  }));

  test("cart recovery: replacing sold-out items needs a new abandonment and preserves the cancelled attempt", async () => isolated(context(), "stock-reentry", async h => {
    const { cartRunKey } = await import("../lib/marketing/cart");
    const p = await h.make("stock-reentry@example.com"), start = new Date(Date.now() - 60000);
    await h.store.atomic(tx => enrollCart(tx, p.id, "stock-reentry", start, h.f, "https://store.example/checkouts/stock-old", [{ variant_id: 11 }]));
    const old = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, flowCondition: "cart-v1:first" } });
    const fetchBefore = globalThis.fetch;
    globalThis.fetch = async (input, init) => String(init?.body).includes("CartAvailability") ? Response.json({ data: { nodes: [null] } }) : fetchBefore(input, init);
    await h.worker.runMarketing(old.id);
    globalThis.fetch = fetchBefore;
    assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id, status: "CANCELLED" } }), 2);
    const stockRun = await h.prisma.marketingResource.findUniqueOrThrow({ where: { shop_kind_key: { shop: h.shop, kind: "CART_RUN", key: cartRunKey(old.key) } } });
    assert.ok((stockRun.data as { stockStoppedAt?: string }).stockStoppedAt);
    await h.store.atomic(tx => enrollCart(tx, p.id, "stock-reentry", start, h.f, "https://store.example/checkouts/stock-new", [{ variant_id: 22 }], new Date()));
    assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id, status: "PENDING" } }), 0);
    await h.store.atomic(tx => enrollCart(tx, p.id, "stock-reentry", start, h.f,
      "https://store.example/checkouts/stock-new", [{ variant_id: 22 }], new Date(), undefined,
      cartAbandonmentFixture(new Date(Date.now() - 1000), "2")));
    const fresh = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, flowCondition: "cart-v1:first", status: "PENDING" } });
    assert.notEqual(cartRunKey(fresh.key), cartRunKey(old.key));
    await h.worker.runMarketing(fresh.id);
    assert.equal(h.emails.length, 1); assert.match(JSON.stringify(h.emails[0]), /stock-new/);
    assert.equal((await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: old.id } })).status, "CANCELLED");
  }));

  for (const optedOut of [false, true]) test(`cart recovery: legacy stock stop, omitted item data and opt-out=${optedOut}`, async () => isolated(context(), `legacy-stock-${optedOut}`, async h => {
    const { cartRunKey } = await import("../lib/marketing/cart");
    const p = await h.make(`legacy-stock-${optedOut}@example.com`), start = new Date(Date.now() - 60000);
    await h.store.atomic(tx => enrollCart(tx, p.id, "legacy-stock", start, h.f, "https://store.example/checkouts/legacy", [{ variant_id: 11 }]));
    const old = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, flowCondition: "cart-v1:first" } });
    await h.prisma.marketingMessage.updateMany({ where: { profileId: p.id }, data: { status: "CANCELLED", error: "No purchasable items remain in this checkout" } });
    if (optedOut) await h.store.atomic(tx => h.store.consent(tx, p.id, "EMAIL", "UNSUBSCRIBED", "unsubscribe", new Date()));
    await h.store.atomic(tx => enrollCart(tx, p.id, "legacy-stock", start, h.f, "https://store.example/checkouts/restocked", undefined, new Date()));
    assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id, status: "PENDING" } }), 0,
      "restocking metadata alone cannot restart a stopped abandonment");
    await h.store.atomic(tx => enrollCart(tx, p.id, "legacy-stock", start, h.f,
      "https://store.example/checkouts/restocked", undefined, new Date(), undefined,
      cartAbandonmentFixture(new Date(Date.now() - 1000), "2")));
    const fresh = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, flowCondition: "cart-v1:first", status: "PENDING" } });
    assert.notEqual(cartRunKey(old.key), cartRunKey(fresh.key));
    await h.worker.runMarketing(fresh.id);
    assert.equal(h.emails.length, optedOut ? 0 : 1);
    const consent = await h.prisma.marketingConsent.findUniqueOrThrow({ where: { profileId_channel: { profileId: p.id, channel: "EMAIL" } } });
    assert.equal(consent.suppressed, optedOut);
    assert.equal(consent.status, optedOut ? "UNSUBSCRIBED" : "SUBSCRIBED");
  }));

  test("cart timing: delays must fit inside the 72-hour inactivity lifetime", async () => isolated(context(), "timing-validation", async h => {
    assert.throws(() => validateFlow("abandoned-cart", { ...h.f, steps: h.f.steps.map(s => ({ ...s, minutes: 5760 })) }), /total waits below 72 hours/);
    assert.throws(() => validateFlow("abandoned-cart", { ...h.f, steps: h.f.steps.map(s => ({ ...s, minutes: 180 })), branchMinutes: 4110, smsMinutes: 30 }), /total waits below 72 hours/);
    const valid = validateFlow("abandoned-cart", { ...h.f, steps: h.f.steps.map(s => ({ ...s, minutes: 180 })), branchMinutes: 4109, smsMinutes: 30 });
    assert.equal(valid.branchMinutes, 4109);
  }));
}
