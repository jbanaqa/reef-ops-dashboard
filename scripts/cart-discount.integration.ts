import test from "node:test";
import assert from "node:assert/strict";
import { isolated, enrollCartFixture, type Context } from "./cart-launch.integration";
import { threeStepCartDraft } from "../lib/marketing/cart-config";
import { validateFlow } from "../lib/marketing/flow-config";
import type { SavedCartDiscount } from "../lib/marketing/cart-discount";

const hour = 3600000;
type Node = {
  id: string;
  codeDiscount: {
    __typename: string; title: string; startsAt: string; endsAt: string; status: string;
    asyncUsageCount: number; usageLimit: number; appliesOncePerCustomer: boolean;
    minimumRequirement: null | { __typename: string }; context: { __typename: string };
    combinesWith: { orderDiscounts: boolean; productDiscounts: boolean; shippingDiscounts: boolean };
    customerGets: { items: { __typename: string; allItems: boolean }; value: { __typename: string; percentage: number } };
  };
};
type DiscountInput = { code: string; title: string; startsAt: string; endsAt: string;
  usageLimit: number; appliesOncePerCustomer: boolean; context: { all: string };
  customerGets: { items: { all: boolean }; value: { percentage: number } };
  combinesWith: Node["codeDiscount"]["combinesWith"] };

/** Strict transport mock shared by helper and actual three-email worker tests. */
function discountTransport(fallback: typeof globalThis.fetch) {
  const state = { remote: null as Node | null, creates: 0, upgrades: 0, createInputs: [] as DiscountInput[],
    loseCreate: false, loseUpgrade: false, ignoreUpgrade: false, unavailableLookup: false,
    createResult: "success" as "success" | "rejected" | "rejected-existing" | "missing-node" | "missing-errors" | "empty-errors" | "missing-payload" | "unknown" | "throttled" | "internal-error",
    lookups: 0, onCreate: undefined as (() => Promise<void>) | undefined,
    onLookup: undefined as ((code: string, count: number) => Promise<void>) | undefined };
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (String(input).includes("/graphql.json")) {
      const b = JSON.parse(String(init?.body)) as { query: string; variables: { code: string; id: string; input: DiscountInput } };
      if (b.query.includes("CartRecoveryDiscountLookup")) {
        await state.onLookup?.(b.variables.code, ++state.lookups);
        if (state.unavailableLookup) throw Error("Mock Shopify lookup unavailable");
        return Response.json({ data: { codeDiscountNodeByCode: state.remote } });
      }
      if (b.query.includes("CartRecoveryDiscountCreate")) {
        state.creates++; state.createInputs.push(b.variables.input);
        await state.onCreate?.();
        const rejected = { codeDiscountNode: null, userErrors: [{ message: "Mock recoverable creation rejection" }] };
        if (state.createResult === "rejected") return Response.json({ data: { discountCodeBasicCreate: rejected } });
        if (state.createResult === "missing-node") return Response.json({ data: { discountCodeBasicCreate: { userErrors: rejected.userErrors } } });
        if (state.createResult === "missing-errors") return Response.json({ data: { discountCodeBasicCreate: { codeDiscountNode: null } } });
        if (state.createResult === "empty-errors") return Response.json({ data: { discountCodeBasicCreate: { codeDiscountNode: null, userErrors: [] } } });
        if (state.createResult === "missing-payload") return Response.json({ data: {} });
        if (state.createResult === "unknown") throw Error("Mock uncertain creation with no recorded response");
        if (state.createResult === "throttled" || state.createResult === "internal-error")
          return Response.json({ errors: [{ extensions: { code: state.createResult === "throttled" ? "THROTTLED" : "INTERNAL_SERVER_ERROR" } }] });
        const value = b.variables.input;
        assert.deepEqual(value.context, { all: "ALL" });
        assert.deepEqual(value.combinesWith, { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false });
        assert.equal(value.usageLimit, 1); assert.equal(value.appliesOncePerCustomer, true);
        assert.equal(value.customerGets.value.percentage, 0.1);
        state.remote = { id: "gid://shopify/DiscountCodeNode/123", codeDiscount: {
          __typename: "DiscountCodeBasic", title: value.title, startsAt: value.startsAt, endsAt: value.endsAt,
          status: "ACTIVE", asyncUsageCount: 0, usageLimit: 1, appliesOncePerCustomer: true, minimumRequirement: null,
          context: { __typename: "DiscountBuyerSelectionAll" }, combinesWith: structuredClone(value.combinesWith),
          customerGets: { items: { __typename: "AllDiscountItems", allItems: true },
            value: { __typename: "DiscountPercentage", percentage: 0.1 } },
        } };
        if (state.createResult === "rejected-existing") return Response.json({ data: { discountCodeBasicCreate: rejected } });
        if (state.loseCreate) { state.loseCreate = false; throw Error("Mock lost creation response"); }
        return Response.json({ data: { discountCodeBasicCreate: { codeDiscountNode: { id: state.remote.id }, userErrors: [] } } });
      }
      if (b.query.includes("CartRecoveryDiscountUpgrade")) {
        state.upgrades++;
        assert.equal(b.variables.id, state.remote?.id);
        assert.deepEqual(b.variables.input, { customerGets: { value: { percentage: 0.15 } } },
          "an upgrade must never reset usage, dates, code or stacking restrictions");
        if (!state.ignoreUpgrade) state.remote!.codeDiscount.customerGets.value.percentage = 0.15;
        if (state.loseUpgrade) { state.loseUpgrade = false; throw Error("Mock lost upgrade response"); }
        return Response.json({ data: { discountCodeBasicUpdate: { codeDiscountNode: { id: state.remote!.id }, userErrors: [] } } });
      }
    }
    return fallback(input, init);
  };
  return { state, fetch };
}

