import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SKU_SYNC_MAPPINGS_URL,
  fetchCloudflareMappings,
  getSkuSyncMappingsUrl,
  normalizeProductVariantId,
  parseCloudflareMappings,
} from "../lib/sku-sync/mapping-source";
import {
  createSkuSyncShopifyAdapter,
  SkuSyncMutationRejectedError,
  SkuSyncRequestUncertainError,
  SKU_SYNC_UPDATE_MUTATION,
  type VariantSnapshot,
} from "../lib/sku-sync/shopify";
import { ShopifyRequestNotExecutedError } from "../lib/shopify-request-error";

const gid = (id: number) => `gid://shopify/ProductVariant/${id}`;
const sourceRow = (extra: Record<string, unknown> = {}) => ({
  id: 1, name: "Reef friend", category: "fish", active: 1,
  store_a_variant_id: gid(10), store_b_variant_id: gid(20), created_at: "2026-11-20T12:00:00Z", ...extra,
});
const node = (id = 10, sku: string | null = "FISH-1", extra: Record<string, unknown> = {}) => ({
  __typename: "ProductVariant", id: gid(id), title: "Small", sku,
  product: { id: "gid://shopify/Product/5", title: "Reef friend", onlineStoreUrl: "https://store.example/products/reef-friend" },
  ...extra,
});
const snapshot: VariantSnapshot = {
  variantId: gid(10), productId: "gid://shopify/Product/5", title: "Reef friend",
  variantTitle: "Small", sku: "FISH-1", url: "https://store.example/products/reef-friend",
};
const updateResult = (sku: string, id = gid(10)) => ({ data: {
  productVariantsBulkUpdate: { productVariants: [{ id, sku }], userErrors: [] },
} });

test("mapping import preserves active and inactive pairs and exact normalized variant IDs", () => {
  const rows = parseCloudflareMappings({ mappings: [sourceRow(), sourceRow({ id: "2", active: false, category: null, store_a_variant_id: "11", store_b_variant_id: "21" })] });
  assert.deepEqual(rows, [
    { id: "1", name: "Reef friend", category: "fish", active: true, variantAId: gid(10), variantBId: gid(20) },
    { id: "2", name: "Reef friend", category: null, active: false, variantAId: gid(11), variantBId: gid(21) },
  ]);
  assert.equal(normalizeProductVariantId("gid://shopify/ProductVariant/9007199254740993"), "gid://shopify/ProductVariant/9007199254740993");
});

test("mapping import rejects a malformed row rather than dropping it from a snapshot", () => {
  for (const change of [
    { id: 0 }, { id: 1.5 }, { id: Number.MAX_SAFE_INTEGER + 1 }, { name: " " },
    { active: "false" }, { active: null }, { category: 9 },
    { store_a_variant_id: "gid://shopify/Product/10" }, { store_b_variant_id: "" },
  ]) {
    assert.throws(() => parseCloudflareMappings({ mappings: [sourceRow({ id: 2 }), sourceRow(change)] }), /Invalid mapping at row 2/);
  }
  assert.throws(() => parseCloudflareMappings({ mappings: [sourceRow(), sourceRow()] }), /Duplicate mapping ID/);
  assert.throws(() => parseCloudflareMappings({ mappings: null }), /mappings array/);
  assert.throws(() => parseCloudflareMappings({ error: "unavailable" }), /mappings array/);
  assert.throws(() => parseCloudflareMappings([]), /mappings array/);
  assert.deepEqual(parseCloudflareMappings({ mappings: [] }), []);
});

test("mapping adapter leaves duplicate variant pairing conflicts visible to the orchestrator", () => {
  const mappings = parseCloudflareMappings({ mappings: [sourceRow(), sourceRow({ id: 2, store_b_variant_id: gid(21) })] });
  assert.equal(mappings.length, 2);
  assert.equal(mappings[0].variantAId, mappings[1].variantAId);
});

