import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import crypto from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { defaultContent } from "../lib/marketing/rules";

// A new in-memory PostgreSQL database, never an existing DATABASE_URL.
let db: PGlite, server: PGLiteSocketServer, prisma: PrismaClient;
let store: typeof import("../lib/marketing/store"),
  ingest: typeof import("../lib/marketing/ingest"),
  inbox: typeof import("../lib/marketing/inbox"),
  worker: typeof import("../lib/marketing/worker");
const shop = "audit.myshopify.com",
  at = new Date(),
  sent: Record<string, unknown>[] = [];
let customer = {
  id: "gid://shopify/Customer/10",
  legacyResourceId: "10",
  email: "b2b@example.com",
  phone: null,
  firstName: "Jane",
  lastName: "Doe",
  tags: ["b2b"],
  emailMarketingConsent: {
    marketingState: "SUBSCRIBED",
    consentUpdatedAt: at.toISOString(),
  },
  smsMarketingConsent: null,
};
const originalFetch = globalThis.fetch;
before(async () => {
  console.log("integration: creating isolated database");
  db = await PGlite.create();
  console.log("integration: applying migrations");
  const migrations = (await readdir("prisma/migrations"))
    .filter((x) =>
      /baseline|add_product_inventory_state|add_our_klaviyo|marketing_flow_branch|marketing_webhook_inbox/.test(
        x,
      ),
    )
    .sort();
  for (const migration of migrations)
    await db.exec(
      await readFile(
        "prisma/migrations/" + migration + "/migration.sql",
        "utf8",
      ),
    );
  server = new PGLiteSocketServer({
    db,
    host: "127.0.0.1",
    port: 0,
    maxConnections: 1,
  });
  await server.start();
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@" + server.getServerConn() + "/postgres";
  console.log("integration: isolated database ready");
  Object.assign(process.env, {
    SHOPIFY_SHOP_DOMAIN: shop,
    SHOPIFY_CLIENT_ID: "test",
    SHOPIFY_CLIENT_SECRET: "test-secret",
    MARKETING_INGEST_ENABLED: "true",
    MARKETING_SEND_ENABLED: "true",
    MARKETING_MIGRATION_CONFIRMED: "true",
    MARKETING_FORM_ENABLED: "true",
    MARKETING_STOREFRONT_ORIGIN: "https://store.example",
    APP_BASE_URL: "https://app.example",
    RESEND_API_KEY: "test",
    RESEND_FROM_EMAIL: "test@example.com",
    RESEND_WEBHOOK_SECRET: "test",
    MARKETING_POSTAL_ADDRESS: "123 Test Street",
    MARKETING_WELCOME_COUPON: "FIRST10",
  });
  prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DATABASE_URL,
      max: 1,
    }),
  });
  (globalThis as unknown as { prisma: PrismaClient }).prisma = prisma;
  store = await import("../lib/marketing/store");
  ingest = await import("../lib/marketing/ingest");
  inbox = await import("../lib/marketing/inbox");
  worker = await import("../lib/marketing/worker");
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/oauth/access_token"))
      return Response.json({ access_token: "mock" });
    if (url.includes("/graphql.json"))
      return Response.json({ data: { customer } });
    if (url === "https://api.resend.com/emails") {
      sent.push(JSON.parse(String(init?.body)));
      return Response.json({ id: crypto.randomUUID() });
    }
    throw new Error("Unexpected external request blocked: " + url);
  };
  console.log("integration: seeding flows");
  await store.seed();
  const f = await prisma.marketingResource.findUniqueOrThrow({
    where: { shop_kind_key: { shop, kind: "FLOW", key: "b2b-welcome" } },
  });
  await prisma.marketingResource.update({
    where: { id: f.id },
    data: { enabled: true, data: { ...(f.data as object), reviewed: true } },
  });
});
after(async () => {
  globalThis.fetch = originalFetch;
  await prisma?.$disconnect();
  await server?.stop();
  await db?.close();
});

test("B2B tag event hydrates consent, preserves omitted tags, and sends once", async () => {
  await inbox.queueShopify("customer.tags_added", "tag-10", {
    customerId: customer.id,
    tags: ["b2b"],
    occurredAt: at.toISOString(),
  });
  await inbox.processMarketingInbox();
  let profile = await prisma.marketingProfile.findUniqueOrThrow({
    where: { shop_shopifyId: { shop, shopifyId: "10" } },
  });
  assert.deepEqual(profile.tags, ["b2b"]);
  await ingest.ingestShopify("customers/update", "customer-10", {
    id: "10",
    email: customer.email,
    updated_at: new Date().toISOString(),
  });
  profile = await prisma.marketingProfile.findUniqueOrThrow({
    where: { id: profile.id },
  });
  assert.deepEqual(profile.tags, ["b2b"]);
  await worker.runMarketing();
  assert.equal(sent.length, 1);
  assert.match(String(sent[0].html), /Jane/);
  await inbox.queueShopify("customer.tags_added", "tag-10", {
    customerId: customer.id,
    tags: ["b2b"],
  });
  await inbox.queueShopify("customer.tags_added", "tag-10-again", {
    customerId: customer.id,
    tags: ["b2b"],
    occurredAt: new Date().toISOString(),
  });
  await worker.runMarketing();
  assert.equal(sent.length, 1);
  assert.equal(
    await prisma.marketingMessage.count({
      where: { profileId: profile.id, flowKey: "b2b-welcome" },
    }),
    1,
  );
});

test("tag removal cancels an unsent B2B welcome", async () => {
  customer = {
    ...customer,
    id: "gid://shopify/Customer/11",
    legacyResourceId: "11",
    email: "removed@example.com",
    tags: ["b2b"],
  };
  await ingest.ingestShopify("customer.tags_added", "tag-11", {
    customerId: customer.id,
    tags: ["b2b"],
    occurredAt: new Date().toISOString(),
  });
  customer = { ...customer, tags: [] };
  await ingest.ingestShopify("customer.tags_removed", "untag-11", {
    customerId: customer.id,
    tags: ["b2b"],
    occurredAt: new Date().toISOString(),
  });
  await worker.runMarketing();
  const p = await prisma.marketingProfile.findUniqueOrThrow({
    where: { shop_shopifyId: { shop, shopifyId: "11" } },
  });
  assert.equal(
    (
      await prisma.marketingMessage.findFirstOrThrow({
        where: { profileId: p.id },
      })
    ).error,
    "B2B tag removed",
  );
  assert.equal(sent.length, 1);
});