async function offerFixture(context: Context, name: string, work: (h: Context & {
  shop: string; root: string; profileId: string; state: ReturnType<typeof discountTransport>["state"];
  ensure: (percentage: 10 | 15, hours?: number) => Promise<SavedCartDiscount>;
  stage: (percentage: 10 | 15) => Promise<void>;
}) => Promise<void>) {
  await isolated(context, "coupon-" + name, async h => {
    const { cartRunKey } = await import("../lib/marketing/cart");
    const { ensureCartDiscount } = await import("../lib/marketing/cart-discount");
    const profile = await h.make("offer@example.com"), config = validateFlow("abandoned-cart", threeStepCartDraft(h.f));
    await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { data: h.store.json(config) } });
    await h.store.atomic(tx => enrollCartFixture(tx, profile.id, name, new Date(Date.now() - hour), config,
      "https://store.example/checkouts/" + name, [{ product_id: 1 }]));
    const messages = await h.prisma.marketingMessage.findMany({ where: { shop: h.shop, profileId: profile.id } });
    const root = cartRunKey(messages[0].key), transport = discountTransport(globalThis.fetch);
    globalThis.fetch = transport.fetch;
    const stage = async (percentage: 10 | 15) => {
      const previous = percentage === 10 ? "first" : "discount10", current = percentage === 10 ? "discount10" : "discount15";
      await h.prisma.marketingMessage.update({ where: { key: root + ":" + previous }, data: { status: "SENT", sentAt: new Date(Date.now() - 1000) } });
      await h.prisma.marketingMessage.update({ where: { key: root + ":" + current }, data: { status: "SENDING", attemptedAt: new Date() } });
    };
    await stage(10);
    await work({ ...h, root, profileId: profile.id, state: transport.state, stage,
      ensure: (percentage, hours = 168) => ensureCartDiscount(root, profile.id, percentage, hours) });
  });
}