test("mapping source performs a timeout-bounded no-store GET without redirects", async () => {
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  const mappings = await fetchCloudflareMappings({
    url: DEFAULT_SKU_SYNC_MAPPINGS_URL,
    fetch: async (input, init) => {
      requests.push({ input: String(input), init });
      return Response.json({ mappings: [sourceRow()] });
    },
  });
  assert.equal(mappings.length, 1);
  assert.equal(requests[0].input, DEFAULT_SKU_SYNC_MAPPINGS_URL);
  assert.equal(requests[0].init?.method, "GET");
  assert.equal(requests[0].init?.cache, "no-store");
  assert.equal(requests[0].init?.redirect, "error");
  assert.ok(requests[0].init?.signal instanceof AbortSignal);
});

test("mapping source rejects HTTP errors, HTML and malformed JSON", async () => {
  for (const response of [
    new Response("private body should not appear", { status: 503 }),
    new Response("<html>Login</html>", { headers: { "content-type": "text/html" } }),
    new Response("{", { headers: { "content-type": "application/json" } }),
    Response.json({ mappings: [sourceRow({ active: "1" })] }),
  ]) {
    await assert.rejects(fetchCloudflareMappings({ url: DEFAULT_SKU_SYNC_MAPPINGS_URL, fetch: async () => response }), (error: Error) => {
      assert.doesNotMatch(error.message, /private body/);
      return true;
    });
  }
});

test("mapping URL configuration requires HTTPS and never exposes embedded credentials", () => {
  for (const url of ["http://example.com/mappings", "https://user:do-not-show@example.com/mappings", "https://example.com/mappings#bad", "bad-url"]) {
    assert.throws(() => getSkuSyncMappingsUrl(url), (error: Error) => {
      assert.doesNotMatch(error.message, /do-not-show/);
      return true;
    });
  }
  assert.equal(getSkuSyncMappingsUrl("https://inventory.example/secure/mappings"), "https://inventory.example/secure/mappings");
});

test("mapping source rejects oversized advertised and streamed responses", async () => {
  const advertised = new Response("{}", { headers: { "content-type": "application/json", "content-length": String(6 * 1024 * 1024) } });
  await assert.rejects(fetchCloudflareMappings({ url: DEFAULT_SKU_SYNC_MAPPINGS_URL, fetch: async () => advertised }), /too large/);
  const streamed = new Response(new Uint8Array(5 * 1024 * 1024 + 1), { headers: { "content-type": "application/json" } });
  await assert.rejects(fetchCloudflareMappings({ url: DEFAULT_SKU_SYNC_MAPPINGS_URL, fetch: async () => streamed }), /too large/);
});

test("mapping source forwards cancellation without making an unbounded background import", async () => {
  const controller = new AbortController();
  const result = fetchCloudflareMappings({
    url: DEFAULT_SKU_SYNC_MAPPINGS_URL,
    signal: controller.signal,
    fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    }),
  });
  controller.abort();
  await assert.rejects(result, /cancelled/);
});

test("already-cancelled mapping imports never start a fetch", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(fetchCloudflareMappings({
    url: DEFAULT_SKU_SYNC_MAPPINGS_URL, signal: controller.signal,
    fetch: async () => { calls++; return Response.json({ mappings: [] }); },
  }));
  assert.equal(calls, 0);
});

test("snapshot reader preserves null and blank SKUs and skips deleted variants", async () => {
  const calls: Array<{ side: string; query: string; variables: Record<string, unknown> }> = [];
  const adapter = createSkuSyncShopifyAdapter(async (side, query, variables) => {
    calls.push({ side, query, variables });
    return { data: { nodes: [node(10, null), null, node(12, ""), node(13, " MiXeD-1 ")] } };
  });
  const snapshots = await adapter.fetchVariantSnapshots("B", [gid(10), "11", gid(12), gid(13), gid(10)]);
  assert.equal(snapshots.size, 3);
  assert.equal(snapshots.get(gid(10))?.sku, "");
  assert.equal(snapshots.get(gid(12))?.sku, "");
  assert.equal(snapshots.get(gid(13))?.sku, " MiXeD-1 ");
  assert.equal(snapshots.has(gid(11)), false);
  assert.deepEqual(calls[0].variables, { ids: [gid(10), gid(11), gid(12), gid(13)] });
  assert.equal(snapshots.get(gid(10))?.title, "Reef friend");
  assert.equal(snapshots.get(gid(10))?.variantTitle, "Small");
});

