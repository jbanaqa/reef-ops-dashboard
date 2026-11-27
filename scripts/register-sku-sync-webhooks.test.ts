import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSkuWebhookOptions, registerSkuSyncWebhooks, SKU_WEBHOOK_CREATE_MUTATION,
  SKU_WEBHOOK_IDENTITY_QUERY, SKU_WEBHOOK_LIST_QUERY, SKU_WEBHOOK_TOPIC,
  type SkuWebhookRegistrationDependencies, type SkuWebhookShop,
} from "./register-sku-sync-webhooks";

const options = { origin: "https://reef-ops.example", apply: false };
const uri = `${options.origin}/api/webhooks/shopify/sku-sync`;
type Subscription = { id: string; topic: string; uri: string; format: string; includeFields: string[]; filter: string | null };
const subscription = (id = "gid://shopify/WebhookSubscription/1"): Subscription =>
  ({ id, topic: SKU_WEBHOOK_TOPIC, uri, format: "JSON", includeFields: [], filter: null });

function fixture() {
  const calls: string[] = [];
  const rows: SkuWebhookShop[] = [];
  const domains = { A: "coralsanonymous.myshopify.com", B: "coralsanonymouswholesale.myshopify.com" };
  const scopes = { A: ["read_products", "write_products"], B: ["read_inventory"] };
  const pages: Record<"A" | "B", Subscription[][]> = { A: [[]], B: [[]] };
  const created = { A: [] as Subscription[], B: [] as Subscription[] };
  const failList = { A: false, B: false };
  const creation = { A: "ok", B: "ok" };
  const client = (side: "A" | "B"): SkuWebhookRegistrationDependencies["clients"]["A"] => async <T>(query: string, variables?: Record<string, unknown>) => {
    if (query === SKU_WEBHOOK_IDENTITY_QUERY) {
      calls.push(`identity:${side}`);
      return { data: { shop: { myshopifyDomain: domains[side] },
        currentAppInstallation: { accessScopes: scopes[side].map(handle => ({ handle })) } } } as T;
    }
    if (query === SKU_WEBHOOK_LIST_QUERY) {
      calls.push(`list:${side}:${variables?.after ?? "first"}`);
      if (failList[side]) throw new Error("mock list failure");
      const index = variables?.after ? Number(String(variables.after).split("-")[1]) : 0;
      const nodes = pages[side][index].concat(index === 0 ? created[side] : []);
      const hasNextPage = index + 1 < pages[side].length;
      return { data: { webhookSubscriptions: { nodes,
        pageInfo: { hasNextPage, endCursor: hasNextPage ? `page-${index + 1}` : null } } } } as T;
    }
    assert.equal(query, SKU_WEBHOOK_CREATE_MUTATION, "No other mutations are allowed");
    assert.deepEqual(variables, { input: { uri, format: "JSON" } });
    assert.equal(rows.length, 2, "Both canonical identities must be persisted before creation");
    calls.push(`create:${side}`);
    if (creation[side] === "uncertain") throw new Error("mock network failure");
    if (creation[side] === "rejected") return { data: { webhookSubscriptionCreate: {
      webhookSubscription: null, userErrors: [{ field: ["webhookSubscription"], message: "mock rejection" }],
    } } } as T;
    const item = subscription(`gid://shopify/WebhookSubscription/${side}`);
    created[side].push(item);
    return { data: { webhookSubscriptionCreate: { webhookSubscription: item, userErrors: [] } } } as T;
  };
  const deps: SkuWebhookRegistrationDependencies = {
    sourceKey: "namespace-for-tests", clients: { A: client("A"), B: client("B") },
    readShops: async sourceKey => { assert.equal(sourceKey, deps.sourceKey); calls.push("read-identities"); return rows.map(row => ({ ...row })); },
    saveShop: async row => {
      calls.push(`save:${row.side}:${row.subscriptionId ?? "null"}`);
      const index = rows.findIndex(saved => saved.sourceKey === row.sourceKey && saved.side === row.side);
      if (index < 0) rows.push({ ...row }); else rows[index] = { ...row };
    },
  };
  return { deps, calls, rows, domains, scopes, pages, created, creation, failList };
}