export function registerCartDiscountTests(context: () => Context) {
  test("cart shared discount: known previous buyers cannot allocate or upgrade an offer", async () => offerFixture(context(), "returning-buyer", async h => {
    const { CartDiscountStopped } = await import("../lib/marketing/cart-discount");
    await h.prisma.marketingProfile.update({ where: { id: h.profileId }, data: { lastOrderAt: new Date(Date.now() - hour) } });
    await assert.rejects(h.ensure(10), error => {
      assert.ok(error instanceof CartDiscountStopped);
      assert.match(error.message, /only for customers with no previous orders/); return true;
    });
    assert.equal(h.state.creates, 0); assert.equal(h.state.lookups, 0);
    assert.equal(await h.prisma.marketingResource.count({ where: { shop: h.shop, kind: "CART_COUPON", key: h.root } }), 0);
  }));

  test("cart shared discount: authentication failing before the mutation POST can recover with the same allocation", async () => offerFixture(context(), "auth-before-create", async h => {
    const { ShopifyRequestNotExecutedError } = await import("../lib/shopify-request-error");
    const original = globalThis.fetch;
    let failAuthentication = false;
    h.state.onLookup = async (_code, count) => { if (count === 1) failAuthentication = true; };
    globalThis.fetch = async (input, init) => String(input).includes("/oauth/access_token") && failAuthentication
      ? new Response("<!DOCTYPE html><p>Mock temporary token rejection</p>", { status: 400 })
      : original(input, init);
    await assert.rejects(h.ensure(10), ShopifyRequestNotExecutedError);
    const row = await h.prisma.marketingResource.findUniqueOrThrow({ where: { shop_kind_key: { shop: h.shop, kind: "CART_COUPON", key: h.root } } });
    const allocation = row.data as SavedCartDiscount;
    assert.equal(h.state.creates, 0, "failed authentication never reached the create endpoint");
    assert.equal(allocation.creationRejectedAttemptId, allocation.creationAttemptId,
      "the proven non-send survives the still-unavailable reconciliation request");
    failAuthentication = false;
    const recovered = await h.ensure(10);
    assert.equal(recovered.code, allocation.code); assert.equal(recovered.startsAt, allocation.startsAt); assert.equal(recovered.endsAt, allocation.endsAt);
    assert.equal(h.state.creates, 1); assert.equal(recovered.creationRejectedAttemptId, undefined);
  }));

  test("cart shared discount: a proven pre-execution throttle retries the same code without extending expiry", async () => offerFixture(context(), "throttled-create", async h => {
    h.state.createResult = "throttled";
    await assert.rejects(h.ensure(10), /THROTTLED/);
    const row = await h.prisma.marketingResource.findUniqueOrThrow({ where: { shop_kind_key: { shop: h.shop, kind: "CART_COUPON", key: h.root } } });
    const allocation = row.data as SavedCartDiscount;
    assert.equal(allocation.creationAttemptedAt, undefined);
    h.state.createResult = "success";
    const recovered = await h.ensure(10);
    assert.equal(recovered.code, allocation.code); assert.equal(recovered.endsAt, allocation.endsAt);
    assert.equal(h.state.creates, 2);
  }));

  test("cart shared discount: a definitive rejected creation retries the same allocation and fixed expiry", async () => offerFixture(context(), "rejected-retry", async h => {
    const load = () => h.prisma.marketingResource.findUniqueOrThrow({ where: { shop_kind_key: { shop: h.shop, kind: "CART_COUPON", key: h.root } } });
    h.state.createResult = "rejected";
    await assert.rejects(h.ensure(10), /creation rejected: Mock recoverable creation rejection/);
    const rejected = (await load()).data as SavedCartDiscount;
    assert.equal(rejected.creationAttemptedAt, undefined); assert.equal(rejected.creationAttemptId, undefined);
    assert.equal(rejected.creationRejectedAttemptId, undefined);
    h.state.createResult = "success";
    const accepted = await h.ensure(10);
    assert.equal(h.state.creates, 2, "the rejected request can retry after Shopify reports no creation");
    assert.equal(accepted.code, rejected.code); assert.equal(accepted.startsAt, rejected.startsAt); assert.equal(accepted.endsAt, rejected.endsAt);
    assert.equal(new Set(h.state.createInputs.map(input => input.code)).size, 1);
    assert.equal(await h.prisma.marketingResource.count({ where: { shop: h.shop, kind: "CART_COUPON", key: h.root } }), 1);
  }));

  test("cart shared discount: rejection proof survives a reconciliation outage and is scoped to its creation claim", async () => offerFixture(context(), "rejected-outage", async h => {
    h.state.createResult = "rejected";
    h.state.onCreate = async () => { h.state.unavailableLookup = true; };
    await assert.rejects(h.ensure(10), /lookup unavailable/);
    const row = await h.prisma.marketingResource.findUniqueOrThrow({ where: { shop_kind_key: { shop: h.shop, kind: "CART_COUPON", key: h.root } } });
    const saved = row.data as SavedCartDiscount;
    assert.ok(saved.creationAttemptId); assert.equal(saved.creationRejectedAttemptId, saved.creationAttemptId);
    h.state.onCreate = undefined; h.state.unavailableLookup = false; h.state.createResult = "success";
    const recovered = await h.ensure(10);
    assert.equal(recovered.code, saved.code); assert.equal(recovered.endsAt, saved.endsAt);
    assert.notEqual(recovered.creationAttemptId, saved.creationAttemptId, "a retry owns a different claim even within the same clock tick");
    assert.equal(recovered.creationRejectedAttemptId, undefined); assert.equal(h.state.creates, 2);
  }));

  test("cart shared discount: a rejected request reconciles an existing code instead of recreating it", async () => offerFixture(context(), "rejected-existing", async h => {
    h.state.createResult = "rejected-existing";
    const recovered = await h.ensure(10);
    assert.equal(recovered.discountId, h.state.remote!.id);
    assert.equal(recovered.creationRejectedAttemptId, undefined); assert.equal(h.state.creates, 1);
    assert.equal((await h.ensure(10)).code, recovered.code); assert.equal(h.state.creates, 1);
  }));

  for (const result of ["missing-node", "missing-errors", "empty-errors", "missing-payload", "unknown", "internal-error"] as const) {
    test(`cart shared discount: ${result} cannot release an uncertain creation claim`, async () => offerFixture(context(), "unknown-" + result, async h => {
      h.state.createResult = result;
      await assert.rejects(h.ensure(10));
      const row = await h.prisma.marketingResource.findUniqueOrThrow({ where: { shop_kind_key: { shop: h.shop, kind: "CART_COUPON", key: h.root } } });
      const allocation = row.data as SavedCartDiscount;
      assert.ok(allocation.creationAttemptedAt); assert.ok(allocation.creationAttemptId); assert.equal(allocation.creationRejectedAttemptId, undefined);
      h.state.createResult = "success";
      await assert.rejects(h.ensure(10), /creation is awaiting verification/);
      assert.equal(h.state.creates, 1, "an unknown response cannot recreate a possibly created/deleted/used discount");
      assert.deepEqual((await h.prisma.marketingResource.findUniqueOrThrow({ where: { id: row.id } })).data, row.data);
    }));
  }

  test("cart shared discount: a cross-process creation claim cannot be overwritten by an older preparation", async () => offerFixture(context(), "claimed-race", async h => {
    h.state.onLookup = async (_code, count) => {
      if (count !== 1) return;
      const row = await h.prisma.marketingResource.findUniqueOrThrow({ where: { shop_kind_key: { shop: h.shop, kind: "CART_COUPON", key: h.root } } });
      await h.prisma.marketingResource.update({ where: { id: row.id }, data: { data: h.store.json({
        ...row.data as object, creationAttemptedAt: new Date().toISOString(), creationAttemptId: "other-process-claim",
      }) } });
    };
    await assert.rejects(h.ensure(10), /allocation changed; retry verification/);
    await assert.rejects(h.ensure(10), /creation is awaiting verification/);
    assert.equal(h.state.creates, 0);
  }));

  test("cart shared discount: a rejected response cannot clear a newer cross-process claim", async () => offerFixture(context(), "rejected-race", async h => {
    h.state.createResult = "rejected";
    h.state.onCreate = async () => {
      const row = await h.prisma.marketingResource.findUniqueOrThrow({ where: { shop_kind_key: { shop: h.shop, kind: "CART_COUPON", key: h.root } } });
      await h.prisma.marketingResource.update({ where: { id: row.id }, data: { data: h.store.json({ ...row.data as object,
        creationAttemptId: "new-process-claim", creationRejectedAttemptId: "older-rejected-claim",
      }) } });
    };
    await assert.rejects(h.ensure(10), /allocation changed; retry verification/);
    h.state.createResult = "success"; h.state.onCreate = undefined;
    await assert.rejects(h.ensure(10), /creation is awaiting verification/);
    const row = await h.prisma.marketingResource.findUniqueOrThrow({ where: { shop_kind_key: { shop: h.shop, kind: "CART_COUPON", key: h.root } } });
    assert.equal((row.data as SavedCartDiscount).creationAttemptId, "new-process-claim");
    assert.equal((row.data as SavedCartDiscount).creationRejectedAttemptId, "older-rejected-claim");
    assert.equal(h.state.creates, 1);
  }));

  test("cart shared discount: one durable single-use code upgrades 10 to 15 without extending seven-day expiry", async () => offerFixture(context(), "upgrade", async h => {
    const first = await h.ensure(10);
    assert.equal(first.percentage, 10);
    assert.equal(Date.parse(first.endsAt) - Date.parse(first.startsAt), 168 * hour);
    await h.stage(15);
    const upgraded = await h.ensure(15);
    assert.equal(upgraded.code, first.code); assert.equal(upgraded.discountId, first.discountId);
    assert.equal(upgraded.percentage, 15); assert.equal(upgraded.endsAt, first.endsAt); assert.equal(upgraded.startsAt, first.startsAt);
    await h.stage(10);
    const retry = await h.ensure(10, 1);
    assert.equal(retry.percentage, 15, "a stale 10% preparation cannot reduce an already upgraded code");
    assert.equal(retry.endsAt, first.endsAt, "retry parameters cannot replace the durable expiry");
    assert.equal(h.state.creates, 1); assert.equal(h.state.upgrades, 1);
    assert.equal(await h.prisma.marketingResource.count({ where: { shop: h.shop, kind: "CART_COUPON", key: h.root } }), 1);
  }));

  test("cart shared discount: lost creation and upgrade responses recover by lookup without reminting or reapplying", async () => offerFixture(context(), "lost", async h => {
    h.state.loseCreate = true;
    await assert.rejects(h.ensure(10), /lost creation response/);
    const first = await h.ensure(10);
    assert.equal(h.state.creates, 1);
    await h.stage(15); h.state.loseUpgrade = true;
    await assert.rejects(h.ensure(15), /lost upgrade response/);
    const recovered = await h.ensure(15);
    assert.equal(recovered.code, first.code); assert.equal(recovered.endsAt, first.endsAt);
    assert.equal(recovered.percentage, 15); assert.equal(h.state.creates, 1); assert.equal(h.state.upgrades, 1);
  }));

  test("cart shared discount: repeated concurrent preparations share one code and remote allocation", async () => offerFixture(context(), "concurrent", async h => {
    const codes = await Promise.all([h.ensure(10), h.ensure(10), h.ensure(10)]);
    assert.equal(new Set(codes.map(code => code.code)).size, 1); assert.equal(h.state.creates, 1);
  }));

  for (const change of ["used", "expired", "removed", "title", "stacking", "limit", "context", "percentage", "cancelled-run", "owner", "recipient"] as const) {
    test(`cart shared discount: ${change} blocks an upgrade instead of replacing the offer`, async () => offerFixture(context(), change, async h => {
      const { CartDiscountStopped } = await import("../lib/marketing/cart-discount");
      await h.ensure(10); await h.stage(15);
      if (change === "used") h.state.remote!.codeDiscount.asyncUsageCount = 1;
      if (change === "expired") h.state.remote!.codeDiscount.status = "EXPIRED";
      if (change === "removed") h.state.remote = null;
      if (change === "title") h.state.remote!.codeDiscount.title = "Someone else's offer";
      if (change === "stacking") h.state.remote!.codeDiscount.combinesWith.orderDiscounts = true;
      if (change === "limit") h.state.remote!.codeDiscount.usageLimit = 2;
      if (change === "context") h.state.remote!.codeDiscount.context.__typename = "DiscountCustomers";
      if (change === "percentage") h.state.remote!.codeDiscount.customerGets.value.percentage = 0.2;
      if (change === "cancelled-run") {
        const row = await h.prisma.marketingResource.findUniqueOrThrow({ where: { shop_kind_key: { shop: h.shop, kind: "CART_RUN", key: h.root } } });
        await h.prisma.marketingResource.update({ where: { id: row.id }, data: { data: h.store.json({ ...row.data as object, completedAt: new Date().toISOString() }) } });
      }
      if (change === "owner") await h.prisma.marketingResource.update({ where: { shop_kind_key: { shop: h.shop, kind: "CART_ACTIVE", key: h.profileId } }, data: { data: { runKey: "new-checkout" } } });
      if (change === "recipient") await h.prisma.marketingProfile.update({ where: { id: h.profileId }, data: { email: "another@example.com" } });
      await assert.rejects(h.ensure(15), CartDiscountStopped);
      assert.equal(h.state.creates, 1); assert.equal(h.state.upgrades, 0);
    }));
  }

  test("cart shared discount: unsuccessful readback cannot promise 15%, and API failures retain the allocation", async () => offerFixture(context(), "readback", async h => {
    const initial = await h.ensure(10); await h.stage(15); h.state.ignoreUpgrade = true;
    await assert.rejects(h.ensure(15), /upgrade could not be verified/);
    h.state.unavailableLookup = true;
    await assert.rejects(h.ensure(15), /lookup unavailable/);
    const row = await h.prisma.marketingResource.findUniqueOrThrow({ where: { shop_kind_key: { shop: h.shop, kind: "CART_COUPON", key: h.root } } });
    assert.equal((row.data as SavedCartDiscount).code, initial.code);
    assert.equal((row.data as SavedCartDiscount).percentage, 10);
    assert.equal(h.state.creates, 1);
  }));

  test("cart sequence v2 worker: actual sends at first, four hours and twenty-four hours share the upgraded coupon", async t => isolated(context(), "worker-coupon", async h => {
    const { cartRunKey } = await import("../lib/marketing/cart");
    const start = Math.floor(Date.now() / 1000) * 1000;
    t.mock.timers.enable({ apis: ["Date"], now: start });
    try {
      const p = await h.make("three-email-worker@example.com"), config = validateFlow("abandoned-cart", threeStepCartDraft(h.f));
      config.steps[0].minutes = 0;
      config.cart!.productCount = 0;
      config.reviewed = true;
      await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { data: h.store.json(config) } });
      const transport = discountTransport(globalThis.fetch); globalThis.fetch = transport.fetch;
      await h.store.atomic(tx => enrollCartFixture(tx, p.id, "worker", new Date(start - hour), config,
        "https://store.example/checkouts/worker", [{ product_id: 1 }]));
      const messages = await h.prisma.marketingMessage.findMany({ where: { shop: h.shop, profileId: p.id }, orderBy: { flowStep: "asc" } });
      const [first, second, third] = messages;
      await h.worker.runMarketing(first.id);
      assert.equal(h.emails.length, 1); assert.doesNotMatch(String(h.emails[0].html), /CART-[A-Z2-9]{12}/);
      assert.equal(+(await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: second.id } })).dueAt, start + 4 * hour);
      t.mock.timers.setTime(start + 4 * hour - 1); await h.worker.runMarketing(second.id);
      assert.equal(h.emails.length, 1, "the coupon email cannot run early");
      t.mock.timers.setTime(start + 4 * hour); await h.worker.runMarketing(second.id);
      assert.equal(h.emails.length, 2, "the entered four-hour cart wait is not replaced by 16-hour spacing");
      const key = cartRunKey(first.key);
      const allocation = await h.prisma.marketingResource.findUniqueOrThrow({ where: { shop_kind_key: { shop: h.shop, kind: "CART_COUPON", key } } });
      const saved = allocation.data as SavedCartDiscount;
      assert.equal(saved.percentage, 10); assert.equal(Date.parse(saved.endsAt) - Date.parse(saved.startsAt), 168 * hour);
      assert.match(String(h.emails[1].html), /10%/); assert.ok(String(h.emails[1].html).includes(saved.code));
      assert.equal(+(await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: third.id } })).dueAt, start + 28 * hour);
      t.mock.timers.setTime(start + 28 * hour); await h.worker.runMarketing(third.id);
      assert.equal(h.emails.length, 3);
      assert.match(String(h.emails[2].html), /15%/); assert.ok(String(h.emails[2].html).includes(saved.code));
      assert.doesNotMatch(String(h.emails[2].html), /10%/);
      const final = await h.prisma.marketingResource.findUniqueOrThrow({ where: { id: allocation.id } });
      assert.equal((final.data as SavedCartDiscount).percentage, 15); assert.equal((final.data as SavedCartDiscount).endsAt, saved.endsAt);
      assert.equal(transport.state.creates, 1); assert.equal(transport.state.upgrades, 1);
      assert.equal(await h.prisma.marketingResource.count({ where: { shop: h.shop, kind: "CART_COUPON" } }), 1);
    } finally { t.mock.timers.reset(); }
  }));

  test("cart sequence v2 worker: buyer evidence appearing during coupon creation stops both offers before sending", async t => isolated(context(), "worker-buyer-transition", async h => {
    const start = Math.floor(Date.now() / 1000) * 1000;
    t.mock.timers.enable({ apis: ["Date"], now: start });
    try {
      const p = await h.make("buyer-transition@example.com"), config = validateFlow("abandoned-cart", threeStepCartDraft(h.f));
      config.steps[0].minutes = 0; config.cart!.productCount = 0; config.reviewed = true;
      await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { data: h.store.json(config) } });
      const transport = discountTransport(globalThis.fetch); globalThis.fetch = transport.fetch;
      await h.store.atomic(tx => enrollCartFixture(tx, p.id, "buyer-transition", new Date(start - hour), config,
        "https://store.example/checkouts/buyer-transition", [{ product_id: 1 }]));
      const messages = await h.prisma.marketingMessage.findMany({ where: { shop: h.shop, profileId: p.id }, orderBy: { flowStep: "asc" } });
      const [first, second, third] = messages;
      await h.worker.runMarketing(first.id);
      assert.equal(h.emails.length, 1);
      transport.state.onCreate = async () => {
        await h.prisma.marketingProfile.update({ where: { id: p.id }, data: { lastOrderAt: new Date(start - 365 * 24 * hour) } });
      };
      t.mock.timers.setTime(start + 4 * hour);
      await h.worker.runMarketing(second.id);
      assert.equal(transport.state.creates, 1, "the proof changed after the preclaim buyer check");
      assert.equal(h.emails.length, 1, "neither discount can be sent to the newly identified previous buyer");
      for (const message of [second, third])
        assert.equal((await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: message.id } })).status, "CANCELLED");
      assert.match((await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: second.id } })).error!, /only for customers with no previous orders/);
    } finally { t.mock.timers.reset(); }
  }));
}