test("snapshot reader batches unique IDs without mutating or fetching inventory quantities", async () => {
  const batches: number[] = [];
  const adapter = createSkuSyncShopifyAdapter(async (side, query, variables) => {
    assert.equal(side, "A");
    assert.doesNotMatch(query, /mutation|inventoryItem|quantities|price|compareAtPrice/);
    const ids = variables.ids as string[];
    batches.push(ids.length);
    return { data: { nodes: ids.map((id) => node(Number(id.split("/").at(-1)))) } };
  });
  const snapshots = await adapter.fetchVariantSnapshots("A", Array.from({ length: 101 }, (_, index) => String(index + 1)));
  assert.deepEqual(batches, [100, 1]);
  assert.equal(snapshots.size, 101);
  assert.equal((await adapter.fetchVariantSnapshots("A", [])).size, 0);
  assert.deepEqual(batches, [100, 1]);
});

test("snapshot reader rejects malformed IDs before requesting any batch", async () => {
  let calls = 0;
  const adapter = createSkuSyncShopifyAdapter(async () => { calls++; return null; });
  await assert.rejects(adapter.fetchVariantSnapshots("A", [gid(10), "gid://shopify/Product/10"]), /Invalid Shopify product variant ID/);
  assert.equal(calls, 0);
});

test("snapshot reader rejects incomplete/partial responses and unsafe product URLs", async () => {
  for (const response of [
    {}, { data: { nodes: [] } }, { data: { nodes: [node(20)] } },
    { data: { nodes: [node(10, "", { __typename: "Product" })] } },
    { data: { nodes: [node(10, undefined as unknown as null, { sku: undefined })] } },
    { data: { nodes: [node()] }, errors: [{ message: "partial response" }] },
    { data: { nodes: [node(10, "", { product: { id: "gid://shopify/Product/5", title: "Reef friend", onlineStoreUrl: "javascript:alert(1)" } })] } },
  ]) {
    const adapter = createSkuSyncShopifyAdapter(async () => response);
    await assert.rejects(adapter.fetchVariantSnapshots("A", [gid(10)]));
  }
  const adapter = createSkuSyncShopifyAdapter(async () => ({ data: { nodes: [node(10, "", { product: { id: "gid://shopify/Product/5", title: "Reef friend", onlineStoreUrl: null } })] } }));
  assert.equal((await adapter.fetchVariantSnapshots("A", [gid(10)])).get(gid(10))?.url, null);
});

test("SKU update only sends the exact one-variant SKU field using write_products mutation", async () => {
  let calls = 0;
  const adapter = createSkuSyncShopifyAdapter(async (side, query, variables) => {
    calls++;
    assert.equal(side, "B");
    assert.equal(query, SKU_SYNC_UPDATE_MUTATION);
    assert.match(query, /allowPartialUpdates: false/);
    assert.doesNotMatch(query, /inventorySet|quantities|price|tracked|requiresShipping/);
    assert.deepEqual(variables, { productId: snapshot.productId, variants: [{ id: snapshot.variantId, inventoryItem: { sku: " MiXeD-1 " } }] });
    return updateResult(" MiXeD-1 ");
  });
  await adapter.updateVariantSku("B", snapshot, " MiXeD-1 ");
  assert.equal(calls, 1);
});

test("SKU update supports an explicitly requested clear without inventing a replacement", async () => {
  const adapter = createSkuSyncShopifyAdapter(async (_side, _query, variables) => {
    assert.deepEqual(variables.variants, [{ id: snapshot.variantId, inventoryItem: { sku: "" } }]);
    return updateResult("");
  });
  await adapter.updateVariantSku("A", snapshot, "");
});