test("50 SMS without a gateway do not block email", async () => {
  const p = await store.atomic(async (tx) => {
    const p = await store.identify(tx, {
      email: "queue@example.com",
      phone: "+15551234567",
    });
    await store.consent(tx, p.id, "EMAIL", "SUBSCRIBED", "test", new Date());
    await store.consent(
      tx,
      p.id,
      "SMS_MARKETING",
      "SUBSCRIBED",
      "test",
      new Date(),
    );
    return p;
  });
  await prisma.marketingMessage.createMany({
    data: Array.from({ length: 50 }, (_, i) => ({
      shop,
      key: "sms-" + i,
      profileId: p.id,
      channel: "SMS_MARKETING",
      subject: "SMS",
      content: defaultContent,
      dueAt: new Date(Date.now() - 100000),
    })),
  });
  await prisma.marketingMessage.create({
    data: {
      shop,
      key: "email-behind-sms",
      profileId: p.id,
      channel: "EMAIL",
      subject: "Queue email",
      content: defaultContent,
      dueAt: new Date(),
    },
  });
  await worker.runMarketing();
  assert.equal(sent.length, 2);
  assert.equal(
    await prisma.marketingMessage.count({
      where: {
        key: { startsWith: "sms-" },
        dueAt: { gt: new Date() },
        status: "PENDING",
      },
    }),
    50,
  );
});

test("signup session cannot confirm; inbox-only secret is single-use", async () => {
  const f = await prisma.marketingResource.findUniqueOrThrow({
    where: { shop_kind_key: { shop, kind: "FLOW", key: "welcome" } },
  });
  await prisma.marketingResource.update({
    where: { id: f.id },
    data: { enabled: true, data: { ...(f.data as object), reviewed: true } },
  });
  const signup = await import("../app/api/marketing/storefront/route");
  const confirm = await import("../app/api/marketing/confirm/route");
  const response = await signup.POST(
    new Request("https://app.example/api/marketing/storefront", {
      method: "POST",
      headers: { origin: "https://store.example" },
      body: JSON.stringify({
        action: "signup",
        email: "signup@example.com",
        emailConsent: true,
      }),
    }),
  );
  assert.equal(response.status, 200);
  const data = await response.json();
  const attempt = (token: string) =>
    confirm.POST(
      new Request("https://app.example/api/marketing/confirm?token=" + token, {
        method: "POST",
      }),
    );
  assert.equal((await attempt(data.session)).status, 400);
  const email = await prisma.marketingMessage.findUniqueOrThrow({
    where: { key: "confirmation:" + data.session },
  });
  const secret = new URL(
    (email.content as { url: string }).url,
  ).searchParams.get("token")!;
  assert.notEqual(secret, data.session);
  assert.equal((await attempt(secret)).status, 200);
  assert.equal((await attempt(secret)).status, 400);
  assert.equal(
    (
      await prisma.marketingConsent.findUniqueOrThrow({
        where: {
          profileId_channel: { profileId: email.profileId, channel: "EMAIL" },
        },
      })
    ).status,
    "SUBSCRIBED",
  );
});

test("late consent resumes an existing B2B enrollment but imports never enroll", async () => {
  customer = {
    ...customer,
    id: "gid://shopify/Customer/12",
    legacyResourceId: "12",
    email: "late@example.com",
    tags: ["b2b"],
    emailMarketingConsent: {
      marketingState: "NOT_SUBSCRIBED",
      consentUpdatedAt: new Date().toISOString(),
    },
  };
  await ingest.ingestShopify("customer.tags_added", "tag-12", {
    customerId: customer.id,
    tags: ["b2b"],
    occurredAt: new Date().toISOString(),
  });
  await worker.runMarketing();
  const p = await prisma.marketingProfile.findUniqueOrThrow({
    where: { shop_shopifyId: { shop, shopifyId: "12" } },
  });
  let message = await prisma.marketingMessage.findFirstOrThrow({
    where: { profileId: p.id },
  });
  assert.equal(message.status, "CANCELLED");
  await ingest.ingestShopify(
    "customers_email_marketing_consent/update",
    "consent-12",
    {
      customer_id: 12,
      email_address: customer.email,
      email_marketing_consent: {
        state: "subscribed",
        consent_updated_at: new Date().toISOString(),
      },
    },
  );
  message = await prisma.marketingMessage.findUniqueOrThrow({
    where: { id: message.id },
  });
  assert.equal(message.status, "PENDING");
  await worker.runMarketing();
  assert.equal(
    (
      await prisma.marketingMessage.findUniqueOrThrow({
        where: { id: message.id },
      })
    ).status,
    "SENT",
  );
  const result = await ingest.importProfiles(
    [
      {
        email: "imported@example.com",
        shopifyId: "gid://shopify/Customer/13",
        tags: ["b2b"],
        emailStatus: "SUBSCRIBED",
        emailConsentAt: new Date().toISOString(),
        emailConsentSource: "test",
      },
    ],
    false,
  );
  assert.equal(result[0].status, "IMPORTED");
  await ingest.ingestShopify(
    "customers_email_marketing_consent/update",
    "consent-13",
    {
      customer_id: 13,
      email_address: "imported@example.com",
      email_marketing_consent: {
        state: "subscribed",
        consent_updated_at: new Date().toISOString(),
      },
    },
  );
  const imported = await prisma.marketingProfile.findUniqueOrThrow({
    where: { shop_shopifyId: { shop, shopifyId: "13" } },
  });
  assert.equal(
    await prisma.marketingMessage.count({ where: { profileId: imported.id } }),
    0,
  );
});

test("ingestion gate rejects signed events and transient rows do not hide flows", async () => {
  const route = await import("../app/api/marketing/webhooks/route");
  const raw = JSON.stringify({ id: 14, email: "paused@example.com" });
  process.env.MARKETING_INGEST_ENABLED = "false";
  try {
    const response = await route.POST(
      new Request("https://app.example/api/marketing/webhooks?source=shopify", {
        method: "POST",
        body: raw,
        headers: {
          "x-shopify-shop-domain": shop,
          "x-shopify-topic": "customers/create",
          "x-shopify-event-id": "gate-test",
          "x-shopify-hmac-sha256": crypto
            .createHmac("sha256", "test-secret")
            .update(raw)
            .digest("base64"),
        },
      }),
    );
    assert.equal(response.status, 503);
  } finally {
    process.env.MARKETING_INGEST_ENABLED = "true";
  }
  assert.equal(
    await prisma.marketingWebhookInbox.count({
      where: { key: { contains: "gate-test" } },
    }),
    0,
  );
  await prisma.marketingResource.createMany({
    data: Array.from({ length: 250 }, (_, i) => ({
      shop,
      kind: "RATE",
      key: "noise-" + i,
      name: "Transient",
      data: { count: 1 },
    })),
  });
  process.env.DASHBOARD_USERNAME = "staff";
  process.env.DASHBOARD_PASSWORD = "test-password";
  const api = await import("../app/api/marketing/route");
  const response = await api.GET(
    new Request("https://app.example/api/marketing", {
      headers: {
        authorization:
          "Basic " + Buffer.from("staff:test-password").toString("base64"),
      },
    }),
  );
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(
    data.resources.filter((r: { kind: string }) => r.kind === "FLOW").length,
    5,
  );
  assert.ok(!data.resources.some((r: { kind: string }) => r.kind === "RATE"));
});

