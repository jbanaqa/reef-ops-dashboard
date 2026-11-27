import { createHash } from "node:crypto";

// This script never edits SKUs, quantities, or unrelated webhook subscriptions.
// Run --check first. --apply writes verified shop identities and creates only
// missing shop-scoped subscriptions; it never updates or deletes subscriptions.
export const SKU_WEBHOOK_TOPIC = "INVENTORY_ITEMS_UPDATE";
export const SKU_WEBHOOK_PATH = "/api/webhooks/shopify/sku-sync";

export const SKU_WEBHOOK_IDENTITY_QUERY = `
  query SkuSyncWebhookIdentity {
    shop { myshopifyDomain }
    currentAppInstallation { accessScopes { handle } }
  }
`;

export const SKU_WEBHOOK_LIST_QUERY = `
  query SkuSyncWebhookSubscriptions($after: String) {
    webhookSubscriptions(first: 100, after: $after, topics: [INVENTORY_ITEMS_UPDATE]) {
      nodes { id topic uri format includeFields filter }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const SKU_WEBHOOK_CREATE_MUTATION = `
  mutation CreateSkuSyncWebhook($input: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: INVENTORY_ITEMS_UPDATE, webhookSubscription: $input) {
      webhookSubscription { id topic uri }
      userErrors { field message }
    }
  }
`;

type Side = "A" | "B";
type GraphqlClient = <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;
type Envelope<T> = { data?: T; errors?: unknown[] };
export type SkuWebhookShop = {
  id: string;
  sourceKey: string;
  shop: string;
  side: string;
  subscriptionId: string | null;
};
type Subscription = {
  id: string;
  topic: string;
  uri: string;
  format: string;
  includeFields: string[];
  filter: string | null;
};
type SubscriptionConnection = {
  nodes: Subscription[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
};
export type SkuWebhookOptions = { origin: string; apply: boolean };
export type SkuWebhookRegistrationDependencies = {
  sourceKey: string;
  clients: Record<Side, GraphqlClient>;
  readShops(sourceKey: string): Promise<SkuWebhookShop[]>;
  saveShop(shop: SkuWebhookShop): Promise<void>;
};

const USAGE = "Usage: tsx scripts/register-sku-sync-webhooks.ts --origin https://your-app.example [--check | --apply]";

export function parseSkuWebhookOptions(args: string[]): SkuWebhookOptions {
  let origin: string | undefined;
  let mode: "--check" | "--apply" | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--origin" && origin === undefined && args[index + 1] && !args[index + 1].startsWith("--")) {
      origin = args[++index];
    } else if ((arg === "--check" || arg === "--apply") && mode === undefined) {
      mode = arg;
    } else {
      throw new Error(USAGE);
    }
  }
  if (!origin) throw new Error(USAGE);
  let url: URL;
  try { url = new URL(origin); } catch { throw new Error("--origin must be an explicit HTTPS app origin."); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new Error("--origin must be an HTTPS origin without credentials, a path, query, or fragment.");
  return { origin: url.origin, apply: mode === "--apply" };
}

function data<T>(response: Envelope<T>, operation: string): T {
  if (!response || response.errors?.length || !response.data)
    throw new Error(`Shopify did not return a complete ${operation} response.`);
  return response.data;
}

async function canonicalShop(client: GraphqlClient, side: Side) {
  const result = data(await client<Envelope<{
    shop: { myshopifyDomain: string };
    currentAppInstallation: { accessScopes: Array<{ handle: string }> };
  }>>(SKU_WEBHOOK_IDENTITY_QUERY), "shop identity");
  const shop = result.shop?.myshopifyDomain;
  if (typeof shop !== "string" || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop))
    throw new Error(`Store ${side} did not return a valid canonical myshopify.com domain.`);
  const values = result.currentAppInstallation?.accessScopes;
  if (!Array.isArray(values) || values.some(scope => typeof scope?.handle !== "string"))
    throw new Error(`Store ${side} did not return its installed access scopes.`);
  const scopes = [...new Set(values.map(scope => scope.handle))].sort();
  // Write access also includes the corresponding read access. The webhook topic
  // accepts either inventory-read or product-read; write_inventory is not needed.
  if (!scopes.some(scope => ["read_inventory", "write_inventory", "read_products", "write_products"].includes(scope)))
    throw new Error(`Store ${side} needs read_products or read_inventory for inventory_items/update.`);
  return { side, shop, scopes };
}

async function subscriptions(client: GraphqlClient): Promise<Subscription[]> {
  const all: Subscription[] = [];
  const seenCursors = new Set<string>();
  let after: string | null = null;
  // A malformed/stuck cursor must fail closed, not create a duplicate after an
  // incomplete list. Only this app's API-created, shop-scoped results are listed.
  for (let page = 0; page < 100; page += 1) {
    const result: { webhookSubscriptions: SubscriptionConnection } = data(
      await client<Envelope<{ webhookSubscriptions: SubscriptionConnection }>>(SKU_WEBHOOK_LIST_QUERY, { after }), "webhook list");
    const connection: SubscriptionConnection = result.webhookSubscriptions;
    if (!connection || !Array.isArray(connection.nodes) || typeof connection.pageInfo?.hasNextPage !== "boolean")
      throw new Error("Shopify returned an incomplete webhook list; nothing was registered.");
    for (const item of connection.nodes) {
      if (!item || typeof item.id !== "string" || !item.id || typeof item.topic !== "string" ||
          typeof item.uri !== "string" || typeof item.format !== "string" ||
          !Array.isArray(item.includeFields) || item.includeFields.some(field => typeof field !== "string") ||
          !(item.filter === null || typeof item.filter === "string"))
        throw new Error("Shopify returned an invalid webhook subscription; nothing was registered.");
      all.push(item);
    }
    if (!connection.pageInfo.hasNextPage) return all;
    const cursor: string | null = connection.pageInfo.endCursor;
    if (typeof cursor !== "string" || !cursor || seenCursors.has(cursor))
      throw new Error("Shopify webhook pagination did not advance; nothing was registered.");
    seenCursors.add(cursor);
    after = cursor;
  }
  throw new Error("Shopify webhook list exceeded the safety limit; nothing was registered.");
}

function checkSavedIdentities(rows: SkuWebhookShop[], identities: Array<{ side: Side; shop: string }>, sourceKey: string) {
  const sides = new Set<string>();
  const shops = new Set<string>();
  for (const row of rows) {
    if (row.sourceKey !== sourceKey || !row.id || !["A", "B"].includes(row.side) || sides.has(row.side) || shops.has(row.shop))
      throw new Error("Saved SKU webhook shop identities are inconsistent; review them before registration.");
    sides.add(row.side); shops.add(row.shop);
    const identity = identities.find(value => value.side === row.side);
    if (!identity || row.shop !== identity.shop)
      throw new Error(`Store ${row.side}'s saved webhook identity differs from its verified canonical shop; review it before registration.`);
  }
}