test("CLI defaults to read-only and requires a clean explicit HTTPS origin", () => {
  assert.deepEqual(parseSkuWebhookOptions(["--origin", "https://reef-ops.example/"]), options);
  assert.deepEqual(parseSkuWebhookOptions(["--origin", options.origin, "--check"]), options);
  assert.equal(parseSkuWebhookOptions(["--apply", "--origin", options.origin]).apply, true);
  for (const origin of ["http://reef-ops.example", "https://name:password@reef-ops.example", "https://reef-ops.example/path", "https://reef-ops.example/?key=bad", "https://reef-ops.example/#fragment", "not-a-url"])
    assert.throws(() => parseSkuWebhookOptions(["--origin", origin]));
  for (const args of [[], ["--apply"], ["--origin"], ["--origin", options.origin, "--apply", "--check"], ["--origin", options.origin, "--unknown"], ["--origin", options.origin, "--origin", options.origin]])
    assert.throws(() => parseSkuWebhookOptions(args));
});

test("check discovers canonical domains and plans missing webhooks without any writes", async () => {
  const f = fixture();
  const result = await registerSkuSyncWebhooks(options, f.deps);
  assert.equal(result.mode, "check");
  assert.equal("ready" in result && result.ready, false);
  assert.deepEqual(result.stores.map(store => store.shop), Object.values(f.domains));
  assert.deepEqual(result.stores.map(store => store.action), ["would_register", "would_register"]);
  assert.equal(f.rows.length, 0);
  assert.equal(f.calls.some(call => call.startsWith("save:") || call.startsWith("create:")), false);
});

test("apply saves both identities before registering only the exact topic/callback", async () => {
  const f = fixture();
  f.pages.A = [[{ ...subscription("unrelated"), topic: "PRODUCTS_UPDATE" }, { ...subscription("different-uri"), uri: "https://other.example/webhook" }]];
  const result = await registerSkuSyncWebhooks({ ...options, apply: true }, f.deps);
  assert.deepEqual(result.stores.map(store => store.action), ["registered", "registered"]);
  assert.equal(f.rows.length, 2);
  const firstCreate = f.calls.findIndex(call => call.startsWith("create:"));
  assert.ok(f.calls.indexOf("save:A:null") < firstCreate);
  assert.ok(f.calls.indexOf("save:B:null") < firstCreate);
  assert.ok(f.rows.every(row => row.subscriptionId && /^[a-f0-9]{64}$/.test(row.id)));
});

test("a second apply reuses existing subscriptions and preserves saved row IDs", async () => {
  const f = fixture();
  await registerSkuSyncWebhooks({ ...options, apply: true }, f.deps);
  f.rows[0].id = "legacy-identity-id";
  f.calls.length = 0;
  const result = await registerSkuSyncWebhooks({ ...options, apply: true }, f.deps);
  assert.deepEqual(result.stores.map(store => store.action), ["already_registered", "already_registered"]);
  assert.equal(f.rows[0].id, "legacy-identity-id");
  assert.equal(f.calls.some(call => call.startsWith("create:")), false);
  const checked = await registerSkuSyncWebhooks(options, f.deps);
  assert.equal("ready" in checked && checked.ready, true);
});

test("pagination finds later exact matches and reports duplicates without creating more", async () => {
  const f = fixture();
  f.pages.A = [[{ ...subscription("other"), uri: "https://other.example/webhook" }], [subscription("exact-1"), subscription("exact-2")]];
  f.pages.B = [[subscription("exact-b")]];
  const result = await registerSkuSyncWebhooks({ ...options, apply: true }, f.deps);
  assert.deepEqual(result.stores[0].duplicateSubscriptionIds, ["exact-2"]);
  assert.equal(f.calls.includes("list:A:page-1"), true);
  assert.equal(f.calls.some(call => call.startsWith("create:")), false);
});