test("suppression stays sticky and cancels pending messages", async () => {
  const p = await store.atomic(async (tx) => {
    const p = await store.identify(tx, { email: "suppress@example.com" });
    await store.consent(tx, p.id, "EMAIL", "SUBSCRIBED", "test", new Date());
    return p;
  });
  await prisma.marketingMessage.create({
    data: {
      shop,
      key: "suppression",
      profileId: p.id,
      channel: "EMAIL",
      subject: "Do not send",
      content: defaultContent,
      dueAt: new Date(),
    },
  });
  await store.atomic((tx) =>
    store.consent(tx, p.id, "EMAIL", "UNSUBSCRIBED", "test", new Date()),
  );
  await store.atomic((tx) =>
    store.consent(tx, p.id, "EMAIL", "SUBSCRIBED", "import", new Date()),
  );
  assert.equal(
    (
      await prisma.marketingMessage.findUniqueOrThrow({
        where: { key: "suppression" },
      })
    ).status,
    "CANCELLED",
  );
  assert.equal(
    (
      await prisma.marketingConsent.findUniqueOrThrow({
        where: { profileId_channel: { profileId: p.id, channel: "EMAIL" } },
      })
    ).suppressed,
    true,
  );
});

test("legacy cart branches stop after a purchase or checkout expiry", async () => {
  const f = await prisma.marketingResource.findUniqueOrThrow({
    where: { shop_kind_key: { shop, kind: "FLOW", key: "abandoned-cart" } },
  });
  await prisma.marketingResource.update({
    where: { id: f.id },
    data: { enabled: true, data: { ...(f.data as object), reviewed: true } },
  });
  const p = await store.atomic(async (tx) => {
    const p = await store.identify(tx, { email: "buyer@example.com" });
    await store.consent(tx, p.id, "EMAIL", "SUBSCRIBED", "test", new Date());
    return p;
  });
  await prisma.marketingProfile.update({
    where: { id: p.id },
    data: { lastOrderAt: new Date() },
  });
  for (const [key, age] of [
    ["purchased-cart", 60000],
    ["expired-cart", 4 * 86400000],
  ] as const)
    await prisma.marketingMessage.create({
      data: {
        shop,
        key,
        profileId: p.id,
        flowKey: "abandoned-cart",
        flowCondition: "ORDER_PLACED",
        triggerAt: new Date(Date.now() - age),
        channel: "EMAIL",
        subject: "Do not send cart",
        content: defaultContent,
        dueAt: new Date(),
      },
    });
  await worker.runMarketing();
  for (const key of ["purchased-cart", "expired-cart"])
    assert.equal(
      (await prisma.marketingMessage.findUniqueOrThrow({ where: { key } }))
        .status,
      "CANCELLED",
    );
});

test("send controls are rechecked between provider requests", async () => {
  // Isolate the batch from pending fixtures such as later welcome steps.
  await prisma.marketingMessage.updateMany({
    where: { status: "PENDING" },
    data: { status: "CANCELLED" },
  });
  const p = await store.atomic(async (tx) => {
    const p = await store.identify(tx, { email: "controls@example.com" });
    await store.consent(tx, p.id, "EMAIL", "SUBSCRIBED", "test", new Date());
    return p;
  });
  for (const key of ["control-a", "control-b"])
    await prisma.marketingMessage.create({
      data: {
        shop,
        key,
        profileId: p.id,
        channel: "EMAIL",
        subject: key,
        content: defaultContent,
        dueAt: new Date(),
      },
    });
  const mockFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async (input, init) => {
    attempts++;
    process.env.MARKETING_SEND_ENABLED = "false";
    return mockFetch(input, init);
  };
  try {
    await worker.runMarketing();
    assert.equal(attempts, 1);
    assert.equal(
      await prisma.marketingMessage.count({
        where: { key: { startsWith: "control-" }, status: "PENDING" },
      }),
      1,
    );
  } finally {
    process.env.MARKETING_SEND_ENABLED = "true";
    globalThis.fetch = mockFetch;
  }
  await worker.runMarketing();
  assert.equal(
    await prisma.marketingMessage.count({
      where: { key: { startsWith: "control-" }, status: "SENT" },
    }),
    2,
  );
});

test("uncertain provider outcomes are never retried automatically", async () => {
  const p = await prisma.marketingProfile.findUniqueOrThrow({
    where: { shop_email: { shop, email: "controls@example.com" } },
  });
  await prisma.marketingMessage.create({
    data: {
      shop,
      key: "uncertain",
      profileId: p.id,
      channel: "EMAIL",
      subject: "Uncertain",
      content: defaultContent,
      dueAt: new Date(),
    },
  });
  const mockFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    throw new Error("Synthetic connection loss");
  };
  try {
    await worker.runMarketing();
    await worker.runMarketing();
    assert.equal(attempts, 1);
    assert.equal(
      (
        await prisma.marketingMessage.findUniqueOrThrow({
          where: { key: "uncertain" },
        })
      ).status,
      "UNKNOWN",
    );
  } finally {
    globalThis.fetch = mockFetch;
  }
});

test("anonymous checkout events do not block the ingestion queue", async () => {
  await inbox.queueShopify("checkouts/create", "anonymous-checkout", {
    id: 1234,
    created_at: new Date().toISOString(),
    abandoned_checkout_url: "https://store.example/cart",
  });
  await inbox.processMarketingInbox();
  assert.equal(
    (
      await prisma.marketingWebhookInbox.findUniqueOrThrow({
        where: { shop_key: { shop, key: "anonymous-checkout" } },
      })
    ).status,
    "DONE",
  );
  assert.equal(
    (
      await prisma.marketingEvent.findUniqueOrThrow({
        where: { shop_key: { shop, key: "anonymous-checkout" } },
      })
    ).type,
    "CHECKOUT_UNIDENTIFIED",
  );
});

