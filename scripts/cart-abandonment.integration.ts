import test from "node:test";
import assert from "node:assert/strict";
import { isolated, enrollCartFixture, cartAbandonmentFixture, type Context } from "./cart-launch.integration";
import { DAY, defaultContent } from "../lib/marketing/rules";

const merchandise = { currency: "USD" as const, subtotalCents: 15000, merchandiseLines: 1 };
const payload = (email: string, token: string, createdAt: Date, observedAt = createdAt) => ({
  token, email, created_at: createdAt.toISOString(), updated_at: observedAt.toISOString(),
  abandoned_checkout_url: "https://store.example/checkouts/" + token,
  currency: "USD", subtotal_price: "150.00",
  line_items: [{ product_id: 1, variant_id: 11, title: "Coral", price: "150.00", quantity: 1, discount_allocations: [] }],
});
function nativeCheckout(email: string, token: string, createdAt: Date) {
  return { id: "gid://shopify/AbandonedCheckout/101", createdAt: createdAt.toISOString(), completedAt: null as string | null,
    recoveredAt: null as string | null, abandonedCheckoutUrl: "https://store.example/checkouts/" + token,
    customer: { id: "gid://shopify/Customer/1", defaultEmailAddress: { emailAddress: email } } };
}
function nativeAbandonment(checkout: ReturnType<typeof nativeCheckout>, abandonedAt: Date) {
  return { id: "gid://shopify/Abandonment/201", createdAt: abandonedAt.toISOString(), abandonmentType: "CHECKOUT",
    customerHasNoOrderSinceAbandonment: true, abandonedCheckoutPayload: checkout };
}
async function cutover(h: Parameters<Parameters<typeof isolated>[2]>[0], at = new Date(Date.now() - DAY)) {
  await h.prisma.marketingResource.create({ data: { shop: h.shop, kind: "SYSTEM", key: "cart-abandonment:v1",
    name: "Native abandonment cutover", data: { cutoverAt: at.toISOString() } } });
}
function mockNative(checkout: ReturnType<typeof nativeCheckout> | null, abandonment: ReturnType<typeof nativeAbandonment> | null) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const query = String(init?.body);
    if (query.includes("CartAbandonmentCandidates")) return Response.json({ data: { abandonedCheckouts: {
      nodes: checkout ? [checkout] : [], pageInfo: { hasNextPage: false, endCursor: null },
    } } });
    if (query.includes("CartAbandonmentConfirmation") || query.includes("CartAbandonmentCheck"))
      return Response.json({ data: { abandonmentByAbandonedCheckoutId: abandonment } });
    return previous(input, init);
  };
}

