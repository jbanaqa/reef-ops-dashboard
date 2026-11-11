import test from "node:test";
import assert from "node:assert/strict";
import { isolated, type Context } from "./cart-launch.integration";

type Harness = Parameters<Parameters<typeof isolated>[2]>[0];
type Seed = Awaited<ReturnType<typeof candidate>>;
const minute = 60000, lifetime = 72 * 60 * minute;

async function setup(h: Harness) {
  await h.prisma.marketingResource.create({ data: { shop: h.shop, kind: "SYSTEM", key: "cart-abandonment:v1",
    name: "Native abandonment cutover", data: { cutoverAt: new Date(Date.now() - 86400000).toISOString() } } });
}
async function candidate(h: Harness, token: string, olderBy = 0) {
  const { stageCartAbandonment } = await import("../lib/marketing/cart-abandonment");
  const profile = await h.make(token + "@example.com"), createdAt = new Date(Date.now() - 60 * minute);
  const input = { profileId: profile.id, checkout: token, createdAt, observedAt: new Date(),
    url: "https://store.example/checkouts/" + token, lines: [{ product_id: 1, variant_id: 11, quantity: 1 }],
    merchandise: { currency: "USD" as const, subtotalCents: 15000, merchandiseLines: 1 } };
  await h.store.atomic(tx => stageCartAbandonment(tx, input));
  const row = await h.prisma.marketingResource.findFirstOrThrow({ where: { shop: h.shop, kind: "CART_CANDIDATE", data: { path: ["profileId"], equals: profile.id } } });
  if (olderBy) await h.prisma.marketingResource.update({ where: { id: row.id }, data: { updatedAt: new Date(Date.now() - olderBy) } });
  return { profile, input, id: row.id };
}
function native(seed: Seed, index: number) {
  const checkout = { id: "gid://shopify/AbandonedCheckout/" + (index + 100), completedAt: null,
    createdAt: seed.input.createdAt.toISOString(), abandonedCheckoutUrl: seed.input.url,
    customer: { id: "gid://shopify/Customer/1", defaultEmailAddress: { emailAddress: seed.profile.email } } };
  return { checkout, abandonment: { id: "gid://shopify/Abandonment/" + (index + 200),
    createdAt: seed.input.createdAt.toISOString(), abandonmentType: "CHECKOUT", customerHasNoOrderSinceAbandonment: true,
    abandonedCheckoutPayload: checkout } };
}
function mockLookups(seeds: Seed[], before?: (seed: Seed) => Promise<void>) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const body = String(init?.body);
    if (body.includes("CartAbandonmentCandidates")) {
      const request = JSON.parse(body);
      const index = seeds.findIndex(seed => request.variables.query.includes(seed.profile.email));
      assert.ok(index >= 0);
      await before?.(seeds[index]);
      return Response.json({ data: { abandonedCheckouts: { nodes: [native(seeds[index], index).checkout], pageInfo: { hasNextPage: false, endCursor: null } } } });
    }
    if (body.includes("CartAbandonmentConfirmation")) {
      const request = JSON.parse(body), index = seeds.findIndex((seed, position) => native(seed, position).checkout.id === request.variables.id);
      assert.ok(index >= 0);
      return Response.json({ data: { abandonmentByAbandonedCheckoutId: native(seeds[index], index).abandonment } });
    }
    return previous(input, init);
  };
}