test("marketing identity conflicts remain retryable without blocking inventory claims", async () => {
  const route = await import("../app/api/webhooks/shopify/orders-create/route");
  const raw = JSON.stringify({
    id: 900,
    customer: { id: 10, email: "changed@example.com" },
    email: "changed@example.com",
    created_at: new Date().toISOString(),
    line_items: [
      { variant_id: 700, product_id: 701, title: "Test coral", quantity: 1 },
    ],
  });
  const response = await route.POST(
    new Request("https://app.example/api/webhooks/shopify/orders-create", {
      method: "POST",
      body: raw,
      headers: {
        "x-shopify-shop-domain": shop,
        "x-shopify-hmac-sha256": crypto
          .createHmac("sha256", "test-secret")
          .update(raw)
          .digest("base64"),
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(
    await prisma.orderInventoryClaim.count({ where: { orderId: "900" } }),
    1,
  );
  await inbox.processMarketingInbox();
  const row = await prisma.marketingWebhookInbox.findUniqueOrThrow({
    where: { shop_key: { shop, key: "shopify:orders/create:900" } },
  });
  assert.equal(row.status, "PENDING");
  assert.match(row.error || "", /Identity change/);
  const result = await worker.runMarketing();
  assert.ok("skipped" in result);
});

test("repeated setup preserves saved B2B copy and uploaded artwork", async () => {
  const where = { shop_kind_key: { shop, kind: "FLOW", key: "b2b-welcome" } };
  const original = await prisma.marketingResource.findUniqueOrThrow({ where });
  const data = JSON.parse(JSON.stringify(original.data));
  data.steps[0].subject = "Custom wholesale welcome";
  data.steps[0].content.bodyHtml = "<p>Saved custom copy</p>";
  data.steps[0].content.footerTitle = "Thank you, wholesale partners";
  data.steps[0].content.footerText = "Reach our team for help.";
  data.steps[0].content.footerUnsubscribeText = "Prefer fewer emails?";
  data.steps[0].content.logo = "data:image/png;base64,aGVsbG8=";
  data.steps[0].content.footerImage = "data:image/png;base64,d29ybGQ=";
  await prisma.marketingResource.update({ where, data: { data } });
  await store.seed();
  await store.seed();
  const saved = await prisma.marketingResource.findUniqueOrThrow({ where });
  assert.deepEqual(saved.data, data);
  assert.equal(saved.enabled, original.enabled);
});

test("one-click unsubscribe suppresses email, cancels pending sends, and is repeatable", async () => {
  const p = await store.atomic(async (tx) => {
    const p = await store.identify(tx, { email: "oneclick@example.com" });
    await store.consent(tx, p.id, "EMAIL", "SUBSCRIBED", "test", new Date());
    return p;
  });
  const message = await prisma.marketingMessage.create({
    data: {
      shop,
      key: "oneclick-source",
      profileId: p.id,
      channel: "EMAIL",
      subject: "Test",
      content: defaultContent,
      dueAt: new Date(),
    },
  });
  const api = await import("../app/api/marketing/unsubscribe/route");
  const url =
    "https://app.example/api/marketing/unsubscribe?token=" + message.token;
  const request = () =>
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    });
  assert.equal((await api.POST(request())).status, 200);
  assert.equal((await api.POST(request())).status, 200);
  const resultConsent = await prisma.marketingConsent.findUniqueOrThrow({
    where: { profileId_channel: { profileId: p.id, channel: "EMAIL" } },
  });
  assert.equal(resultConsent.status, "UNSUBSCRIBED");
  assert.equal(resultConsent.suppressed, true);
  assert.equal(
    (
      await prisma.marketingMessage.findUniqueOrThrow({
        where: { id: message.id },
      })
    ).status,
    "CANCELLED",
  );
  assert.equal(
    (
      await api.POST(
        new Request(
          "https://app.example/api/marketing/unsubscribe?token=invalid",
          { method: "POST" },
        ),
      )
    ).status,
    404,
  );
  const headers = sent[0].headers as Record<string, string>;
  assert.equal(headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.match(headers["List-Unsubscribe"], /^<https:\/\//);
});

test("internal preview sends do not advertise a real unsubscribe subscription", async () => {
  process.env.MARKETING_TEST_EMAILS = "preview@example.com";
  const api = await import("../app/api/marketing/route");
  const result = await api.POST(
    new Request("https://app.example/api/marketing", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization:
          "Basic " + Buffer.from("staff:test-password").toString("base64"),
      },
      body: JSON.stringify({
        action: "test-email",
        to: "preview@example.com",
        subject: "Preview",
        content: defaultContent,
      }),
    }),
  );
  assert.equal(result.status, 200);
  assert.equal(sent.at(-1)?.headers, undefined);
  assert.match(String(sent.at(-1)?.html), /unsubscribe\?preview=1/);
  const unsubscribe = await import("../app/api/marketing/unsubscribe/route");
  const info = await unsubscribe.GET(
    new Request("https://app.example/api/marketing/unsubscribe?preview=1"),
  );
  assert.equal(info.status, 200);
  assert.match(await info.text(), /No subscription was changed/);
});

test("manual inbox action requires login, respects ingestion switch, and never sends", async () => {
  const api = await import("../app/api/marketing/route");
  process.env.DASHBOARD_USERNAME = "staff";
  process.env.DASHBOARD_PASSWORD = "test-password";
  const request = (authorized = true) =>
    new Request("https://app.example/api/marketing", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://app.example",
        ...(authorized
          ? {
              authorization:
                "Basic " +
                Buffer.from("staff:test-password").toString("base64"),
            }
          : {}),
      },
      body: JSON.stringify({ action: "process-inbox" }),
    });
  const previousIngest = process.env.MARKETING_INGEST_ENABLED;
  const beforeSent = sent.length;
  customer = {
    ...customer,
    id: "gid://shopify/Customer/990",
    legacyResourceId: "990",
    email: "manual@example.com",
    tags: [],
    emailMarketingConsent: {
      marketingState: "SUBSCRIBED",
      consentUpdatedAt: new Date().toISOString(),
    },
  };
  await inbox.queueShopify("customer.tags_removed", "manual-remove-990", {
    customerId: customer.id,
    tags: ["b2b"],
    occurredAt: new Date().toISOString(),
  });
  try {
    assert.equal((await api.POST(request(false))).status, 401);
    process.env.MARKETING_INGEST_ENABLED = "false";
    assert.equal((await api.POST(request())).status, 409);
    assert.equal(
      await prisma.marketingProfile.count({
        where: { shop, shopifyId: "990" },
      }),
      0,
    );
    process.env.MARKETING_INGEST_ENABLED = "true";
    const response = await api.POST(request());
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.ok(result.processed >= 1);
    assert.equal(typeof result.unresolved, "number");
    const profile = await prisma.marketingProfile.findUniqueOrThrow({
      where: { shop_shopifyId: { shop, shopifyId: "990" } },
      include: { consents: true },
    });
    assert.equal(profile.email, "manual@example.com");
    assert.deepEqual(profile.tags, []);
    assert.ok(
      profile.consents.some(
        (c) => c.channel === "EMAIL" && c.status === "SUBSCRIBED",
      ),
    );
    assert.equal(sent.length, beforeSent);
    assert.equal((await api.POST(request())).status, 200);
    assert.equal(sent.length, beforeSent);
  } finally {
    if (previousIngest === undefined)
      delete process.env.MARKETING_INGEST_ENABLED;
    else process.env.MARKETING_INGEST_ENABLED = previousIngest;
  }
});

