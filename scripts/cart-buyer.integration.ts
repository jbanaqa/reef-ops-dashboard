import test from "node:test";
import assert from "node:assert/strict";
import { isolated, enrollCartFixture, type Context } from "./cart-launch.integration";
import { threeStepCartDraft } from "../lib/marketing/cart-config";
import { validateFlow } from "../lib/marketing/flow-config";

const hour = 3600000;
export function registerCartBuyerTests(context: () => Context) {
  test("cart buyers: known returning customers enroll in the first email only", async () => isolated(context(), "buyer-local", async h => {
    const p = await h.make("returning-local@example.com");
    await h.prisma.marketingProfile.update({ where: { id: p.id }, data: { lastOrderAt: new Date(Date.now() - 400 * 24 * hour) } });
    const config = validateFlow("abandoned-cart", threeStepCartDraft(h.f));
    await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { data: h.store.json(config) } });
    await h.store.atomic(tx => enrollCartFixture(tx, p.id, "returning", new Date(Date.now() - hour), config,
      "https://store.example/checkouts/returning", [{ product_id: 1 }]));
    const rows = await h.prisma.marketingMessage.findMany({ where: { shop: h.shop } });
    assert.deepEqual(rows.map(row => row.flowCondition), ["cart-v2:first"]);
    await h.worker.runMarketing(rows[0].id);
    assert.equal((await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: rows[0].id } })).status, "SENT");
    assert.equal(h.emails.length, 1);
    assert.equal(await h.prisma.marketingResource.count({ where: { shop: h.shop, kind: "CART_COUPON" } }), 0);
  }));

  for (const legacy of [false, true]) test(`cart buyers: old Shopify orders stop ${legacy ? "legacy" : "three-stage"} follow-ups without stopping the first email`, async () => isolated(context(), "buyer-remote-" + legacy, async h => {
    const p = await h.make("old-shopify-buyer@example.com");
    h.orders.set(p.email!, new Date(Date.now() - 500 * 24 * hour).toISOString());
    const draft = legacy ? h.f : threeStepCartDraft(h.f);
    draft.steps = draft.steps.map(step => ({ ...step, minutes: 0 })); draft.branchMinutes = 0;
    const config = validateFlow("abandoned-cart", draft);
    await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { data: h.store.json(config) } });
    await h.store.atomic(tx => enrollCartFixture(tx, p.id, "older-order", new Date(Date.now() - hour), config,
      "https://store.example/checkouts/older-order", [{ product_id: 1 }]));
    const first = await h.prisma.marketingMessage.findFirstOrThrow({ where: { shop: h.shop, flowCondition: legacy ? "cart-v1:first" : "cart-v2:first" } });
    await h.worker.runMarketing(first.id);
    const later = await h.prisma.marketingMessage.findFirstOrThrow({ where: { shop: h.shop, id: { not: first.id } }, orderBy: { dueAt: "asc" } });
    await h.worker.runMarketing(later.id);
    const rows = await h.prisma.marketingMessage.findMany({ where: { shop: h.shop } });
    assert.equal(rows.find(row => row.id === first.id)!.status, "SENT");
    assert.ok(rows.filter(row => row.id !== first.id).every(row => row.status === "CANCELLED"));
    assert.match(rows.find(row => row.id === later.id)!.error!, /no previous orders/);
    assert.equal(h.emails.length, 1);
    assert.equal(await h.prisma.marketingResource.count({ where: { shop: h.shop, kind: "CART_COUPON" } }), 0);
  }));

  test("cart buyers: incomplete history holds an offer without allocating a code or consuming delivery attempts", async () => isolated(context(), "buyer-unknown", async h => {
    const p = await h.make("history-unavailable@example.com"), draft = threeStepCartDraft(h.f);
    draft.steps = draft.steps.map(step => ({ ...step, minutes: 0 }));
    const config = validateFlow("abandoned-cart", draft);
    await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { data: h.store.json(config) } });
    await h.store.atomic(tx => enrollCartFixture(tx, p.id, "unknown", new Date(Date.now() - hour), config,
      "https://store.example/checkouts/unknown", [{ product_id: 1 }]));
    const first = await h.prisma.marketingMessage.findFirstOrThrow({ where: { shop: h.shop, flowCondition: "cart-v2:first" } });
    await h.worker.runMarketing(first.id);
    const fallback = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (String(input).includes("/graphql.json") && JSON.parse(String(init?.body)).query.includes("CartBuyerHistory"))
        return Response.json({ data: { nodes: [], customers: { nodes: [], pageInfo: { hasNextPage: false } } } });
      return fallback(input, init);
    };
    const offer = await h.prisma.marketingMessage.findFirstOrThrow({ where: { shop: h.shop, flowCondition: "cart-v2:discount10" } });
    await h.worker.runMarketing(offer.id);
    const saved = await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: offer.id } });
    assert.equal(saved.status, "PENDING"); assert.equal(saved.attempts, 0);
    assert.match(saved.error!, /history.*verification|identity.*verification/);
    assert.ok(saved.dueAt > new Date()); assert.equal(h.emails.length, 1);
    assert.equal(await h.prisma.marketingResource.count({ where: { shop: h.shop, kind: "CART_COUPON" } }), 0);
  }));

  test("cart buyers: only complete identity-matched lifetime zeros authorize offers", async () => isolated(context(), "buyer-proof", async h => {
    const { cartBuyerHistory, cartBuyerProofValid } = await import("../lib/marketing/cart-buyer");
    const p = await h.make("lifetime-zero@example.com");
    await h.prisma.marketingProfile.update({ where: { id: p.id }, data: { shopifyId: "99" } });
    const profile = await h.prisma.marketingProfile.findUniqueOrThrow({ where: { id: p.id } });
    const customer = { id: "gid://shopify/Customer/99", defaultEmailAddress: { emailAddress: p.email }, numberOfOrders: "0" };
    let data: unknown = { nodes: [customer], customers: { nodes: [customer], pageInfo: { hasNextPage: false } } };
    const fallback = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (String(input).includes("/graphql.json") && JSON.parse(String(init?.body)).query.includes("CartBuyerHistory")) return Response.json({ data });
      return fallback(input, init);
    };
    const check = await cartBuyerHistory(p.id);
    assert.equal(check.hasOrders, false); assert.equal(cartBuyerProofValid(check, profile), true);
    assert.equal(cartBuyerProofValid(check, { ...profile, email: "other@example.com" }), false);
    assert.equal(cartBuyerProofValid(check, { ...profile, shopifyId: "100" }), false);
    assert.equal(cartBuyerProofValid(check, profile, check.checkedAt + 120001), false);
    assert.equal(cartBuyerProofValid({ ...check, shop: "another.myshopify.com" }, profile), false);
    for (const bad of [
      {}, { nodes: [], customers: { nodes: [], pageInfo: { hasNextPage: false } } },
      { nodes: [customer], customers: { nodes: [customer], pageInfo: { hasNextPage: true } } },
      { nodes: [{ ...customer, numberOfOrders: null }], customers: { nodes: [customer], pageInfo: { hasNextPage: false } } },
      { nodes: [{ ...customer, defaultEmailAddress: { emailAddress: "changed@example.com" } }], customers: { nodes: [], pageInfo: { hasNextPage: false } } },
    ]) { data = bad; await assert.rejects(cartBuyerHistory(p.id), /Waiting to verify/); }
    data = { nodes: [{ ...customer, numberOfOrders: "18446744073709551615" }], customers: { nodes: [], pageInfo: { hasNextPage: false } } };
    assert.equal((await cartBuyerHistory(p.id)).hasOrders, true, "lifetime counts cannot overflow into a false zero");
  }));

  test("cart buyers: final provider authorization catches historical orders and stale proof", async () => isolated(context(), "buyer-handoff", async h => {
    const { cartBuyerHistory, CART_RETURNING_CUSTOMER } = await import("../lib/marketing/cart-buyer");
    const { loadCart } = await import("../lib/marketing/cart"), { authorizeDelivery } = await import("../lib/marketing/send-guard");
    const p = await h.make("handoff-buyer@example.com"), draft = threeStepCartDraft(h.f);
    draft.steps = draft.steps.map(step => ({ ...step, minutes: 0 }));
    const config = validateFlow("abandoned-cart", draft);
    await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { data: h.store.json(config) } });
    await h.store.atomic(tx => enrollCartFixture(tx, p.id, "handoff", new Date(Date.now() - hour), config,
      "https://store.example/checkouts/handoff", [{ product_id: 1 }]));
    const first = await h.prisma.marketingMessage.findFirstOrThrow({ where: { shop: h.shop, flowCondition: "cart-v2:first" } });
    await h.worker.runMarketing(first.id);
    const offer = await h.prisma.marketingMessage.findFirstOrThrow({ where: { shop: h.shop, flowCondition: "cart-v2:discount10" } });
    const cartRun = await loadCart(offer.key), check = await cartBuyerHistory(p.id), attemptedAt = new Date();
    await h.prisma.marketingMessage.update({ where: { id: offer.id }, data: { status: "SENDING", attemptedAt } });
    const handoff = { id: offer.id, recipient: p.email!, attemptedAt, cartRun };
    assert.equal(await authorizeDelivery({ ...handoff, cartBuyerCheck: { ...check, checkedAt: Date.now() - 121000 } }), false);
    assert.equal((await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: offer.id } })).status, "PENDING");
    await h.prisma.marketingMessage.update({ where: { id: offer.id }, data: { status: "SENDING" } });
    await h.prisma.marketingProfile.update({ where: { id: p.id }, data: { lastOrderAt: new Date(Date.now() - 400 * 24 * hour) } });
    assert.equal(await authorizeDelivery({ ...handoff, cartBuyerCheck: check }), false);
    const saved = await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: offer.id } });
    assert.equal(saved.status, "CANCELLED"); assert.equal(saved.error, CART_RETURNING_CUSTOMER);
    assert.equal(h.emails.length, 1);
  }));
}