export function registerCartAbandonmentTests(context: () => Context) {
  test("cart abandonment: generic create/update notifications stage candidates without entering recovery", async () => isolated(context(), "native-stage", async h => {
    const p = await h.make("native-stage@example.com"), created = new Date(Date.now() - 4 * DAY);
    await h.ingest.ingestShopify("checkouts/create", "native-stage-create", payload(p.email!, "old-token", created));
    await h.ingest.ingestShopify("checkouts/update", "native-stage-update", payload(p.email!, "old-token", created, new Date()));
    assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id } }), 0);
    assert.equal(await h.prisma.marketingResource.count({ where: { shop: h.shop, kind: "CART_ACTIVE" } }), 0);
    const candidate = await h.prisma.marketingResource.findFirstOrThrow({ where: { shop: h.shop, kind: "CART_CANDIDATE" } });
    assert.equal(candidate.enabled, true);
    assert.ok(JSON.stringify(candidate.data).length < 1500, "candidate stores compact checkout facts only");
    assert.equal(h.emails.length, 0);
  }));

  test("cart abandonment: native confirmation sets the clock; later metadata cannot reset or duplicate it", async () => isolated(context(), "native-confirm", async h => {
    const { syncCartAbandonments } = await import("../lib/marketing/cart-abandonment");
    await cutover(h);
    h.f.steps[0].minutes = 180;
    await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { data: h.store.json(h.f) } });
    const p = await h.make("native-confirm@example.com"), created = new Date(Date.now() - 4 * DAY), abandonedAt = new Date(Date.now() - 30 * 60000);
    const checkout = nativeCheckout(p.email!, "native-confirm", created);
    mockNative(checkout, nativeAbandonment(checkout, abandonedAt));
    await h.ingest.ingestShopify("checkouts/update", "native-confirm-first", payload(p.email!, "native-confirm", created, new Date()));
    assert.equal((await syncCartAbandonments()).admitted, 1);
    const first = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, flowCondition: "cart-v1:first" } });
    assert.equal(+first.triggerAt!, +created, "purchase checks keep the original checkout boundary");
    assert.equal(+first.dueAt, +abandonedAt + 180 * 60000);
    await h.ingest.ingestShopify("checkouts/update", "native-confirm-metadata", payload(p.email!, "native-confirm", created, new Date(Date.now() + 1000)));
    await syncCartAbandonments();
    const latest = await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: first.id } });
    assert.equal(+latest.triggerAt!, +created); assert.equal(+latest.dueAt, +first.dueAt);
    assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id } }), 2);
    assert.equal(h.emails.length, 0);
  }));

  test("cart abandonment: an old native abandonment stays excluded after a new Shopify update", async () => isolated(context(), "native-old", async h => {
    const { syncCartAbandonments } = await import("../lib/marketing/cart-abandonment");
    await cutover(h, new Date(Date.now() - 3600000));
    const p = await h.make("native-old@example.com"), created = new Date(Date.now() - 2 * DAY);
    const checkout = nativeCheckout(p.email!, "native-old", created);
    mockNative(checkout, nativeAbandonment(checkout, new Date(Date.now() - DAY)));
    await h.ingest.ingestShopify("checkouts/update", "native-old-update", payload(p.email!, "native-old", created, new Date()));
    const result = await syncCartAbandonments();
    assert.equal(result.admitted, 0); assert.equal(result.ignored, 1);
    assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id } }), 0);
    const candidate = await h.prisma.marketingResource.findFirstOrThrow({ where: { shop: h.shop, kind: "CART_CANDIDATE" } });
    assert.match((candidate.data as { reason: string }).reason, /predates/);
  }));

  for (const block of ["missing-native", "wrong-email", "wrong-url", "completed", "ordered", "wrong-type"] as const) {
    test(`cart abandonment: ${block} cannot qualify a candidate`, async () => isolated(context(), "native-" + block, async h => {
      const { syncCartAbandonments } = await import("../lib/marketing/cart-abandonment");
      await cutover(h);
      const p = await h.make(`native-${block}@example.com`), created = new Date(Date.now() - 3600000);
      const checkout = nativeCheckout(p.email!, "native-block", created), native = nativeAbandonment(checkout, created);
      if (block === "wrong-email") checkout.customer.defaultEmailAddress.emailAddress = "someone-else@example.com";
      if (block === "wrong-url") checkout.abandonedCheckoutUrl = "https://store.example/checkouts/another-token";
      if (block === "completed") checkout.completedAt = new Date().toISOString();
      if (block === "ordered") native.customerHasNoOrderSinceAbandonment = false;
      if (block === "wrong-type") native.abandonmentType = "CART";
      mockNative(checkout, block === "missing-native" ? null : native);
      await h.ingest.ingestShopify("checkouts/update", "native-block-" + block, payload(p.email!, "native-block", created, new Date()));
      assert.equal((await syncCartAbandonments()).admitted, 0);
      assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id } }), 0);
      assert.equal(h.emails.length, 0);
    }));
  }

  test("cart abandonment: Shopify failures defer verification without blocking the shared inbox", async () => isolated(context(), "native-outage", async h => {
    const { syncCartAbandonments } = await import("../lib/marketing/cart-abandonment");
    await cutover(h);
    const p = await h.make("native-outage@example.com"), created = new Date(Date.now() - 60000);
    await h.ingest.ingestShopify("checkouts/create", "native-outage", payload(p.email!, "native-outage", created));
    const before = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (String(init?.body).includes("CartAbandonmentCandidates")) throw Error("Simulated Shopify outage");
      return before(input, init);
    };
    const failed = await syncCartAbandonments();
    assert.match(failed.error!, /outage/);
    assert.equal(await h.prisma.marketingWebhookInbox.count({ where: { shop: h.shop, status: { not: "DONE" } } }), 0);
    assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id } }), 0);
    globalThis.fetch = before;
    const checkout = nativeCheckout(p.email!, "native-outage", created);
    mockNative(checkout, nativeAbandonment(checkout, created));
    assert.equal((await syncCartAbandonments()).admitted, 1);
  }));

  test("cart abandonment: legacy queued updates cannot pass the new delivery guard", async () => isolated(context(), "native-legacy", async h => {
    const { cartRunKey } = await import("../lib/marketing/cart");
    const p = await h.make("native-legacy@example.com"), created = new Date(Date.now() - 60000);
    await h.store.atomic(tx => enrollCartFixture(tx, p.id, "legacy", created, h.f,
      "https://store.example/checkouts/legacy", [{ variant_id: 11 }], created, merchandise));
    const first = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, flowCondition: "cart-v1:first" } });
    const row = await h.prisma.marketingResource.findUniqueOrThrow({ where: { shop_kind_key: { shop: h.shop, kind: "CART_RUN", key: cartRunKey(first.key) } } });
    const legacy: Record<string, unknown> = { ...row.data as Record<string, unknown>, observedAt: new Date().toISOString() }; delete legacy.abandonment;
    await h.prisma.marketingResource.update({ where: { id: row.id }, data: { data: h.store.json(legacy) } });
    await h.worker.runMarketing(first.id);
    assert.equal(h.emails.length, 0);
    assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id, status: "PENDING" } }), 0);
    assert.equal((await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: first.id } })).status, "CANCELLED");
  }));

  test("cart abandonment: intervening orders retain the original checkout purchase boundary", async () => isolated(context(), "native-purchase-boundary", async h => {
    const created = new Date(Date.now() - 4 * 3600000), ordered = new Date(Date.now() - 2 * 3600000), abandonedAt = new Date(Date.now() - 3600000);
    for (const source of ["local", "shopify"] as const) {
      const p = await h.make(`boundary-${source}@example.com`);
      if (source === "local") await h.prisma.marketingProfile.update({ where: { id: p.id }, data: { lastOrderAt: ordered } });
      await h.store.atomic(tx => enrollCartFixture(tx, p.id, source, created, h.f,
        "https://store.example/checkouts/" + source, [{ variant_id: 11 }], abandonedAt, merchandise,
        cartAbandonmentFixture(abandonedAt, "1", p.id + ":" + source)));
      if (source === "local") assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id } }), 0);
      else {
        h.orders.set(p.email!, ordered.toISOString());
        const first = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, flowCondition: "cart-v1:first" } });
        assert.equal(+first.triggerAt!, +created);
        await h.worker.runMarketing(first.id);
        assert.equal((await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: first.id } })).status, "CANCELLED");
      }
    }
    assert.equal(h.emails.length, 0);
  }));

  test("cart abandonment: pre-version queued reminders cannot bypass verification through a legacy flow", async () => isolated(context(), "native-pre-version", async h => {
    const p = await h.make("native-pre-version@example.com"), config = { ...h.f };
    delete config.cart;
    await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { data: h.store.json(config) } });
    const message = await h.prisma.marketingMessage.create({ data: {
      shop: h.shop, profileId: p.id, key: "abandoned-cart:legacy-unverified", flowKey: "abandoned-cart", flowCondition: "ORDER_PLACED",
      channel: "EMAIL", subject: "Legacy reminder", content: defaultContent, triggerAt: new Date(Date.now() - 60000), dueAt: new Date(Date.now() - 1000),
    } });
    await h.worker.runMarketing(message.id);
    assert.equal(h.emails.length, 0);
    assert.equal((await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: message.id } })).status, "CANCELLED");
  }));

  test("cart abandonment: changed native purchase status blocks an already queued reminder", async () => isolated(context(), "native-handoff", async h => {
    const p = await h.make("native-handoff@example.com"), created = new Date(Date.now() - 60000);
    await h.store.atomic(tx => enrollCartFixture(tx, p.id, "native-handoff", created, h.f,
      "https://store.example/checkouts/native-handoff", [{ variant_id: 11 }]));
    const first = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, flowCondition: "cart-v1:first" } });
    const before = globalThis.fetch; let checks = 0;
    globalThis.fetch = async (input, init) => {
      const response = await before(input, init);
      if (!String(init?.body).includes("CartAbandonmentCheck")) return response;
      const data = await response.json();
      if (++checks === 2) data.data.abandonmentByAbandonedCheckoutId.customerHasNoOrderSinceAbandonment = false;
      return Response.json(data);
    };
    await h.worker.runMarketing(first.id);
    assert.equal(checks, 2, "Shopify classification is checked again after preparation");
    assert.equal(h.emails.length, 0);
    assert.equal((await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: first.id } })).status, "CANCELLED");
  }));
}