test("audience directory searches all contacts, pages without duplicates, and applies consent to saved groups", async () => {
  const { audienceDirectory } = await import("../lib/marketing/audiences");
  await prisma.marketingProfile.createMany({
    data: Array.from({ length: 30 }, (_, i) => ({
      id: "audience-test-" + String(i).padStart(2, "0"),
      shop,
      name: "Directory Fixture " + i,
      email: "directory-" + i + "@example.com",
      tags: i % 2 ? [] : ["b2b"],
      createdAt: new Date(1700000000000 + i * 1000),
    })),
  });
  await prisma.marketingConsent.createMany({
    data: Array.from({ length: 29 }, (_, i) => ({
      profileId: "audience-test-" + String(i).padStart(2, "0"),
      channel: "EMAIL",
      status: i === 0 ? "UNSUBSCRIBED" : "SUBSCRIBED",
      suppressed: i === 0 || i === 2,
      source: "test",
      occurredAt: new Date(),
    })),
  });
  const url = (extra = "") =>
    new URL(
      "https://app.example/api/marketing?view=audience&q=Directory%20Fixture" +
        extra,
    );
  const first = await audienceDirectory(url());
  assert.equal(first.total, 30);
  assert.equal(first.profiles.length, 25);
  assert.ok(first.nextCursor);
  const second = await audienceDirectory(url("&cursor=" + first.nextCursor));
  assert.equal(second.profiles.length, 5);
  assert.equal(second.nextCursor, null);
  assert.equal(
    new Set([...first.profiles, ...second.profiles].map((p) => p.id)).size,
    30,
  );
  const subscribers = await audienceDirectory(url("&status=subscribed"));
  assert.equal(subscribers.total, 27);
  assert.equal((await audienceDirectory(url("&status=blocked"))).total, 2);
  assert.equal((await audienceDirectory(url("&status=unsubscribed"))).total, 1);
  assert.equal(
    (await audienceDirectory(url("&status=not-subscribed"))).total,
    1,
  );
  assert.equal((await audienceDirectory(url("&b2b=true"))).total, 15);
  const b2b = await audienceDirectory(url("&group=b2b"));
  assert.equal(b2b.total, 13);
  assert.ok(
    b2b.profiles.every(
      (p) =>
        p.tags.includes("b2b") &&
        p.consents.some(
          (c) =>
            c.channel === "EMAIL" && c.status === "SUBSCRIBED" && !c.suppressed,
        ),
    ),
  );
  await assert.rejects(
    () => audienceDirectory(url("&group=missing")),
    /no longer available/,
  );
  await assert.rejects(
    () => audienceDirectory(url("&status=invalid")),
    /valid email status/,
  );
  assert.equal(
    (
      await audienceDirectory(
        new URL(
          "https://app.example/api/marketing?view=audience&q=directory-28@example.com",
        ),
      )
    ).total,
    1,
  );
});

test("contact panel exposes readable history without delivery tokens or email artwork", async () => {
  const { contactDetails } = await import("../lib/marketing/audiences");
  const profile = await prisma.marketingProfile.findFirstOrThrow({
    where: { shop, shopifyId: "10" },
  });
  const detail = await contactDetails(profile.id);
  assert.ok(detail);
  assert.ok(detail.messages.length);
  assert.ok(detail.messages.every((m) => !("token" in m) && !("content" in m)));
  assert.ok(
    detail.events.every((e) =>
      Object.keys(e.payload).every((k) =>
        ["channel", "status", "ignored", "tags"].includes(k),
      ),
    ),
  );
  assert.equal(await contactDetails("nonexistent-contact"), null);
});

test("saving business settings preserves independently saved operational controls", async () => {
  const api = await import("../app/api/marketing/route");
  const send = (settings: unknown) =>
    api.POST(
      new Request("https://app.example/api/marketing", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization:
            "Basic " + Buffer.from("staff:test-password").toString("base64"),
          origin: "https://app.example",
        },
        body: JSON.stringify({ action: "save-settings", settings }),
      }),
    );
  const baseline = {
    sendingEnabled: false,
    ingestEnabled: true,
    migrationConfirmed: false,
    formEnabled: false,
  };
  assert.equal((await send({ operations: baseline })).status, 200);
  const business = await send({
    organizationName: "Settings Test",
    postalAddress: "100 Test Avenue",
  });
  assert.equal(business.status, 200);
  assert.deepEqual((await business.json()).settings.operations, baseline);
  const sync = await send({ operations: { ingestEnabled: false } });
  const result = await sync.json();
  assert.equal(result.settings.organizationName, "Settings Test");
  assert.equal(result.settings.postalAddress, "100 Test Avenue");
  assert.deepEqual(result.settings.operations, {
    ...baseline,
    ingestEnabled: false,
  });
});

test("manual delivery respects sending gates, sends due messages once, and preserves future schedules", async () => {
  const api = await import("../app/api/marketing/route");
  const request = (authorized = true) =>
    new Request("https://app.example/api/marketing", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://app.example",
        ...(authorized
          ? {
              authorization:
                "Basic " +
                Buffer.from("staff:test-password").toString("base64"),
            }
          : {}),
      },
      body: JSON.stringify({ action: "run-delivery" }),
    });
  assert.equal((await api.POST(request(false))).status, 401);
  // Isolate the delivery queue from earlier failure scenarios in this disposable database.
  await prisma.marketingMessage.updateMany({
    where: { status: "PENDING" },
    data: { status: "CANCELLED" },
  });
  await prisma.marketingWebhookInbox.updateMany({
    where: { status: { not: "DONE" } },
    data: { status: "DONE" },
  });
  await prisma.marketingCampaign.updateMany({
    where: { status: { in: ["SCHEDULED", "SENDING"] } },
    data: { status: "CANCELLED" },
  });
  const controls = {
    sendingEnabled: false,
    migrationConfirmed: true,
    ingestEnabled: true,
    formEnabled: false,
  };
  await prisma.marketingResource.update({
    where: { shop_kind_key: { shop, kind: "SETTINGS", key: "global" } },
    data: {
      data: {
        organizationName: "Test",
        postalAddress: "100 Test Avenue",
        operations: controls,
      },
    },
  });
  customer = {
    ...customer,
    id: "gid://shopify/Customer/991",
    legacyResourceId: "991",
    email: "manual-delivery@example.com",
    tags: ["b2b"],
    emailMarketingConsent: {
      marketingState: "SUBSCRIBED",
      consentUpdatedAt: new Date().toISOString(),
    },
  };
  await ingest.ingestShopify("customer.tags_added", "manual-delivery-tag", {
    customerId: customer.id,
    tags: ["b2b"],
    occurredAt: new Date().toISOString(),
  });
  const profile = await prisma.marketingProfile.findUniqueOrThrow({
    where: { shop_shopifyId: { shop, shopifyId: "991" } },
  });
  const due = await prisma.marketingMessage.findFirstOrThrow({
    where: { profileId: profile.id, flowKey: "b2b-welcome" },
  });
  const futureAt = new Date(Date.now() + 86400000);
  const future = await prisma.marketingMessage.create({
    data: {
      shop,
      key: "manual-delivery-future",
      profileId: profile.id,
      flowKey: "b2b-welcome",
      flowStep: 1,
      channel: "EMAIL",
      subject: "Tomorrow",
      content: store.json(defaultContent),
      dueAt: futureAt,
    },
  });
  const sentBefore = sent.length;
  const paused = await api.POST(request());
  assert.equal(paused.status, 200);
  assert.ok((await paused.json()).skipped);
  assert.equal(sent.length, sentBefore);
  await prisma.marketingResource.update({
    where: { shop_kind_key: { shop, kind: "SETTINGS", key: "global" } },
    data: {
      data: {
        organizationName: "Test",
        postalAddress: "100 Test Avenue",
        operations: { ...controls, sendingEnabled: true },
      },
    },
  });
  const delivered = await api.POST(request());
  assert.equal(delivered.status, 200);
  assert.equal((await delivered.json()).sent, 1);
  assert.equal(
    (await prisma.marketingMessage.findUniqueOrThrow({ where: { id: due.id } }))
      .status,
    "SENT",
  );
  assert.equal((await api.POST(request())).status, 200);
  assert.equal(sent.length, sentBefore + 1);
  const waiting = await prisma.marketingMessage.findUniqueOrThrow({
    where: { id: future.id },
  });
  assert.equal(waiting.status, "PENDING");
  assert.equal(waiting.dueAt.toISOString(), futureAt.toISOString());
  assert.equal(waiting.attempts, 0);
});

