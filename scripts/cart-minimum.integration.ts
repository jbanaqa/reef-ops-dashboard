import test from "node:test";
import assert from "node:assert/strict";
import { isolated, type Context } from "./cart-launch.integration";

const amount = (subtotalCents = 15000) => ({ currency: "USD" as const, subtotalCents, merchandiseLines: 1 });

export function registerCartMinimumTests(context: () => Context) {
  test("cart minimum: exact $100 boundary enrolls; unknown value and service-only carts do not", async () => isolated(context(), "minimum-boundary", async h => {
    const { enrollCart } = await import("../lib/marketing/cart");
    const start = new Date(Date.now() - 60000);
    for (const [label, facts, expected] of [
      ["below", amount(9999), 0], ["boundary", amount(10000), 2],
      ["missing", undefined, 0], ["service", { blocked: "Checkout has no merchandise" }, 0],
    ] as const) {
      const p = await h.make(`minimum-${label}@example.com`);
      await h.store.atomic(tx => enrollCart(tx, p.id, label, start, h.f,
        "https://store.example/checkouts/" + label, [{ product_id: 1 }], start, facts));
      assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id } }), expected, label);
    }
    assert.equal(h.emails.length, 0);
  }));

  test("cart minimum: a newer ineligible checkout replaces older reminders and later qualifies in a fresh attempt", async () => isolated(context(), "minimum-lifecycle", async h => {
    const { enrollCart, cartRunKey } = await import("../lib/marketing/cart");
    const p = await h.make("minimum-lifecycle@example.com"), start = new Date(Date.now() - 60000);
    const enter = (token: string, observedAt: Date, subtotal: number) => h.store.atomic(tx => enrollCart(tx,
      p.id, token, start, h.f, "https://store.example/checkouts/" + token,
      [{ product_id: 1 }], observedAt, amount(subtotal)));
    await enter("old-valid", start, 15000);
    const original = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, flowCondition: "cart-v1:first" } });
    await enter("new-low", new Date(+start + 1000), 2500);
    assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id, status: "PENDING" } }), 0);
    await enter("old-valid", new Date(+start + 500), 20000);
    assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id, status: "PENDING" } }), 0,
      "a delayed high-value webhook cannot restore an older checkout");
    await enter("new-low", new Date(+start + 2000), 10000);
    const fresh = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, status: "PENDING", flowCondition: "cart-v1:first" } });
    assert.notEqual(cartRunKey(fresh.key), cartRunKey(original.key));
    await enter("new-low", new Date(+start + 1000), 100);
    assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id, status: "PENDING" } }), 2,
      "an older low-value update cannot cancel the newer eligible attempt");
    await h.worker.runMarketing(fresh.id);
    assert.equal(h.emails.length, 1);
    assert.equal((await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: original.id } })).status, "CANCELLED");
    assert.match(JSON.stringify(h.emails[0]), /new-low/);
  }));

  test("cart minimum: falling below the threshold stops an existing attempt; refilling creates a fresh one", async () => isolated(context(), "minimum-refill", async h => {
    const { enrollCart, cartRunKey } = await import("../lib/marketing/cart");
    const p = await h.make("minimum-refill@example.com"), start = new Date(Date.now() - 60000);
    const enter = (at: Date, subtotal: number) => h.store.atomic(tx => enrollCart(tx, p.id, "same-minimum", start,
      h.f, "https://store.example/checkouts/same-minimum", [{ product_id: 1 }], at, amount(subtotal)));
    await enter(start, 15000);
    const first = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, flowCondition: "cart-v1:first" } });
    await enter(new Date(+start + 1000), 5000);
    assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id, status: "PENDING" } }), 0);
    await enter(new Date(+start + 2000), 15000);
    const next = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, status: "PENDING", flowCondition: "cart-v1:first" } });
    assert.notEqual(cartRunKey(first.key), cartRunKey(next.key));
    assert.equal((await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: first.id } })).status, "CANCELLED");
  }));

  test("cart minimum: completing a blocked checkout remains terminal after later high-value updates", async () => isolated(context(), "minimum-completed", async h => {
    const { enrollCart, completeCart } = await import("../lib/marketing/cart");
    const p = await h.make("minimum-completed@example.com"), start = new Date(Date.now() - 60000);
    await h.store.atomic(tx => enrollCart(tx, p.id, "completed-minimum", start, h.f,
      "https://store.example/checkouts/completed-minimum", [{ product_id: 1 }], start, amount(100)));
    await h.store.atomic(tx => completeCart(tx, p.id, "completed-minimum", new Date(+start + 1000)));
    await h.store.atomic(tx => enrollCart(tx, p.id, "completed-minimum", start, h.f,
      "https://store.example/checkouts/completed-minimum", [{ product_id: 1 }], new Date(+start + 2000), amount(20000)));
    assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id } }), 0);
    assert.equal(h.emails.length, 0);
  }));

  test("cart minimum: real checkout ingestion excludes services and shipping and uses discounted merchandise", async () => isolated(context(), "minimum-ingest", async h => {
    const line = (price: string, title = "Coral", quantity = 1) => ({
      product_id: 1, title, quantity, price, discount_allocations: [] as { amount: string }[],
    });
    const start = new Date(Date.now() - 60000).toISOString();
    const cases = [
      { label: "shipping-cannot-qualify", subtotal: "99.99", lines: [line("99.99")], expected: 0 },
      { label: "box-cannot-qualify", subtotal: "119.99", lines: [line("99.99"), line("20.00", "Shipping Box")], expected: 0 },
      { label: "protection-only", subtotal: "500.00", lines: [line("500.00", "Shipping Protection")], expected: 0 },
      { label: "discounted-below", subtotal: "99.00", lines: [{ ...line("150.00"), discount_allocations: [{ amount: "51.00" }] }], expected: 0 },
      { label: "exact-mixed", subtotal: "120.00", lines: [line("100.00"), line("20.00", "Shipping Protection")], expected: 2 },
      { label: "quantity", subtotal: "100.00", lines: [line("50.00", "Coral", 2)], expected: 2 },
      { label: "invalid-price", subtotal: "150.00", lines: [line("not-money")], expected: 0 },
      { label: "unknown-currency", subtotal: "150.00", lines: [line("150.00")], currency: "CAD", expected: 0 },
    ];
    for (const example of cases) {
      const p = await h.make(`${example.label}@example.com`);
      const payload = {
        token: example.label, email: p.email!, created_at: start, updated_at: start,
        currency: example.currency ?? "USD", subtotal_price: example.subtotal, total_price: "999.00",
        abandoned_checkout_url: "https://store.example/checkouts/" + example.label, line_items: example.lines,
      };
      await h.ingest.ingestShopify("checkouts/create", "minimum-ingest-" + example.label, payload);
      assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id } }), example.expected, example.label);
      if (example.expected) {
        const first = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, flowCondition: "cart-v1:first" } });
        await h.worker.runMarketing(first.id);
        assert.equal((await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: first.id } })).status, "SENT", example.label);
      }
    }
    assert.equal(h.emails.length, 2);
  }));

  test("cart minimum: a raised saved threshold protects queued reminders and final provider authorization", async () => isolated(context(), "minimum-live", async h => {
    const { enrollCart, loadCart } = await import("../lib/marketing/cart");
    const { authorizeDelivery } = await import("../lib/marketing/send-guard");
    const p = await h.make("minimum-live@example.com"), start = new Date(Date.now() - 60000);
    await h.store.atomic(tx => enrollCart(tx, p.id, "minimum-live", start, h.f,
      "https://store.example/checkouts/minimum-live", [{ product_id: 1 }], start, amount()));
    const first = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, flowCondition: "cart-v1:first" } });
    const cartRun = await loadCart(first.key);
    const attemptedAt = new Date();
    await h.prisma.marketingMessage.update({ where: { id: first.id }, data: { status: "SENDING", attemptedAt } });
    h.f.cart!.minimumSubtotal = 200;
    await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { data: h.store.json(h.f) } });
    assert.equal(await authorizeDelivery({ id: first.id, attemptedAt, recipient: p.email!, cartRun }), false);
    assert.equal((await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: first.id } })).status, "CANCELLED");
    assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id, status: "PENDING" } }), 0);
    assert.equal(h.emails.length, 0);
  }));

  test("cart minimum: legacy queued reminders without price evidence stop before sending", async () => isolated(context(), "minimum-legacy", async h => {
    const { enrollCart, cartRunKey } = await import("../lib/marketing/cart");
    const p = await h.make("minimum-legacy@example.com"), start = new Date(Date.now() - 60000);
    await h.store.atomic(tx => enrollCart(tx, p.id, "minimum-legacy", start, h.f,
      "https://store.example/checkouts/minimum-legacy", [{ product_id: 1 }], start, amount()));
    const first = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, flowCondition: "cart-v1:first" } });
    const run = await h.prisma.marketingResource.findUniqueOrThrow({ where: {
      shop_kind_key: { shop: h.shop, kind: "CART_RUN", key: cartRunKey(first.key) },
    } });
    const legacy = { ...run.data as Record<string, unknown> };
    delete legacy.merchandise;
    await h.prisma.marketingResource.update({ where: { id: run.id }, data: { data: h.store.json(legacy) } });
    await h.worker.runMarketing(first.id);
    assert.equal(h.emails.length, 0);
    assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id, status: "PENDING" } }), 0);
    assert.equal((await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: first.id } })).status, "CANCELLED");
  }));
}
