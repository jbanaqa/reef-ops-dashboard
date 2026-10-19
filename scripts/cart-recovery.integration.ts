import test from "node:test";
import assert from "node:assert/strict";
import { isolated, enrollCartFixture as enrollCart, type Context } from "./cart-launch.integration";
import { cartEmailNextAllowed } from "../lib/marketing/cart-schedule";
import { validateCart } from "../lib/marketing/cart-config";
import { DAY } from "../lib/marketing/rules";

export function registerCartRecoveryTests(context: () => Context) {
  test("cart recovery: latest checkout wins, including late events and replacement during preparation", async () => isolated(context(), "ownership", async h => {
    const p = await h.make("overlap@example.com"), start = new Date(Date.now() - 60000);
    const enroll = (token: string, at: Date) => h.store.atomic(tx => enrollCart(tx, p.id, token, at, h.f, "https://store.example/checkouts/" + token, [{ product_id: 1 }]));
    await enroll("older", start);
    const old = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, flowCondition: "cart-v1:first" } });
    await enroll("newer", new Date(+start + 1000));
    assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id, status: "PENDING" } }), 2);
    assert.equal((await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: old.id } })).status, "CANCELLED");
    await enroll("late", new Date(+start - 1000));
    assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id } }), 4);
    const current = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, status: "PENDING", flowCondition: "cart-v1:first" } });
    const fetchBefore = globalThis.fetch; let checks = 0;
    globalThis.fetch = async (input, init) => {
      if (String(init?.body).includes("CartAvailability") && ++checks === 2) await enroll("newest", new Date());
      return fetchBefore(input, init);
    };
    await h.worker.runMarketing(current.id);
    assert.equal(h.emails.length, 0);
    assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id, status: "PENDING" } }), 2);
    assert.equal((await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: current.id } })).status, "CANCELLED");
  }));

  test("cart recovery: empty then refill starts a fresh attempt; an older worker cannot cancel it", async () => isolated(context(), "refill", async h => {
    const { cartRunKey } = await import("../lib/marketing/cart");
    const p = await h.make("refill@example.com"), start = new Date(Date.now() - 60000);
    const enroll = (lines: { product_id: number; quantity?: number }[], at: Date) => h.store.atomic(tx => enrollCart(tx, p.id, "same", start, h.f, "https://store.example/checkouts/refill", lines, at));
    await enroll([{ product_id: 1 }], start);
    const original = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, flowCondition: "cart-v1:first" } });
    await enroll([{ product_id: 1, quantity: 0 }], new Date(+start + 1000));
    assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id, status: "PENDING" } }), 0);
    await enroll([{ product_id: 2 }], new Date(+start + 2000));
    const fresh = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, status: "PENDING", flowCondition: "cart-v1:first" } });
    assert.notEqual(cartRunKey(original.key), cartRunKey(fresh.key));
    await h.prisma.marketingMessage.update({ where: { id: original.id }, data: { status: "PENDING" } });
    await h.worker.runMarketing(original.id);
    assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id, status: "PENDING" } }), 2);
    await h.worker.runMarketing(fresh.id);
    assert.equal(h.emails.length, 1);
    assert.match(JSON.stringify(h.emails[0]), /checkouts\/refill/);
  }));

  test("cart recovery: actual sold-out variants block sends with zero recommendations; partial stock can send", async () => isolated(context(), "stock", async h => {
    const p = await h.make("soldout@example.com"), start = new Date(Date.now() - 60000);
    await h.store.atomic(tx => enrollCart(tx, p.id, "soldout", start, h.f, "https://store.example/checkouts/soldout", [{ product_id: 1, variant_id: 11 }]));
    const fetchBefore = globalThis.fetch; let available = false;
    globalThis.fetch = async (input, init) => {
      if (String(init?.body).includes("CartAvailability")) {
        const body = JSON.parse(String(init?.body));
        assert.ok(body.variables.ids.every((id: string) => id.includes("ProductVariant/")));
        return Response.json({ data: { nodes: body.variables.ids.map((_: string, i: number) => ({ availableForSale: available && i === 1,
          product: { status: "ACTIVE", onlineStoreUrl: "https://store.example/products/coral", title: "Coral" } })) } });
      }
      return fetchBefore(input, init);
    };
    await h.worker.runMarketing((await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, flowCondition: "cart-v1:first" } })).id);
    assert.equal(h.emails.length, 0);
    assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id, status: "CANCELLED", error: "No purchasable items remain in this checkout" } }), 2);
    available = true;
    const partial = await h.make("partial-stock@example.com");
    await h.store.atomic(tx => enrollCart(tx, partial.id, "partial", start, h.f, "https://store.example/checkouts/partial", [{ variant_id: 11 }, { variant_id: 12 }]));
    await h.worker.runMarketing((await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: partial.id, flowCondition: "cart-v1:first" } })).id);
    assert.equal(h.emails.length, 1);
  }));

  test("cart recovery: consent arriving late preserves first-before-final; opt-outs and failed first emails stop offers", async () => isolated(context(), "late-consent", async h => {
    const p = await h.store.atomic(tx => h.store.identify(tx, { email: "late-consent@example.com" }));
    await h.store.atomic(tx => enrollCart(tx, p.id, "late-consent", new Date(Date.now() - 60000), h.f, "https://store.example/checkouts/late", [{ product_id: 1 }]));
    const messages = await h.prisma.marketingMessage.findMany({ where: { profileId: p.id } });
    const first = messages.find(m => m.flowCondition === "cart-v1:first")!, final = messages.find(m => m.flowCondition === "cart-v1:final")!;
    await h.worker.runMarketing(first.id);
    assert.equal((await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: first.id } })).status, "PENDING");
    await h.store.atomic(tx => h.store.consent(tx, p.id, "EMAIL", "SUBSCRIBED", "test", new Date()));
    await h.prisma.marketingMessage.updateMany({ where: { profileId: p.id }, data: { dueAt: new Date(Date.now() - 1000) } });
    await h.worker.runMarketing(final.id);
    assert.equal(h.emails.length, 0);
    await h.worker.runMarketing(first.id);
    assert.equal(h.emails.length, 1);
    const sent = await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: first.id } });
    const waiting = await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: final.id } });
    assert.ok(+waiting.dueAt >= +sent.sentAt! + DAY);
    await h.prisma.marketingMessage.update({ where: { id: final.id }, data: { dueAt: new Date(Date.now() - 1000) } });
    await h.worker.runMarketing(final.id);
    assert.equal(h.emails.length, 1, "a queued date cannot bypass the entered wait");
    await h.store.atomic(tx => h.store.consent(tx, p.id, "EMAIL", "UNSUBSCRIBED", "test", new Date()));
    await h.prisma.marketingMessage.update({ where: { id: final.id }, data: { dueAt: new Date(Date.now() - 1000) } });
    await h.worker.runMarketing(final.id);
    assert.equal((await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: final.id } })).status, "CANCELLED");
    const failed = await h.make("failed-first@example.com");
    await h.store.atomic(tx => enrollCart(tx, failed.id, "failed", new Date(Date.now() - 60000), h.f, "https://store.example/checkouts/failed", [{ product_id: 1 }]));
    await h.prisma.marketingMessage.updateMany({ where: { profileId: failed.id, flowCondition: "cart-v1:first" }, data: { status: "FAILED" } });
    const offer = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: failed.id, flowCondition: "cart-v1:final" } });
    await h.prisma.marketingMessage.update({ where: { id: offer.id }, data: { dueAt: new Date(Date.now() - 1000) } });
    await h.worker.runMarketing(offer.id);
    assert.equal((await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: offer.id } })).status, "CANCELLED");
    assert.equal(h.emails.length, 1);
  }));

  test("cart recovery: newer activity restarts inactivity, never the original purchase boundary", async () => isolated(context(), "inactivity", async h => {
    h.f.steps[0].minutes = 180;
    const p = await h.make("active-checkout@example.com"), created = new Date(Date.now() - 4 * 3600000), activity = new Date(Date.now() - 60000);
    const enroll = (at: Date) => h.store.atomic(tx => enrollCart(tx, p.id, "active", created, h.f, "https://store.example/checkouts/active", [{ product_id: 1 }], at));
    await enroll(created); await enroll(activity);
    const first = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, flowCondition: "cart-v1:first" } });
    assert.equal(+first.triggerAt!, +created);
    assert.equal(+first.dueAt, +activity + 180 * 60000);
    await enroll(new Date(+activity - 1000));
    assert.equal(+(await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: first.id } })).dueAt, +first.dueAt);
    await h.prisma.marketingMessage.update({ where: { id: first.id }, data: { dueAt: new Date(Date.now() - 1000) } });
    await h.worker.runMarketing(first.id);
    assert.equal(h.emails.length, 0);
    h.orders.set(p.email!, new Date(+created + 60000).toISOString());
    await h.prisma.marketingMessage.update({ where: { id: first.id }, data: { dueAt: new Date(Date.now() - 1000) } });
    await h.worker.runMarketing(first.id);
    assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id, status: "PENDING" } }), 0);
  }));

  test("cart recovery: sending window uses recipient zones, Pacific fallback, DST and exact boundaries", () => {
    const config = validateCart({ version: 1, productCount: 0 });
    assert.equal(cartEmailNextAllowed(config, undefined, new Date("2026-10-19T03:00:00Z"))?.toISOString(), "2026-10-19T16:00:00.000Z");
    assert.equal(cartEmailNextAllowed(config, "America/New_York", new Date("2026-10-19T13:00:00Z")), null);
    assert.equal(cartEmailNextAllowed(config, "invalid", new Date("2026-10-19T03:00:00Z"))?.toISOString(), "2026-10-19T16:00:00.000Z");
    assert.equal(cartEmailNextAllowed(config, undefined, new Date("2026-11-01T03:00:00Z"))?.toISOString(), "2026-11-01T17:00:00.000Z");
    assert.equal(cartEmailNextAllowed(config, undefined, new Date("2026-03-08T04:00:00Z"))?.toISOString(), "2026-03-08T16:00:00.000Z");
    assert.equal(cartEmailNextAllowed(config, "Asia/Kathmandu", new Date("2026-10-19T03:14:00Z"))?.toISOString(), "2026-10-19T03:15:00.000Z");
    assert.equal(cartEmailNextAllowed(config, undefined, new Date("2026-10-19T02:59:59Z")), null);
    assert.throws(() => validateCart({ version: 1, productCount: 0, sendStartHour: 20, sendEndHour: 9 }), /window/);
  });

  test("cart recovery: stock errors defer, and changed checkout items cannot be cancelled by an outdated lookup", async () => isolated(context(), "stock-refresh", async h => {
    const p = await h.make("changed-stock@example.com"), created = new Date(Date.now() - 60000);
    await h.store.atomic(tx => enrollCart(tx, p.id, "refresh", created, h.f, "https://store.example/checkouts/old-link", [{ variant_id: 11 }]));
    const first = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, flowCondition: "cart-v1:first" } });
    const fetchBefore = globalThis.fetch; let checks = 0;
    globalThis.fetch = async (input, init) => {
      if (String(init?.body).includes("CartAvailability")) {
        checks++;
        if (checks === 1) throw new Error("Temporary stock API outage");
        if (checks === 2) {
          await h.store.atomic(tx => enrollCart(tx, p.id, "refresh", created, h.f, "https://store.example/checkouts/new-link", [{ variant_id: 22 }], new Date()));
          return Response.json({ data: { nodes: [null] } });
        }
        assert.deepEqual(JSON.parse(String(init?.body)).variables.ids, ["gid://shopify/ProductVariant/22"]);
      }
      return fetchBefore(input, init);
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      await h.prisma.marketingMessage.update({ where: { id: first.id }, data: { dueAt: new Date(Date.now() - 1000) } });
      await h.worker.runMarketing(first.id);
      assert.equal((await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: first.id } })).status, "PENDING");
      assert.equal(h.emails.length, 0);
    }
    await h.prisma.marketingMessage.update({ where: { id: first.id }, data: { dueAt: new Date(Date.now() - 1000) } });
    await h.worker.runMarketing(first.id);
    assert.equal(h.emails.length, 1);
    assert.match(JSON.stringify(h.emails[0]), /checkouts\/new-link/);
    assert.ok(!JSON.stringify(h.emails[0]).includes("checkouts/old-link"));
  }));

  test("cart recovery: overnight deferral is rechecked for purchases before the next send", async () => isolated(context(), "overnight", async h => {
    h.f.cart!.sendStartHour = 9; h.f.cart!.sendEndHour = 20;
    await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { data: h.store.json(h.f) } });
    const zones = ["UTC", "America/Los_Angeles", "Asia/Tokyo", "Pacific/Auckland"];
    const night = zones.find(zone => cartEmailNextAllowed(h.f.cart!, zone))!;
    const day = zones.find(zone => !cartEmailNextAllowed(h.f.cart!, zone))!;
    assert.ok(night && day);
    const p = await h.make("overnight@example.com");
    await h.prisma.marketingProfile.update({ where: { id: p.id }, data: { properties: { timezone: night } } });
    const start = new Date(Date.now() - 60000);
    await h.store.atomic(tx => enrollCart(tx, p.id, "night", start, h.f, "https://store.example/checkouts/night", [{ product_id: 1 }]));
    const first = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, flowCondition: "cart-v1:first" } });
    await h.worker.runMarketing(first.id);
    const held = await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: first.id } });
    assert.equal(held.status, "PENDING"); assert.match(held.error!, /sending hours/); assert.ok(held.dueAt > new Date());
    h.orders.set(p.email!, new Date().toISOString());
    await h.prisma.marketingProfile.update({ where: { id: p.id }, data: { properties: { timezone: day } } });
    await h.prisma.marketingMessage.update({ where: { id: first.id }, data: { dueAt: new Date(Date.now() - 1000) } });
    await h.worker.runMarketing(first.id);
    assert.equal(h.emails.length, 0);
    assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id, status: "PENDING" } }), 0);
  }));
}