export async function registerSkuSyncWebhooks(options: SkuWebhookOptions, deps: SkuWebhookRegistrationDependencies) {
  // Revalidate callers as well as CLI input before any provider/database access.
  const normalized = parseSkuWebhookOptions(["--origin", options.origin, options.apply ? "--apply" : "--check"]);
  if (!deps.sourceKey || typeof deps.sourceKey !== "string") throw new Error("SKU Sync namespace is missing.");
  const uri = new URL(SKU_WEBHOOK_PATH, normalized.origin).toString();
  const sides: Side[] = ["A", "B"];
  const identities = await Promise.all(sides.map(side => canonicalShop(deps.clients[side], side)));
  if (identities[0].shop === identities[1].shop)
    throw new Error("Both configured app clients resolve to the same shop; registration was stopped.");
  const saved = await deps.readShops(deps.sourceKey);
  checkSavedIdentities(saved, identities, deps.sourceKey);

  // Finish BOTH shops' read-only preflight before writing either identity or
  // creating a subscription. A failed second-shop preflight makes no changes.
  const plans = await Promise.all(identities.map(async identity => {
    const all = await subscriptions(deps.clients[identity.side]);
    const matches = all.filter(item => item.topic === SKU_WEBHOOK_TOPIC && item.uri === uri)
      .sort((left, right) => left.id.localeCompare(right.id));
    if (matches.some(item => item.format !== "JSON" || Boolean(item.filter?.trim()) ||
        (item.includeFields.length > 0 && !item.includeFields.includes("admin_graphql_api_id"))))
      throw new Error(`Store ${identity.side} has an incompatible subscription at the exact SKU callback. Review its JSON format, filter, and admin_graphql_api_id payload field; no subscriptions were changed.`);
    const existing = saved.find(row => row.side === identity.side);
    return { ...identity,
      identitySaved: Boolean(existing),
      subscriptionId: matches[0]?.id ?? null,
      duplicateSubscriptionIds: matches.slice(1).map(item => item.id),
      action: matches.length ? "already_registered" as const : "would_register" as const,
      savedId: existing?.id ?? createHash("sha256").update(JSON.stringify([deps.sourceKey, identity.side])).digest("hex"),
    };
  }));

  if (!normalized.apply) {
    return { mode: "check" as const, uri, topic: SKU_WEBHOOK_TOPIC,
      ready: plans.every(plan => plan.identitySaved && plan.subscriptionId),
      stores: plans.map(plan => ({ side: plan.side, shop: plan.shop, scopes: plan.scopes,
        identitySaved: plan.identitySaved, subscriptionId: plan.subscriptionId,
        duplicateSubscriptionIds: plan.duplicateSubscriptionIds, action: plan.action })) };
  }

  // Save both verified canonical domains first: a new webhook can arrive as soon
  // as creation succeeds, and its signature verifier needs the correct side.
  for (const plan of plans) {
    await deps.saveShop({ id: plan.savedId, sourceKey: deps.sourceKey, shop: plan.shop,
      side: plan.side, subscriptionId: plan.subscriptionId });
  }

  const stores = [];
  for (const plan of plans) {
    let subscriptionId = plan.subscriptionId;
    if (!subscriptionId) {
      let response: Envelope<{ webhookSubscriptionCreate: {
        webhookSubscription: { id: string; topic: string; uri: string } | null;
        userErrors: Array<{ field: string[] | null; message: string }>;
      } }>;
      try {
        // Full JSON payload avoids accidentally excluding admin_graphql_api_id
        // or suppressing delivery deduplication by over-restricting includeFields.
        response = await deps.clients[plan.side](SKU_WEBHOOK_CREATE_MUTATION, { input: { uri, format: "JSON" } });
      } catch {
        throw new Error(`Store ${plan.side} registration could not be confirmed. Its shop identity is saved. Run --check before retrying --apply; the webhook may already exist.`);
      }
      const payload = data(response, "webhook creation").webhookSubscriptionCreate;
      if (!payload || !Array.isArray(payload.userErrors) || payload.userErrors.length ||
          !payload.webhookSubscription || typeof payload.webhookSubscription.id !== "string" ||
          !payload.webhookSubscription.id || payload.webhookSubscription.topic !== SKU_WEBHOOK_TOPIC ||
          payload.webhookSubscription.uri !== uri)
        throw new Error(`Store ${plan.side} registration was rejected or returned an incomplete response. Its identity is saved. Inspect app permissions and run --check before retrying; no unrelated subscriptions were changed.`);
      subscriptionId = payload.webhookSubscription.id;
      await deps.saveShop({ id: plan.savedId, sourceKey: deps.sourceKey, shop: plan.shop,
        side: plan.side, subscriptionId });
    }
    stores.push({ side: plan.side, shop: plan.shop, scopes: plan.scopes, subscriptionId,
      duplicateSubscriptionIds: plan.duplicateSubscriptionIds,
      action: plan.subscriptionId ? "already_registered" as const : "registered" as const });
  }
  return { mode: "apply" as const, uri, topic: SKU_WEBHOOK_TOPIC, stores };
}