export function registerCartAbandonmentRetryTests(context: () => Context) {
  test("cart abandonment retries: a failing candidate backs off while the next candidate is admitted", async () => isolated(context(), "retry-fairness", async h => {
    const { syncCartAbandonments } = await import("../lib/marketing/cart-abandonment");
    await setup(h);
    const bad = await candidate(h, "fair-bad", 1000), good = await candidate(h, "fair-good");
    let badChecks = 0;
    mockLookups([bad, good], async seed => { if (seed.id === bad.id) { badChecks++; throw Error("Simulated candidate outage " + "x".repeat(1000)); } });
    const result = await syncCartAbandonments();
    assert.equal(result.checked, 2); assert.equal(result.admitted, 1); assert.match(result.error!, /outage/);
    const failed = await h.prisma.marketingResource.findUniqueOrThrow({ where: { id: bad.id } });
    const data = failed.data as { failureCount: number; error: string; checkedAt: string; nextAttemptAt: string };
    assert.equal(failed.enabled, true); assert.equal(data.failureCount, 1); assert.equal(data.error.length, 500);
    assert.equal(Date.parse(data.nextAttemptAt) - Date.parse(data.checkedAt), 5 * minute);
    await syncCartAbandonments();
    assert.equal(badChecks, 1, "a backed-off candidate is not queried again immediately");
    assert.equal(await h.prisma.marketingWebhookInbox.count({ where: { shop: h.shop, status: { not: "DONE" } } }), 0);
    assert.equal(h.emails.length, 0);
  }));

  test("cart abandonment retries: exponential backoff is bounded and expiry retires the candidate", async t => {
    const start = Date.now(); t.mock.timers.enable({ apis: ["Date"], now: start });
    try { await isolated(context(), "retry-expiry", async h => {
      const { syncCartAbandonments } = await import("../lib/marketing/cart-abandonment");
      await setup(h); const seed = await candidate(h, "retry-expiry");
      let checks = 0;
      mockLookups([seed], async () => { checks++; throw Error("Unavailable"); });
      for (const [index, delay] of [5, 10, 20, 40, 60, 60].entries()) {
        await syncCartAbandonments();
        const row = await h.prisma.marketingResource.findUniqueOrThrow({ where: { id: seed.id } });
        const data = row.data as { failureCount: number; checkedAt: string; nextAttemptAt: string };
        assert.equal(data.failureCount, index + 1);
        assert.equal(Date.parse(data.nextAttemptAt) - Date.parse(data.checkedAt), delay * minute);
        t.mock.timers.setTime(Date.parse(data.nextAttemptAt) - 1);
        await syncCartAbandonments();
        assert.equal(checks, index + 1);
        t.mock.timers.setTime(Date.parse(data.nextAttemptAt));
      }
      t.mock.timers.setTime(start + lifetime + 1);
      const result = await syncCartAbandonments();
      assert.equal(result.ignored, 1); assert.equal(checks, 6, "expiry needs no further Shopify lookup");
      const expired = await h.prisma.marketingResource.findUniqueOrThrow({ where: { id: seed.id } });
      assert.equal(expired.enabled, false);
      assert.match((expired.data as { reason: string }).reason, /expired/);
      assert.equal((expired.data as { error?: string }).error, undefined);
    }); } finally { t.mock.timers.reset(); }
  });

  for (const outcome of ["failed", "successful"] as const) {
    test(`cart abandonment retries: an old ${outcome} lookup cannot overwrite a newer observation`, async t => {
      const start = Date.now(); t.mock.timers.enable({ apis: ["Date"], now: start });
      try { await isolated(context(), "retry-race-" + outcome, async h => {
        const { syncCartAbandonments, stageCartAbandonment } = await import("../lib/marketing/cart-abandonment");
        await setup(h); const seed = await candidate(h, "retry-race");
        mockLookups([seed], async () => {
          t.mock.timers.setTime(start + 1000);
          await h.store.atomic(tx => stageCartAbandonment(tx, { ...seed.input, observedAt: new Date(), merchandise: { ...seed.input.merchandise, subtotalCents: 20000 } }));
          if (outcome === "failed") throw Error("Old lookup failed");
        });
        const result = await syncCartAbandonments();
        assert.equal(result.admitted, 0);
        const fresh = await h.prisma.marketingResource.findUniqueOrThrow({ where: { id: seed.id } });
        const data = fresh.data as { observedAt: string; nextAttemptAt: string; merchandise: { subtotalCents: number }; error?: string; failureCount?: number };
        assert.equal(fresh.enabled, true); assert.equal(data.observedAt, new Date().toISOString());
        assert.equal(data.merchandise.subtotalCents, 20000); assert.equal(data.error, undefined); assert.equal(data.failureCount, undefined);
        assert.equal(data.nextAttemptAt, new Date().toISOString());
        assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: seed.profile.id } }), 0);
      }); } finally { t.mock.timers.reset(); }
    });
  }

  for (const elapsed of [6000, 20001]) {
    test(`cart abandonment retries: a ${elapsed}ms late response rotates without starving the next candidate`, async t => {
      const start = Date.now(); t.mock.timers.enable({ apis: ["Date"], now: start });
      try { await isolated(context(), "retry-deadline-" + elapsed, async h => {
        const { syncCartAbandonments } = await import("../lib/marketing/cart-abandonment");
        await setup(h); const bad = await candidate(h, "deadline-bad", 1000), good = await candidate(h, "deadline-good");
        let badChecks = 0, goodChecks = 0;
        mockLookups([bad, good], async seed => {
          if (seed.id === bad.id) { badChecks++; t.mock.timers.setTime(Date.now() + elapsed); }
          else goodChecks++;
        });
        const first = await syncCartAbandonments();
        assert.match(first.error!, /timed out/);
        assert.equal(first.admitted, elapsed < 20000 ? 1 : 0);
        const failed = await h.prisma.marketingResource.findUniqueOrThrow({ where: { id: bad.id } });
        assert.equal((failed.data as { failureCount: number }).failureCount, 1);
        await syncCartAbandonments();
        assert.equal(badChecks, 1); assert.equal(goodChecks, 1);
        assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: good.profile.id } }), 2);
        assert.equal(h.emails.length, 0);
      }); } finally { t.mock.timers.reset(); }
    });
  }

  test("cart abandonment retries: later metadata never reopens an admitted candidate", async t => {
    const start = Date.now(); t.mock.timers.enable({ apis: ["Date"], now: start });
    try { await isolated(context(), "retry-admitted", async h => {
      const { syncCartAbandonments, stageCartAbandonment } = await import("../lib/marketing/cart-abandonment");
      await setup(h); const seed = await candidate(h, "already-admitted"); mockLookups([seed]);
      assert.equal((await syncCartAbandonments()).admitted, 1);
      t.mock.timers.setTime(start + 1000);
      await h.store.atomic(tx => stageCartAbandonment(tx, { ...seed.input, observedAt: new Date() }));
      const fresh = await h.prisma.marketingResource.findUniqueOrThrow({ where: { id: seed.id } });
      assert.equal(fresh.enabled, false); assert.equal((fresh.data as { status: string }).status, "ADMITTED");
      assert.equal((await syncCartAbandonments()).checked, 0);
      assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: seed.profile.id } }), 2);
    }); } finally { t.mock.timers.reset(); }
  });
}