test("SKU clearing accepts Shopify's null SKU acknowledgement but not an absent field", async () => {
  const cleared = createSkuSyncShopifyAdapter(async () => ({ data: { productVariantsBulkUpdate: {
    productVariants: [{ id: snapshot.variantId, sku: null }], userErrors: [],
  } } }));
  await cleared.updateVariantSku("A", snapshot, "");
  const malformed = createSkuSyncShopifyAdapter(async () => ({ data: { productVariantsBulkUpdate: {
    productVariants: [{ id: snapshot.variantId }], userErrors: [],
  } } }));
  await assert.rejects(malformed.updateVariantSku("A", snapshot, ""), SkuSyncRequestUncertainError);
});

test("invalid mutation identifiers are known non-executions", async () => {
  let calls = 0;
  const adapter = createSkuSyncShopifyAdapter(async () => { calls++; return updateResult("new"); });
  await assert.rejects(adapter.updateVariantSku("A", { ...snapshot, productId: "invalid" }, "new"), ShopifyRequestNotExecutedError);
  await assert.rejects(adapter.updateVariantSku("A", { ...snapshot, variantId: "invalid" }, "new"), ShopifyRequestNotExecutedError);
  assert.equal(calls, 0);
});

test("SKU mutation user errors are known rejections and are never ignored", async () => {
  const adapter = createSkuSyncShopifyAdapter(async () => ({ data: { productVariantsBulkUpdate: {
    productVariants: null, userErrors: [{ field: ["variants", "0"], message: "SKU is invalid.", code: "INVALID" }],
  } } }));
  await assert.rejects(adapter.updateVariantSku("A", snapshot, "new"), (error: Error) => {
    assert.ok(error instanceof SkuSyncMutationRejectedError);
    assert.ok(error instanceof ShopifyRequestNotExecutedError);
    assert.match(error.message, /SKU is invalid/);
    return true;
  });
});

test("SKU mutation treats missing/mismatched acknowledgements as uncertain", async () => {
  for (const response of [
    {}, { data: { productVariantsBulkUpdate: { userErrors: [], productVariants: [] } } },
    updateResult("old"), updateResult("new", gid(99)),
    { ...updateResult("new"), errors: [{ message: "partial" }] },
  ]) {
    const adapter = createSkuSyncShopifyAdapter(async () => response);
    await assert.rejects(adapter.updateVariantSku("A", snapshot, "new"), SkuSyncRequestUncertainError);
  }
});

test("in-flight SKU mutation timeout is uncertain and does not auto-retry", async () => {
  let calls = 0;
  const adapter = createSkuSyncShopifyAdapter(async () => { calls++; return new Promise(() => {}); });
  await assert.rejects(adapter.updateVariantSku("A", snapshot, "new", { timeoutMs: 5 }), SkuSyncRequestUncertainError);
  assert.equal(calls, 1);
});

test("in-flight SKU cancellation stays uncertain and observes the eventual response", async () => {
  const controller = new AbortController();
  let resolveTransport!: (value: unknown) => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const adapter = createSkuSyncShopifyAdapter(async () => {
    started();
    return new Promise((resolve) => { resolveTransport = resolve; });
  });
  const pending = adapter.updateVariantSku("A", snapshot, "new", { signal: controller.signal });
  await ready;
  controller.abort();
  await assert.rejects(pending, SkuSyncRequestUncertainError);
  resolveTransport(updateResult("new"));
});

test("cancelled or expired SKU requests do not start the transport", async () => {
  let calls = 0;
  const adapter = createSkuSyncShopifyAdapter(async () => { calls++; return updateResult("new"); });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(adapter.updateVariantSku("A", snapshot, "new", { signal: controller.signal }), ShopifyRequestNotExecutedError);
  await assert.rejects(adapter.updateVariantSku("A", snapshot, "new", { deadline: Date.now() - 1 }), ShopifyRequestNotExecutedError);
  assert.equal(calls, 0);
});

test("transport failures retain their classification and are never retried by the adapter", async () => {
  for (const expected of [new Error("HTTP 503"), new ShopifyRequestNotExecutedError(new Error("authentication failed"))]) {
    let calls = 0;
    const adapter = createSkuSyncShopifyAdapter(async () => { calls++; throw expected; });
    await assert.rejects(adapter.updateVariantSku("A", snapshot, "new"), (error: unknown) => error === expected);
    assert.equal(calls, 1);
  }
});