async function main() {
  if (process.argv.slice(2).some(arg => arg === "--help" || arg === "-h")) { console.log(USAGE); return; }
  const options = parseSkuWebhookOptions(process.argv.slice(2));
  const { loadEnvConfig } = await import("@next/env");
  loadEnvConfig(process.cwd());
  const [{ prisma }, { getSkuSyncNamespace, skuSyncSetupError }, { shopifyGraphql }, { macroalgaeGraphql }] = await Promise.all([
    import("../lib/prisma"), import("../lib/sku-sync/runtime"), import("../lib/shopify"), import("../lib/macroalgae-shopify"),
  ]);
  try {
    const setupError = skuSyncSetupError();
    if (setupError) throw new Error(setupError);
    const result = await registerSkuSyncWebhooks(options, {
      sourceKey: getSkuSyncNamespace(),
      clients: { A: shopifyGraphql, B: macroalgaeGraphql },
      readShops: sourceKey => prisma.skuSyncWebhookShop.findMany({ where: { sourceKey } }),
      saveShop: async row => {
        await prisma.skuSyncWebhookShop.upsert({
          where: { sourceKey_side: { sourceKey: row.sourceKey, side: row.side } },
          create: row,
          update: { shop: row.shop, subscriptionId: row.subscriptionId },
        });
      },
    });
    console.log(JSON.stringify(result, null, 2));
    if (!options.apply) console.log("Read-only check: no database rows or Shopify subscriptions were changed. Re-run with --apply only after the receiver is deployed.");
  } finally { await prisma.$disconnect(); }
}

if (typeof require !== "undefined" && require.main === module) {
  // Existing shared clients bound their main-store fetches, but a stalled second
  // provider must not leave this operational command running indefinitely.
  const watchdog = setTimeout(() => {
    console.error("SKU webhook setup exceeded its time budget. Creation may be unconfirmed; run --check before retrying --apply.");
    process.exit(1);
  }, 120_000);
  main().then(() => { clearTimeout(watchdog); }, error => {
    clearTimeout(watchdog);
    console.error(error instanceof Error ? error.message : "SKU webhook setup failed.");
    process.exitCode = 1;
  });
}
