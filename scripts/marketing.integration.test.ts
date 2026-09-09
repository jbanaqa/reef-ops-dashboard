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
  const request = (authorized = true) => new Request("https://app.example/api/marketing", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example",
      ...(authorized ? { authorization: "Basic " + Buffer.from("staff:test-password").toString("base64") } : {}),
    },
    body: JSON.stringify({ action: "process-inbox" }),
  });
  const previousIngest = process.env.MARKETING_INGEST_ENABLED;
  const beforeSent = sent.length;
  customer = { ...customer, id: "gid://shopify/Customer/990", legacyResourceId: "990", email: "manual@example.com", tags: [], emailMarketingConsent: { marketingState: "SUBSCRIBED", consentUpdatedAt: new Date().toISOString() } };
  await inbox.queueShopify("customer.tags_removed", "manual-remove-990", {
    customerId: customer.id, tags: ["b2b"], occurredAt: new Date().toISOString(),
  });
  try {
    assert.equal((await api.POST(request(false))).status, 401);
    process.env.MARKETING_INGEST_ENABLED = "false";
    assert.equal((await api.POST(request())).status, 409);
    assert.equal(await prisma.marketingProfile.count({ where: { shop, shopifyId: "990" } }), 0);
    process.env.MARKETING_INGEST_ENABLED = "true";
    const response = await api.POST(request());
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.ok(result.processed >= 1);
    assert.equal(typeof result.unresolved, "number");
    const profile = await prisma.marketingProfile.findUniqueOrThrow({ where: { shop_shopifyId: { shop, shopifyId: "990" } }, include: { consents: true } });
    assert.equal(profile.email, "manual@example.com");
    assert.deepEqual(profile.tags, []);
    assert.ok(profile.consents.some(c => c.channel === "EMAIL" && c.status === "SUBSCRIBED"));
    assert.equal(sent.length, beforeSent);
    assert.equal((await api.POST(request())).status, 200);
    assert.equal(sent.length, beforeSent);
  } finally {
    if (previousIngest === undefined) delete process.env.MARKETING_INGEST_ENABLED;
    else process.env.MARKETING_INGEST_ENABLED = previousIngest;
  }
});