test("stock alerts baseline per variant, use strict threshold, deduplicate and reset after recovery", async () => {
  const { observeStock, readStock, lowStock } = await import(
    "../lib/marketing/stock"
  );
  const { defaultStockConfig } = await import("../lib/marketing/stock-config");
  const { validateFlow } = await import("../lib/marketing/flow-config");
  const stock = {
    ...defaultStockConfig,
    recipientEmail: "stock-staff@example.com",
    recipientPhone: "+16575550123",
    smsConsentConfirmed: true,
  };
  const data = validateFlow("low-stock", { reviewed: true, stock });
  const flow = await prisma.marketingResource.update({
    where: { shop_kind_key: { shop, kind: "FLOW", key: "low-stock" } },
    data: { enabled: true, data: store.json(data) },
  });
  const variant = {
    id: "gid://shopify/ProductVariant/700",
    title: "Small",
    inventoryQuantity: 5,
    inventoryItem: { tracked: true },
    product: {
      id: "gid://shopify/Product/70",
      title: "T5 coral",
      handle: "t5-coral",
    },
  };
  let clock = Date.now() - 60000;
  const observe = (quantity: number, id = variant.id) =>
    observeStock(
      stock,
      { ...variant, id, inventoryQuantity: quantity },
      new Date((clock += 1000)),
      JSON.stringify(flow.data),
    );
  assert.equal(await observe(5), 0);
  assert.equal(await observe(4), 2);
  assert.equal(await observe(3), 0);
  assert.equal(await observe(2), 0);
  assert.equal(
    await observe(3),
    0,
    "an increase that remains low does not re-alert",
  );
  assert.equal(
    await observe(0, "gid://shopify/ProductVariant/701"),
    0,
    "initial low stock is a baseline",
  );
  assert.equal(
    await observeStock(
      stock,
      { ...variant, inventoryQuantity: 4 },
      new Date(clock - 10000),
      JSON.stringify(flow.data),
    ),
    0,
    "old snapshots are ignored",
  );
  const messages = await prisma.marketingMessage.findMany({
    where: { flowKey: "low-stock" },
  });
  assert.equal(messages.length, 2);
  assert.deepEqual(messages.map((m) => m.channel).sort(), [
    "EMAIL",
    "SMS_TRANSACTIONAL",
  ]);
  assert.match((messages[0].content as { body: string }).body, /4/);
  assert.equal(
    (messages[0].content as { url: string }).url,
    "https://audit.myshopify.com/products/t5-coral",
  );
  assert.equal(await observe(5), 0);
  assert.equal(
    await prisma.marketingMessage.count({
      where: { flowKey: "low-stock", status: "CANCELLED" },
    }),
    2,
  );
  assert.equal(await observe(4), 2);
  assert.equal(await observe(4), 0);
  assert.equal(
    await prisma.marketingMessage.count({ where: { flowKey: "low-stock" } }),
    4,
  );
  assert.equal(
    await observeStock(
      stock,
      {
        ...variant,
        id: "gid://shopify/ProductVariant/702",
        inventoryItem: { tracked: false },
      },
      new Date((clock += 1000)),
      JSON.stringify(flow.data),
    ),
    0,
  );

  const previousFetch = globalThis.fetch;
  let pages = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input).includes("/graphql.json")) {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.variables.query, "collection:488202338530");
      pages++;
      return Response.json({
        data: {
          collection: {
            id: "gid://shopify/Collection/488202338530",
            title: "T5 Tank",
          },
          productVariants: {
            nodes: body.variables.after
              ? []
              : [{ ...variant, inventoryQuantity: 4 }],
            pageInfo: {
              hasNextPage: !body.variables.after,
              endCursor: body.variables.after ? null : "page2",
            },
          },
        },
      });
    }
    return previousFetch(input, init);
  };
  try {
    assert.equal((await readStock(stock)).variants.length, 1);
    assert.equal(pages, 2, "collection variants are paginated");
    // The normal worker sends the staff email without subscribing staff to marketing.
    await prisma.marketingMessage.updateMany({
      where: { flowKey: { not: "low-stock" }, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    const before = sent.length;
    await worker.runMarketing();
    assert.equal(sent.length, before + 1);
    assert.deepEqual(sent.at(-1)?.to, ["stock-staff@example.com"]);
    const staff = await prisma.marketingProfile.findFirstOrThrow({
      where: { email: stock.recipientEmail },
    });
    assert.equal(
      await prisma.marketingConsent.count({
        where: { profileId: staff.id, channel: "EMAIL" },
      }),
      0,
    );
    await new Promise((resolve) => setTimeout(resolve, 2));
    clock = Date.now() - 1000;
    assert.equal(await observe(5), 0);
    await new Promise((resolve) => setTimeout(resolve, 2));
    clock = Date.now() - 1000;
    assert.equal(await observe(4), 2);
    await store.atomic((tx) =>
      store.consent(
        tx,
        staff.id,
        "EMAIL",
        "UNSUBSCRIBED",
        "staff",
        new Date(),
        "Staff suppression",
      ),
    );
    await worker.runMarketing();
    assert.equal(
      sent.length,
      before + 1,
      "suppressed staff email must not send",
    );
    await prisma.marketingResource.update({
      where: { id: flow.id },
      data: { enabled: false },
    });
    const pageCount = pages;
    assert.ok("skipped" in (await lowStock()));
    assert.equal(pages, pageCount, "paused flow makes no Shopify requests");
  } finally {
    globalThis.fetch = previousFetch;
    await prisma.marketingResource.update({
      where: { id: flow.id },
      data: { enabled: false },
    });
    await prisma.marketingMessage.updateMany({
      where: { flowKey: "low-stock", status: "PENDING" },
      data: { status: "CANCELLED" },
    });
  }
});

test("stock checks require login, previews never enroll, and Shopify failures do not block other email", async () => {
  const api = await import("../app/api/marketing/route");
  const { defaultStockConfig } = await import("../lib/marketing/stock-config");
  const { validateFlow } = await import("../lib/marketing/flow-config");
  const stock = { ...defaultStockConfig, smsEnabled: false };
  const request = (action: string, authorized = true) =>
    new Request("https://app.example/api/marketing", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://app.example",
        ...(authorized
          ? {
              authorization:
                "Basic " +
                Buffer.from("staff:test-password").toString("base64"),
            }
          : {}),
      },
      body: JSON.stringify({ action, stock }),
    });
  assert.equal((await api.POST(request("preview-stock", false))).status, 401);
  assert.equal((await api.POST(request("check-stock", false))).status, 401);
  const beforeMessages = await prisma.marketingMessage.count();
  const beforeState = await prisma.marketingResource.count({
    where: { kind: "STOCK" },
  });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) =>
    String(input).includes("/graphql.json")
      ? Response.json({
          data: {
            collection: {
              id: "gid://shopify/Collection/488202338530",
              title: "T5 Tank",
            },
            productVariants: {
              nodes: [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        })
      : previousFetch(input, init);
  try {
    const preview = await api.POST(request("preview-stock"));
    assert.equal(preview.status, 200);
    assert.equal((await preview.json()).checked, 0);
    assert.equal(await prisma.marketingMessage.count(), beforeMessages);
    assert.equal(
      await prisma.marketingResource.count({ where: { kind: "STOCK" } }),
      beforeState,
    );
    await prisma.marketingResource.update({
      where: { shop_kind_key: { shop, kind: "FLOW", key: "low-stock" } },
      data: {
        enabled: true,
        data: store.json(validateFlow("low-stock", { reviewed: true, stock })),
      },
    });
    globalThis.fetch = async (input, init) => {
      if (String(input).includes("/graphql.json"))
        throw new Error("Shopify test outage");
      return previousFetch(input, init);
    };
    const p = await store.atomic(async (tx) => {
      const p = await store.identify(tx, {
        email: "stock-outage-independent@example.com",
      });
      await store.consent(tx, p.id, "EMAIL", "SUBSCRIBED", "test", new Date());
      return p;
    });
    await prisma.marketingMessage.create({
      data: {
        shop,
        key: "stock-outage-independent",
        profileId: p.id,
        channel: "EMAIL",
        subject: "Independent message",
        content: store.json(defaultContent),
        dueAt: new Date(),
      },
    });
    const beforeSent = sent.length;
    await worker.runMarketing();
    assert.equal(sent.length, beforeSent + 1);
    const status = await prisma.marketingResource.findUniqueOrThrow({
      where: { shop_kind_key: { shop, kind: "SYSTEM", key: "stock-check" } },
    });
    assert.match(String((status.data as { error: string }).error), /outage/);
  } finally {
    globalThis.fetch = previousFetch;
    await prisma.marketingResource.update({
      where: { shop_kind_key: { shop, kind: "FLOW", key: "low-stock" } },
      data: { enabled: false },
    });
  }
});

test("cart v1 uses sequential waits, both purchase-history branches, real coupons and duplicate protection", async () => {
  const { cartDraft } = await import("../lib/marketing/cart-config");
  const { validateFlow } = await import("../lib/marketing/flow-config");
  const { cartCoupon, cartDependency, loadCart, rankedProducts } = await import(
    "../lib/marketing/cart"
  );
  const savedFetch = globalThis.fetch;
  let latestOrder: string | null = null,
    couponCreates = 0;
  const discounts = new Map<string, { id: string; title: string }>();
  const couponInputs: Record<string, unknown>[] = [];
  globalThis.fetch = async (input, init) => {
    if (String(input).includes("/graphql.json")) {
      const b = JSON.parse(String(init?.body));
      if (b.query.includes("CartOrderCheck"))
        return Response.json({
          data: {
            orders: { nodes: latestOrder ? [{ createdAt: latestOrder }] : [] },
          },
        });
      if (b.query.includes("CartProducts"))
        return Response.json({
          data: {
            nodes: b.variables.ids.map((id: string) => ({
              id,
              title: "Cart coral",
              onlineStoreUrl: "https://coralsanonymous.com/products/coral",
              status: "ACTIVE",
              tracksInventory: true,
              totalInventory: 3,
              priceRangeV2: {
                minVariantPrice: { amount: "25.00", currencyCode: "USD" },
              },
            })),
          },
        });
      if (b.query.includes("CartCouponLookup")) {
        const d = discounts.get(b.variables.code);
        return Response.json({
          data: {
            codeDiscountNodeByCode: d
              ? { id: d.id, codeDiscount: { title: d.title } }
              : null,
          },
        });
      }
      if (b.query.includes("CartCouponCreate")) {
        couponCreates++;
        couponInputs.push(b.variables.input);
        const d = {
          id: "discount-" + couponCreates,
          title: b.variables.input.title,
        };
        discounts.set(b.variables.input.code, d);
        return Response.json({
          data: {
            discountCodeBasicCreate: { codeDiscountNode: d, userErrors: [] },
          },
        });
      }
    }
    return savedFetch(input, init);
  };
  const row = await prisma.marketingResource.findUniqueOrThrow({
    where: { shop_kind_key: { shop, kind: "FLOW", key: "abandoned-cart" } },
  });
  const original = row.data,
    originalEnabled = row.enabled;
  const f = validateFlow("abandoned-cart", cartDraft(original as never));
  f.reviewed = true;
  f.steps[0].minutes = 0;
  f.branchMinutes = 1440;
  const profiles: string[] = [];
  const make = async (n: string, sms = false) => {
    const p = await store.atomic((tx) =>
      store.identify(tx, {
        email: n + "@example.com",
        ...(sms ? { phone: "+1657555" + n.slice(-4) } : {}),
      }),
    );
    profiles.push(p.id);
    await store.atomic((tx) =>
      store.consent(tx, p.id, "EMAIL", "SUBSCRIBED", "test", new Date()),
    );
    if (sms)
      await store.atomic((tx) =>
        store.consent(
          tx,
          p.id,
          "SMS_MARKETING",
          "SUBSCRIBED",
          "test",
          new Date(),
        ),
      );
    const created = new Date(Date.now() - 60000).toISOString();
    await ingest.ingestShopify("checkouts/create", "cart-test-" + n, {
      id: n,
      token: n,
      email: n + "@example.com",
      created_at: created,
      abandoned_checkout_url: "https://coralsanonymous.com/checkouts/" + n,
      line_items: [{ product_id: "111", quantity: 1 }],
    });
    return p;
  };
  try {
    await prisma.marketingResource.update({
      where: { id: row.id },
      data: { enabled: true, data: store.json(f) },
    });
    const p = await make("cart1001");
    let messages = await prisma.marketingMessage.findMany({
      where: { profileId: p.id },
      orderBy: { dueAt: "asc" },
    });
    assert.equal(messages.length, 2, "no SMS delay for email-only subscriber");
    await ingest.ingestShopify("checkouts/update", "cart-update-1001", {
      token: "cart1001",
      email: p.email!,
      created_at: new Date(Date.now() - 60000).toISOString(),
      abandoned_checkout_url: "https://coralsanonymous.com/checkouts/cart1001",
    });
    assert.equal(
      await prisma.marketingMessage.count({ where: { profileId: p.id } }),
      2,
    );
    await worker.runMarketing();
    const first = await prisma.marketingMessage.findUniqueOrThrow({
      where: { id: messages[0].id },
    });
    assert.equal(first.status, "SENT");
    assert.equal((first.content as { products: unknown[] }).products.length, 1);
    const final = messages[1];
    await prisma.marketingMessage.update({
      where: { id: first.id },
      data: { sentAt: new Date(Date.now() - 25 * 3600000) },
    });
    await prisma.marketingMessage.update({
      where: { id: final.id },
      data: { dueAt: new Date(Date.now() - 1000) },
    });
    await worker.runMarketing();
    const last = await prisma.marketingMessage.findUniqueOrThrow({
      where: { id: final.id },
    });
    assert.equal(last.status, "SENT");
    assert.equal(last.flowCondition, "cart-v1:final-no");
    assert.match(
      (last.content as { couponCode: string }).couponCode,
      /^AC300-[A-Z2-9]{8}$/,
    );
    assert.equal(couponCreates, 1);
    assert.equal(
      await cartCoupon(last.id),
      (last.content as { couponCode: string }).couponCode,
    );
    assert.equal(couponCreates, 1, "retry reuses discount");
    assert.deepEqual(couponInputs[0].context, { all: "ALL" });
    assert.deepEqual(couponInputs[0].customerGets, {
      value: { percentage: 0.1 },
      items: { all: true },
    });
    assert.equal(couponInputs[0].usageLimit, 1);
    assert.deepEqual(couponInputs[0].combinesWith, {
      orderDiscounts: false,
      productDiscounts: false,
      shippingDiscounts: false,
    });
    assert.equal(
      new Date(String(couponInputs[0].endsAt)).getUTCFullYear(),
      new Date(String(couponInputs[0].startsAt)).getUTCFullYear() + 1,
    );

    const p2 = await make("cart1002");
    latestOrder = new Date(Date.now() - 5 * 86400000).toISOString();
    await worker.runMarketing();
    messages = await prisma.marketingMessage.findMany({
      where: { profileId: p2.id },
      orderBy: { dueAt: "asc" },
    });
    const first2 = messages.find((m) => m.flowCondition === "cart-v1:first")!;
    const final2 = messages.find((m) => m.flowCondition === "cart-v1:final")!;
    await prisma.marketingMessage.update({
      where: { id: first2.id },
      data: { sentAt: new Date(Date.now() - 25 * 3600000) },
    });
    await prisma.marketingMessage.update({
      where: { id: final2.id },
      data: { dueAt: new Date(Date.now() - 1000) },
    });
    await worker.runMarketing();
    const yes = await prisma.marketingMessage.findUniqueOrThrow({
      where: { id: final2.id },
    });
    assert.equal(yes.status, "SENT");
    assert.equal(yes.flowCondition, "cart-v1:final-yes");
    assert.equal(
      (yes.content as { couponCode?: string }).couponCode,
      undefined,
    );
    assert.equal(couponCreates, 1);

    latestOrder = null;
    const p3 = await make("cart1003", true);
    const sms = await prisma.marketingMessage.findFirstOrThrow({
      where: { profileId: p3.id, channel: "SMS_MARKETING" },
    });
    const email = await prisma.marketingMessage.findFirstOrThrow({
      where: { profileId: p3.id, flowCondition: "cart-v1:first" },
    });
    const run = await loadCart(email.key);
    assert.ok(
      await store.atomic((tx) => cartDependency(tx, email, run)),
      "email waits for the SMS branch",
    );
    latestOrder = new Date().toISOString();
    await prisma.marketingMessage.updateMany({
      where: { profileId: p3.id },
      data: { dueAt: new Date(Date.now() - 1000) },
    });
    await worker.runMarketing();
    assert.equal(
      await prisma.marketingMessage.count({
        where: { profileId: p3.id, status: "SENT" },
      }),
      0,
    );
    assert.equal(
      (
        await prisma.marketingMessage.findUniqueOrThrow({
          where: { id: sms.id },
        })
      ).status,
      "CANCELLED",
    );

    // A different checkout can re-enter immediately, but Smart Sending still skips a repeat email.
    latestOrder = null;
    await ingest.ingestShopify("checkouts/create", "cart-reentry", {
      token: "cart-second-checkout",
      email: p.email!,
      created_at: new Date(Date.now() - 1000).toISOString(),
      abandoned_checkout_url: "https://coralsanonymous.com/checkouts/second",
    });
    assert.equal(
      await prisma.marketingMessage.count({ where: { profileId: p.id } }),
      4,
    );
    await worker.runMarketing();
    const skipped = await prisma.marketingMessage.findFirstOrThrow({
      where: {
        profileId: p.id,
        flowCondition: "cart-v1:first",
        status: "CANCELLED",
      },
    });
    assert.match(skipped.error || "", /recently received/);

    // A lost mutation response does not create a second discount on retry.
    const fetchBeforeLoss = globalThis.fetch;
    let lost = true;
    globalThis.fetch = async (input, init) => {
      const response = await fetchBeforeLoss(input, init);
      if (
        lost &&
        String(input).includes("/graphql.json") &&
        String(init?.body).includes("CartCouponCreate")
      ) {
        lost = false;
        throw new Error("simulated lost response");
      }
      return response;
    };
    const beforeCreates = couponCreates;
    await assert.rejects(cartCoupon("coupon-lost-response"));
    const recovered = await cartCoupon("coupon-lost-response");
    assert.match(recovered, /^AC300-/);
    assert.equal(couponCreates, beforeCreates + 1);
    globalThis.fetch = fetchBeforeLoss;
    assert.deepEqual(
      rankedProducts(
        ["1", "2"],
        new Map([
          ["2", 5],
          ["3", 4],
        ]),
        new Map([
          ["4", 8],
          ["3", 2],
        ]),
      ),
      ["1", "2", "4", "3"],
    );
  } finally {
    globalThis.fetch = savedFetch;
    await prisma.marketingMessage.updateMany({
      where: { profileId: { in: profiles }, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    await prisma.marketingResource.update({
      where: { id: row.id },
      data: { data: store.json(original), enabled: originalEnabled },
    });
  }
});
