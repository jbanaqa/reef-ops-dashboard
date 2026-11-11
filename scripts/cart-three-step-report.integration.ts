import test from "node:test";
import assert from "node:assert/strict";
import { isolated, type Context } from "./cart-launch.integration";
import { DAY, defaultContent } from "../lib/marketing/rules";
import { paidOrderFixture } from "./paid-order.fixture";
import { flowProgress } from "../lib/marketing/flow-progress";
import { flowEmailTemplates } from "../lib/marketing/flow-email-templates";

const ago = (days: number) => new Date(Date.now() - days * DAY);

export function registerCartThreeStepReportTests(context: () => Context) {
  test("three-step cart reports keep each new email, legacy sales and shared-code evidence distinct", async () => isolated(context(), "three-step-reports", async h => {
    const { flowReport } = await import("../lib/marketing/flow-report");
    const { cartReport } = await import("../lib/marketing/cart-report");
    const { cartCheckoutKey } = await import("../lib/marketing/cart");
    const oldFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw Error("Report checks must not contact Shopify or an email provider."); };
    try {
      const config = { reviewed: true, cart: { version: 1, recoveryVersion: 2, productCount: 0, couponHours: 168 },
        steps: [180, 240, 1440].map((minutes, index) => ({ minutes, channel: "EMAIL", subject: `Saved recovery email ${index + 1}`, content: defaultContent })) };
      await h.prisma.marketingResource.upsert({
        where: { shop_kind_key: { shop: h.shop, kind: "FLOW", key: "abandoned-cart" } },
        create: { shop: h.shop, kind: "FLOW", key: "abandoned-cart", name: "Abandoned Cart", enabled: true, data: config },
        update: { enabled: true, data: config },
      });
      const customer = await h.make("three-step-buyer@example.com"), legacy = await h.make("legacy-report-buyer@example.com"),
        early = await h.make("before-offer-buyer@example.com"), internal = await h.make("three-step-internal@example.com");
      const root = cartCheckoutKey(customer.id, "three-step") + ":attempt-12345";
      const legacyRoot = cartCheckoutKey(legacy.id, "legacy");
      const earlyRoot = cartCheckoutKey(early.id, "before-offer");
      const testRoot = cartCheckoutKey(internal.id, "internal");
      for (const [key, profileId, testEmail] of [[root, customer.id, null], [legacyRoot, legacy.id, null], [earlyRoot, early.id, null], [testRoot, internal.id, internal.email]] as const)
        await h.prisma.marketingResource.create({ data: { shop: h.shop, kind: "CART_RUN", key, name: "Recorded cart run", data: { profileId, ...(testEmail ? { testEmail } : {}) } } });
      const addMessage = async (profileId: string, run: string, stage: string, index: number, sentAt: Date, version = 2) => {
        const message = await h.prisma.marketingMessage.create({ data: {
          shop: h.shop, key: `${run}:${stage}`, profileId, flowKey: "abandoned-cart", flowStep: index,
          flowCondition: `cart-v${version}:${stage}`, channel: "EMAIL", subject: `${stage} saved subject`,
          content: defaultContent, status: "SENT", dueAt: sentAt, sentAt, triggerAt: ago(7), createdAt: ago(7),
        } });
        await h.store.atomic(tx => h.store.record(tx, { key: message.id + ":opened", profileId, messageId: message.id, type: "OPENED", occurredAt: new Date(+sentAt + DAY / 2) }));
        return message;
      };
      const messages = [];
      for (const [index, stage] of ["first", "discount10", "discount15"].entries())
        messages.push(await addMessage(customer.id, root, stage, index, ago(6 - index)));
      const oldMessage = await addMessage(legacy.id, legacyRoot, "final-no", 1, ago(3), 1);
      await addMessage(early.id, earlyRoot, "first", 0, ago(4));
      for (const [index, stage] of ["first", "discount10", "discount15"].entries())
        await addMessage(internal.id, testRoot, stage, index, ago(6 - index));
      for (const [key, code, startsAt] of [[root, "AC300-SHARED", ago(5)], [oldMessage.id, "AC300-LEGACY", ago(3)], [earlyRoot, "AC300-NOT-YET-EMAILED", ago(2)]] as const)
        await h.prisma.marketingResource.create({ data: { shop: h.shop, kind: "CART_COUPON", key, name: "Assigned cart offer", data: { code, startsAt: startsAt.toISOString(), endsAt: new Date(Date.now() + DAY).toISOString() } } });
      const order = (profileId: string, id: string, time: Date, checkoutKey: string, code: string, revenue: string) => h.store.atomic(tx => h.store.record(tx, {
        key: `order:${id}`, type: "ORDER", profileId, occurredAt: time,
        payload: paidOrderFixture({ orderId: id, orderLabel: "#" + id, currency: "USD", revenue, checkoutKey, discountCodes: [code] }),
      }));
      await order(customer.id, "70001", ago(3), root.replace(/:attempt-[^:]+$/, ""), "AC300-SHARED", "66.50");
      await order(legacy.id, "70002", ago(1.5), legacyRoot, "AC300-LEGACY", "22.00");
      await order(early.id, "70003", ago(3), earlyRoot, "AC300-NOT-YET-EMAILED", "11.00");
      const report = await flowReport("abandoned-cart"), compact = await cartReport();
      assert.equal(report.totals.sent, 5, "A durable internal test remains excluded for all three new stages");
      assert.equal(report.steps.find(row => row.key === "v2-first")?.sent, 2);
      assert.equal(report.steps.find(row => row.key === "v2-discount10")?.sent, 1);
      assert.equal(report.steps.find(row => row.key === "v2-discount15")?.sent, 1);
      assert.equal(report.steps.find(row => row.key === "final-no")?.sent, 1);
      assert.equal(report.steps.length, 4, "Only the three current stages and legacy stages with actual activity are shown");
      assert.match(report.steps.find(row => row.key === "final-no")!.label, /^Legacy/);
      assert.equal(report.totals.orders, 3);
      assert.deepEqual(report.totals.revenue, { USD: 99.5 });
      assert.equal(report.evidence.discountOrders, 2, "The shared run coupon is counted once; it is not evidence before an offer email is sent");
      assert.deepEqual(report.orders.find(row => row.label === "#70001")!.discountCodes, ["AC300-SHARED"]);
      assert.deepEqual(report.orders.find(row => row.label === "#70003")!.discountCodes, []);
      assert.equal(report.orders.find(row => row.label === "#70001")!.step, "Email #3 · 15% final offer");
      assert.equal(compact.rows.length, 4);
      assert.equal(compact.rows.find(row => row.key === "v2-discount15")?.orders, 1);
      assert.equal(compact.rows.reduce((total, row) => total + row.sent, 0), 5);
      const progress = flowProgress(messages.map((message, index) => index === 2
        ? { ...message, status: "PENDING", sentAt: null, dueAt: new Date(Date.now() + DAY) } : message), [{ key: "abandoned-cart", name: "Abandoned Cart", enabled: true }]);
      assert.equal(progress.length, 1);
      assert.equal(progress[0].lastSent?.label, "Email #2 · 10% offer");
      assert.equal(progress[0].next?.label, "Email #3 · 15% final offer");
      assert.equal(progress[0].next?.branchPending, false);
      const templates = flowEmailTemplates([{ id: "saved", key: "abandoned-cart", kind: "FLOW", data: config }]);
      assert.deepEqual(templates.map(row => row.name), ["Cart reminder", "Cart offer · 10%", "Cart final offer · 15%"]);
      assert.deepEqual(templates.map(row => row.subject), config.steps.map(row => row.subject));
      assert.equal(h.emails.length, 0);
    } finally { globalThis.fetch = oldFetch; }
  }));
}