test("a failed second-store preflight never writes either identity or subscription", async () => {
  const f = fixture();
  f.failList.B = true;
  await assert.rejects(registerSkuSyncWebhooks({ ...options, apply: true }, f.deps), /mock list failure/);
  assert.equal(f.rows.length, 0);
  assert.equal(f.calls.some(call => call.startsWith("create:")), false);
});

test("same canonical shop or conflicting saved identity stops registration", async () => {
  const f = fixture();
  f.domains.B = f.domains.A;
  await assert.rejects(registerSkuSyncWebhooks({ ...options, apply: true }, f.deps), /same shop/);
  assert.equal(f.rows.length, 0);
  const other = fixture();
  other.rows.push({ id: "saved-id", sourceKey: other.deps.sourceKey, side: "B", shop: "wrong.myshopify.com", subscriptionId: null });
  await assert.rejects(registerSkuSyncWebhooks({ ...options, apply: true }, other.deps), /saved webhook identity differs/);
  assert.equal(other.calls.some(call => call.startsWith("save:")), false);
});

test("topic accepts existing product-read or inventory-read scopes and rejects missing access", async () => {
  const f = fixture();
  f.scopes.A = ["write_products"];
  await registerSkuSyncWebhooks(options, f.deps);
  f.scopes.B = ["read_orders"];
  await assert.rejects(registerSkuSyncWebhooks({ ...options, apply: true }, f.deps), /needs read_products or read_inventory/);
  assert.equal(f.rows.length, 0);
});

test("incompatible exact callback subscription fails closed instead of updating it or duplicating it", async () => {
  for (const change of [{ format: "XML" }, { filter: "sku:limited" }, { includeFields: ["sku"] }, { includeFields: ["id", "sku", "updated_at"] }]) {
    const f = fixture();
    f.pages.A = [[{ ...subscription(), ...change }]];
    await assert.rejects(registerSkuSyncWebhooks({ ...options, apply: true }, f.deps), /incompatible subscription/);
    assert.equal(f.rows.length, 0);
    assert.equal(f.calls.some(call => call.startsWith("create:")), false);
  }
});

test("a JSON subscription including the exact GraphQL id can be reused without requesting broader payloads", async () => {
  const f = fixture();
  f.pages.A = [[{ ...subscription(), includeFields: ["admin_graphql_api_id", "sku", "updated_at"] }]];
  const result = await registerSkuSyncWebhooks(options, f.deps);
  assert.equal(result.stores[0].action, "already_registered");
});

test("rejected or uncertain creation leaves identities saved and is never blindly retried", async () => {
  for (const outcome of ["rejected", "uncertain"]) {
    const f = fixture();
    f.creation.A = outcome;
    await assert.rejects(registerSkuSyncWebhooks({ ...options, apply: true }, f.deps), /identity is saved|identity is saved|identities|identity|shop identity/);
    assert.equal(f.rows.length, 2);
    assert.equal(f.calls.filter(call => call.startsWith("create:")).length, 1);
  }
});

test("malformed or nonadvancing pagination never falls through to creation", async () => {
  const f = fixture();
  f.deps.clients.A = async <T>(query: string) => {
    if (query === SKU_WEBHOOK_IDENTITY_QUERY) return { data: { shop: { myshopifyDomain: f.domains.A },
      currentAppInstallation: { accessScopes: [{ handle: "read_products" }] } } } as T;
    return { data: { webhookSubscriptions: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "same-cursor" } } } } as T;
  };
  await assert.rejects(registerSkuSyncWebhooks({ ...options, apply: true }, f.deps), /pagination did not advance/);
  assert.equal(f.rows.length, 0);
});
