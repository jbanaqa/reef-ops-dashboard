import test from "node:test";
import assert from "node:assert/strict";
import { isolated, enrollCartFixture, type Context } from "./cart-launch.integration";
import { threeStepCartDraft } from "../lib/marketing/cart-config";
import { validateFlow } from "../lib/marketing/flow-config";

const hour = 3600000;
export function registerCartSequenceTests(context: () => Context) {
  test("cart sequence v2: final offer renders 15% terms and keeps authored HTML", async () => isolated(context(), "sequence-copy", async h => {
    const { emailBody } = await import("../lib/marketing/delivery");
    const draft = threeStepCartDraft(h.f);
    assert.equal(draft.description, "Recover an unfinished checkout with three emails. Stop automatically after a purchase.");
    const final = draft.steps[2].content;
    const expiresAt = new Date(Date.now() + 6 * 24 * hour).toISOString();
    const delivered = emailBody({ id: "final-copy", to: "copy@example.com", channel: "EMAIL", subject: draft.steps[2].subject,
      content: { ...final, couponCode: "AC-SAME-CODE", couponExpiresAt: expiresAt },
      unsubscribe: "https://app.example/unsubscribe" }, "123 Test Street", "Corals Anonymous");
    assert.match(delivered.html, /15% off your order/);
    assert.match(delivered.text, /15% off your order/);
    assert.doesNotMatch(delivered.html + delivered.text, /10\s*%/);
    assert.match(delivered.text, /same code/i);
    assert.match(delivered.text, /original expiration date/i);
    const formattedExpiry = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeStyle: "short", timeZone: "America/Los_Angeles" }).format(new Date(expiresAt));
    assert.ok(delivered.html.includes(formattedExpiry));
    assert.ok(delivered.text.includes(formattedExpiry));
    assert.doesNotMatch(delivered.html + delivered.text, /\d{4}-\d{2}-\d{2}T\d{2}:/, "customer expiry uses a readable Pacific date rather than raw UTC ISO text");
    assert.doesNotMatch(delivered.text, /(?:another|next|fresh) seven days/i);

    const custom = h.f.orderBranch!.no.content;
    custom.bodyHtml = '<p style="font-size:24px">Our authored <strong>10% offer</strong>.</p>';
    custom.couponTerms = "Custom 10% terms retained.";
    const customFinal = threeStepCartDraft(h.f).steps[2].content;
    assert.equal(customFinal.bodyHtml, '<p style="font-size:24px">Our authored <strong>15% offer</strong>.</p>');
    assert.equal(customFinal.couponTerms, "Custom 15% terms retained.");
    assert.equal(h.f.orderBranch!.no.content.bodyHtml, '<p style="font-size:24px">Our authored <strong>10% offer</strong>.</p>', "upgrading does not rewrite the saved original offer");
    assert.equal(threeStepCartDraft({ ...h.f, description: "Our authored flow description" }).description, "Our authored flow description");
  }));

  test("cart sequence v2: personal expiry values share one content and artwork snapshot", async () => isolated(context(), "sequence-storage", async h => {
    const { saveCartContent, resolveCartContent } = await import("../lib/marketing/cart-storage");
    const base = { ...threeStepCartDraft(h.f).steps[2].content, logo: "data:image/png;base64,AAAA" };
    const firstExpiry = new Date(Date.now() + 7 * 24 * hour).toISOString();
    const secondExpiry = new Date(Date.now() + 8 * 24 * hour).toISOString();
    const first = await saveCartContent(h.prisma, h.shop, { ...base, couponCode: "CART-FIRST", couponExpiresAt: firstExpiry });
    const second = await saveCartContent(h.prisma, h.shop, { ...base, couponCode: "CART-SECOND", couponExpiresAt: secondExpiry });
    type Reference = { cartContentRef: string; values: { couponCode: string; couponExpiresAt: string } };
    assert.equal((first as unknown as Reference).cartContentRef, (second as unknown as Reference).cartContentRef);
    assert.equal((first as unknown as Reference).values.couponExpiresAt, firstExpiry);
    assert.equal((second as unknown as Reference).values.couponExpiresAt, secondExpiry);
    assert.equal(await h.prisma.marketingResource.count({ where: { shop: h.shop, kind: "CART_CONTENT" } }), 1);
    assert.equal(await h.prisma.marketingResource.count({ where: { shop: h.shop, kind: "CART_ASSET" } }), 1);
    const p = await h.make("expiry-roundtrip@example.com");
    const stored = await h.prisma.marketingMessage.create({ data: { shop: h.shop, key: "expiry-roundtrip", profileId: p.id,
      channel: "EMAIL", subject: "Round trip", content: second, dueAt: new Date() } });
    const reloaded = await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: stored.id } });
    const resolved = await resolveCartContent(h.prisma, h.shop, reloaded.content);
    assert.equal(resolved.couponExpiresAt, secondExpiry);
    assert.equal(resolved.couponCode, "CART-SECOND");
    assert.equal(resolved.logo, base.logo);
    assert.equal((await resolveCartContent(h.prisma, h.shop, first)).couponExpiresAt, firstExpiry);
  }));

  test("cart sequence v2: clearing unsent test steps preserves durable exclusion of sent test history", async () => isolated(context(), "sequence-test-cleanup", async h => {
    const { clearUnsentTestMessages } = await import("../lib/marketing/message-test");
    const { customerFlowMessages } = await import("../lib/marketing/cart-report-scope");
    const { cartRunKey } = await import("../lib/marketing/cart");
    const { cartReport } = await import("../lib/marketing/cart-report");
    const p = await h.make("sequence-cleanup@example.com");
    const config = validateFlow("abandoned-cart", threeStepCartDraft(h.f));
    config.cart!.testEmail = p.email!;
    await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { data: h.store.json(config) } });
    await h.store.atomic(tx => enrollCartFixture(tx, p.id, "cleanup", new Date(Date.now() - hour), config, "https://store.example/checkouts/cleanup", [{ product_id: 1 }]));
    const first = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, flowCondition: "cart-v2:first" } });
    await h.prisma.marketingMessage.update({ where: { id: first.id }, data: { status: "SENT", sentAt: new Date() } });
    assert.equal(await clearUnsentTestMessages(p.id), 2);
    assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id } }), 1);
    const saved = await h.prisma.marketingResource.findUniqueOrThrow({ where: { shop_kind_key: { shop: h.shop, kind: "CART_RUN", key: cartRunKey(first.key) } } });
    assert.equal((saved.data as { testEmail?: string }).testEmail, p.email);
    const remaining = await h.prisma.marketingMessage.findMany({ where: { profileId: p.id } });
    assert.deepEqual(await customerFlowMessages(h.prisma, h.shop, remaining), []);
    const report = await cartReport();
    assert.equal(report.rows.reduce((sum, row) => sum + row.sent, 0), 0, "sent restricted tests never become customer analytics after cleanup");
    assert.equal(report.activity.length, 0);
  }));

  test("cart sequence v2: three shared email steps preserve the first wait and ignore configured SMS", async () => isolated(context(), "sequence-stages", async h => {
    const { loadCart, cartRunKey } = await import("../lib/marketing/cart");
    h.f.steps[0].minutes = 180;
    const config = validateFlow("abandoned-cart", threeStepCartDraft(h.f));
    assert.deepEqual(config.steps.map(s => s.minutes), [180, 240, 1440]);
    assert.equal(config.cart!.couponHours, 168);
    assert.equal(config.orderBranch, undefined);
    assert.equal(config.smsContent, undefined);
    const p = await h.make("three-steps@example.com", true);
    Object.assign(process.env, { MARKETING_SMS_GATEWAY_URL: "https://sms.example", MARKETING_SMS_GATEWAY_KEY: "test", MARKETING_SMS_WEBHOOK_SECRET: "test" });
    await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { data: h.store.json(config) } });
    const abandonedAt = new Date(Date.now() - hour);
    await h.store.atomic(tx => enrollCartFixture(tx, p.id, "three", abandonedAt, config, "https://store.example/checkouts/three", [{ product_id: 1 }]));
    const messages = await h.prisma.marketingMessage.findMany({ where: { profileId: p.id }, orderBy: { flowStep: "asc" } });
    assert.deepEqual(messages.map(m => m.flowCondition), ["cart-v2:first", "cart-v2:discount10", "cart-v2:discount15"]);
    assert.ok(messages.every(m => m.channel === "EMAIL" && !!(m.content as { cartContentRef?: string }).cartContentRef));
    assert.equal(+messages[0].dueAt, +abandonedAt + 3 * hour);
    const run = await loadCart(messages[0].key);
    assert.equal(run.sequenceVersion, 2);
    const saved = await h.prisma.marketingResource.findUniqueOrThrow({ where: { shop_kind_key: { shop: h.shop, kind: "CART_RUN", key: cartRunKey(messages[0].key) } } });
    assert.ok((saved.data as { configRef?: string }).configRef);
    assert.ok(JSON.stringify(saved.data).length < 2000, "per-recipient run stores only a shared config reference and compact context");
  }));

  test("cart sequence v2: waits start after actual prior sends and never advance on UNKNOWN", async () => isolated(context(), "sequence-waits", async h => {
    const { loadCart, advanceCart, cartDependency } = await import("../lib/marketing/cart");
    const config = validateFlow("abandoned-cart", threeStepCartDraft(h.f));
    await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { data: h.store.json(config) } });
    const p = await h.make("sequence-waits@example.com"), now = new Date();
    await h.store.atomic(tx => enrollCartFixture(tx, p.id, "waits", new Date(+now - hour), config, "https://store.example/checkouts/waits", [{ product_id: 1 }]));
    const messages = await h.prisma.marketingMessage.findMany({ where: { profileId: p.id }, orderBy: { flowStep: "asc" } });
    const [first, second, third] = messages;
    const run = await loadCart(first.key);
    await h.prisma.marketingMessage.update({ where: { id: first.id }, data: { status: "UNKNOWN" } });
    await h.store.atomic(tx => advanceCart(tx, first));
    assert.ok(await cartDependency(h.prisma, second, run));
    assert.equal(await h.prisma.marketingResource.count({ where: { shop: h.shop, kind: "CART_WAIT", key: second.id } }), 0);
    await h.prisma.marketingMessage.update({ where: { id: first.id }, data: { status: "SENT", sentAt: now } });
    await h.store.atomic(tx => advanceCart(tx, first));
    assert.equal(+(await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: second.id } })).dueAt, +now + 4 * hour);
    const secondSentAt = new Date(+now + 6 * hour);
    await h.prisma.marketingMessage.update({ where: { id: second.id }, data: { status: "UNKNOWN" } });
    await h.store.atomic(tx => advanceCart(tx, second));
    assert.ok(await cartDependency(h.prisma, third, run));
    assert.equal(await h.prisma.marketingResource.count({ where: { shop: h.shop, kind: "CART_WAIT", key: third.id } }), 0);
    await h.prisma.marketingMessage.update({ where: { id: second.id }, data: { status: "SENT", sentAt: secondSentAt } });
    await h.store.atomic(tx => advanceCart(tx, second));
    const finalDue = +(await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: third.id } })).dueAt;
    assert.equal(finalDue, +secondSentAt + 24 * hour, "a late second send starts a full new 24-hour wait");
    config.steps[2].minutes = 1;
    await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { data: h.store.json(config) } });
    await h.store.atomic(tx => advanceCart(tx, second));
    assert.equal(+(await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: third.id } })).dueAt, finalDue);
  }));

  test("cart sequence v2: waiting copy follows saved edits while captured waits and expiry stay fixed", async () => isolated(context(), "sequence-copy-edits", async h => {
    const { loadCart } = await import("../lib/marketing/cart");
    const config = validateFlow("abandoned-cart", threeStepCartDraft(h.f));
    await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { data: h.store.json(config) } });
    const p = await h.make("sequence-copy-edits@example.com");
    await h.store.atomic(tx => enrollCartFixture(tx, p.id, "copy-edits", new Date(Date.now() - hour), config, "https://store.example/checkouts/copy-edits", [{ product_id: 1 }]));
    const first = await h.prisma.marketingMessage.findFirstOrThrow({ where: { profileId: p.id, flowCondition: "cart-v2:first" } });
    const changed = { ...config, cart: { ...config.cart!, couponHours: 24 }, steps: config.steps.map((step, index) => ({
      ...step, minutes: index === 0 ? step.minutes : 1, subject: "Edited waiting subject " + index,
      content: { ...step.content, body: "Edited waiting body " + index },
    })) };
    await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { data: h.store.json(changed) } });
    const loaded = await loadCart(first.key);
    assert.deepEqual(loaded.config.steps.map(step => step.minutes), config.steps.map(step => step.minutes));
    assert.equal(loaded.config.cart!.couponHours, 168);
    assert.deepEqual(loaded.config.steps.map(step => step.subject), ["Edited waiting subject 0", "Edited waiting subject 1", "Edited waiting subject 2"]);
    assert.deepEqual(loaded.config.steps.map(step => step.content.body), ["Edited waiting body 0", "Edited waiting body 1", "Edited waiting body 2"]);
  }));

  test("cart sequence upgrade leaves an existing two-email run and its captured wait unchanged", async () => isolated(context(), "sequence-legacy", async h => {
    const { loadCart, advanceCart } = await import("../lib/marketing/cart");
    const legacy = h.f, p = await h.make("sequence-legacy@example.com");
    legacy.branchMinutes = 1440;
    legacy.orderBranch!.no.subject = "Saved legacy follow-up";
    await h.store.atomic(tx => enrollCartFixture(tx, p.id, "legacy", new Date(Date.now() - hour), legacy, "https://store.example/checkouts/legacy", [{ product_id: 1 }]));
    const [first, final] = await h.prisma.marketingMessage.findMany({ where: { profileId: p.id }, orderBy: { dueAt: "asc" } });
    const upgrade = validateFlow("abandoned-cart", threeStepCartDraft(legacy));
    upgrade.steps[1].minutes = 1;
    upgrade.steps[1].subject = "New sequence only";
    await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { data: h.store.json(upgrade) } });
    const run = await loadCart(first.key);
    assert.equal(run.sequenceVersion, undefined);
    assert.equal(run.config.steps.length, 1);
    assert.equal(run.config.orderBranch!.no.subject, "Saved legacy follow-up");
    const sentAt = new Date();
    await h.prisma.marketingMessage.update({ where: { id: first.id }, data: { status: "SENT", sentAt } });
    await h.store.atomic(tx => advanceCart(tx, first));
    assert.equal(+(await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: final.id } })).dueAt, +sentAt + 24 * hour);
    assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id } }), 2, "upgrading never adds a third email to an existing run");
  }));

  test("cart sequence v2: failed or cancelled predecessors stop all remaining offers", async () => isolated(context(), "sequence-stop", async h => {
    const { advanceCart, cartSequenceStop } = await import("../lib/marketing/cart");
    const config = validateFlow("abandoned-cart", threeStepCartDraft(h.f));
    await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { data: h.store.json(config) } });
    for (const stage of [0, 1]) for (const status of ["FAILED", "CANCELLED"] as const) {
      const p = await h.make(`sequence-stop-${stage}-${status.toLowerCase()}@example.com`);
      await h.store.atomic(tx => enrollCartFixture(tx, p.id, "stopped", new Date(Date.now() - hour), config, "https://store.example/checkouts/stopped", [{ product_id: 1 }]));
      const messages = await h.prisma.marketingMessage.findMany({ where: { profileId: p.id }, orderBy: { flowStep: "asc" } });
      if (stage === 1) await h.prisma.marketingMessage.update({ where: { id: messages[0].id }, data: { status: "SENT", sentAt: new Date() } });
      await h.prisma.marketingMessage.update({ where: { id: messages[stage].id }, data: { status } });
      assert.equal(await cartSequenceStop(h.prisma, messages[stage + 1].key, messages[stage + 1].flowCondition), "Previous cart reminder was not sent");
      await h.store.atomic(tx => advanceCart(tx, messages[stage]));
      assert.equal(await h.prisma.marketingMessage.count({ where: { profileId: p.id, status: "PENDING" } }), 0);
      assert.equal((await h.prisma.marketingMessage.findUniqueOrThrow({ where: { id: messages[2].id } })).status, "CANCELLED");
    }
  }));
}
