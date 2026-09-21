import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { macroalgaeGraphql } from "@/lib/macroalgae-shopify";
import { assertSpeciesLibraryShop } from "@/lib/species-library";

export const SALE_DISCOUNTS = [5, 10, 15, 20] as const;
export type SaleDiscount = (typeof SALE_DISCOUNTS)[number];
const SALE_TAG = "sale-rotator";

type Gql<T> = { data?: T; errors?: Array<{ message: string }> };
type CatalogNode = {
  id: string;
  title: string;
  handle: string;
  status: string;
  totalInventory: number | null;
  tracksInventory: boolean;
  featuredImage: { url: string } | null;
  variants: { nodes: Array<{ id: string; title: string; price: string; compareAtPrice: string | null }> };
};

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function standardPrice(price: string, compareAtPrice: string | null) {
  const current = Number(price);
  const compare = compareAtPrice ? Number(compareAtPrice) : 0;
  return money(Number.isFinite(compare) && compare > current ? compare : current);
}

function salePrice(price: number, discount: number | null) {
  return discount ? money(price * (1 - discount / 100)) : null;
}

function normalizeGid(value: string, type: "Collection" | "Product" | "ProductVariant") {
  const trimmed = value.trim();
  if (trimmed.startsWith("gid://shopify/")) return trimmed;
  if (!/^\d+$/.test(trimmed)) throw new Error(`Invalid Shopify ${type} ID.`);
  return `gid://shopify/${type}/${trimmed}`;
}

function gqlData<T>(response: Gql<T>, message: string): T {
  if (response.errors?.length || !response.data) {
    throw new Error(response.errors?.map((error) => error.message).join("; ") || message);
  }
  return response.data;
}

export async function getSaleSettings() {
  const shop = assertSpeciesLibraryShop();
  return prisma.saleRotationSettings.upsert({
    where: { shop },
    update: {},
    create: { shop },
  });
}

export async function updateSaleSettings(input: {
  saleCollectionId?: unknown;
  enabled?: unknown;
  dryRun?: unknown;
  rotationIntervalHours?: unknown;
  discountCount5?: unknown;
  discountCount10?: unknown;
  discountCount15?: unknown;
  discountCount20?: unknown;
}) {
  const current = await getSaleSettings();
  const numberField = (value: unknown, fallback: number, min: number, max: number) => {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      throw new Error(`Expected an integer between ${min} and ${max}.`);
    }
    return parsed;
  };
  const saleCollectionId = input.saleCollectionId === undefined
    ? current.saleCollectionId
    : String(input.saleCollectionId || "").trim()
      ? normalizeGid(String(input.saleCollectionId), "Collection")
      : null;

  return prisma.saleRotationSettings.update({
    where: { id: current.id },
    data: {
      saleCollectionId,
      enabled: typeof input.enabled === "boolean" ? input.enabled : current.enabled,
      dryRun: typeof input.dryRun === "boolean" ? input.dryRun : current.dryRun,
      rotationIntervalHours: numberField(input.rotationIntervalHours, current.rotationIntervalHours, 1, 720),
      discountCount5: numberField(input.discountCount5, current.discountCount5, 0, 500),
      discountCount10: numberField(input.discountCount10, current.discountCount10, 0, 500),
      discountCount15: numberField(input.discountCount15, current.discountCount15, 0, 500),
      discountCount20: numberField(input.discountCount20, current.discountCount20, 0, 500),
    },
  });
}

export async function searchSaleCatalog(search = "") {
  const shop = assertSpeciesLibraryShop();
  const response = await macroalgaeGraphql<Gql<{ products: { nodes: CatalogNode[] } }>>(`
    query SaleRotationCatalog($query: String!) {
      products(first: 50, query: $query, sortKey: TITLE) {
        nodes {
          id title handle status totalInventory tracksInventory featuredImage { url }
          variants(first: 20) { nodes { id title price compareAtPrice } }
        }
      }
    }
  `, { query: search.trim() ? search.trim() : "status:active" });
  const data = gqlData(response, "Shopify did not return a product catalog.");
  const imported = await prisma.saleRotationProduct.findMany({
    where: { shop },
    select: { shopifyProductId: true },
  });
  const importedIds = new Set(imported.map((item) => item.shopifyProductId));
  return data.products.nodes.map((product) => ({
    ...product,
    alreadyImported: importedIds.has(product.id),
    variants: product.variants.nodes.map((variant) => ({
      ...variant,
      standardPrice: standardPrice(variant.price, variant.compareAtPrice),
    })),
  }));
}

export async function importSaleProducts(items: unknown) {
  if (!Array.isArray(items) || items.length === 0) throw new Error("Select at least one Shopify product.");
  const requested = items.map((item) => {
    const value = item as Record<string, unknown>;
    const discount = Number(value.discountPercent);
    if (!SALE_DISCOUNTS.includes(discount as SaleDiscount)) throw new Error("Discount must be 5, 10, 15, or 20 percent.");
    return {
      productId: normalizeGid(String(value.shopifyProductId || ""), "Product"),
      variantId: normalizeGid(String(value.shopifyVariantId || ""), "ProductVariant"),
      discount: discount as SaleDiscount,
    };
  });
  if (new Set(requested.map((item) => item.productId)).size !== requested.length) {
    throw new Error("Import only one variant per product.");
  }

  const response = await macroalgaeGraphql<Gql<{ nodes: Array<(CatalogNode & { featuredImage: { url: string } | null }) | null> }>>(`
    query ValidateSaleProducts($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id title handle status featuredImage { url }
          variants(first: 100) { nodes { id title price compareAtPrice } }
        }
      }
    }
  `, { ids: requested.map((item) => item.productId) });
  const data = gqlData(response, "Shopify could not validate the selected products.");
  const shop = assertSpeciesLibraryShop();
  const imported = [];
  for (const request of requested) {
    const product = data.nodes.find((node) => node?.id === request.productId);
    const variant = product?.variants.nodes.find((node) => node.id === request.variantId);
    if (!product || !variant) throw new Error("A selected Shopify product or variant no longer exists.");
    if (product.status !== "ACTIVE") throw new Error(`${product.title} is not active in Shopify.`);
    imported.push(await prisma.saleRotationProduct.upsert({
      where: { shop_shopifyProductId: { shop, shopifyProductId: product.id } },
      update: {
        shopifyVariantId: variant.id,
        title: product.title,
        variantTitle: variant.title,
        handle: product.handle,
        imageUrl: product.featuredImage?.url ?? null,
        regularPrice: standardPrice(variant.price, variant.compareAtPrice),
        discountPercent: request.discount,
        twentyPercentCandidate: request.discount === 20,
        fixedInSale: request.discount === 20 ? undefined : false,
        eligibleForRotation: request.discount !== 20,
        active: true,
      },
      create: {
        shop,
        shopifyProductId: product.id,
        shopifyVariantId: variant.id,
        title: product.title,
        variantTitle: variant.title,
        handle: product.handle,
        imageUrl: product.featuredImage?.url ?? null,
        regularPrice: standardPrice(variant.price, variant.compareAtPrice),
        discountPercent: request.discount,
        twentyPercentCandidate: request.discount === 20,
        eligibleForRotation: request.discount !== 20,
      },
    }));
  }
  return imported;
}

export async function listSaleProducts() {
  const shop = assertSpeciesLibraryShop();
  const catalog: CatalogNode[] = [];
  let after: string | null = null;
  do {
    const response: Gql<{ products: { nodes: CatalogNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }> = await macroalgaeGraphql(`
      query SyncSaleProducts($after: String) {
        products(first: 100, after: $after, query: "status:active", sortKey: TITLE) {
          nodes {
            id title handle status totalInventory tracksInventory featuredImage { url }
            variants(first: 1) { nodes { id title price compareAtPrice } }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { after });
    const connection = gqlData(response, "Shopify could not synchronize the sale product pool.").products;
    catalog.push(...connection.nodes);
    after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
    if (connection.pageInfo.hasNextPage && !after) throw new Error("Shopify reported another product page without a cursor.");
  } while (after);

  const inStock = catalog.filter((product) =>
    product.status === "ACTIVE" &&
    (!product.tracksInventory || (product.totalInventory ?? 0) > 0) &&
    product.variants.nodes.length > 0,
  );
  await prisma.saleRotationProduct.updateMany({ where: { shop }, data: { active: false } });
  for (const product of inStock) {
    const variant = product.variants.nodes[0];
    await prisma.saleRotationProduct.upsert({
      where: { shop_shopifyProductId: { shop, shopifyProductId: product.id } },
      update: {
        shopifyVariantId: variant.id,
        title: product.title,
        variantTitle: variant.title,
        handle: product.handle,
        imageUrl: product.featuredImage?.url ?? null,
        regularPrice: standardPrice(variant.price, variant.compareAtPrice),
        eligibleForRotation: true,
        active: true,
      },
      create: {
        shop,
        shopifyProductId: product.id,
        shopifyVariantId: variant.id,
        title: product.title,
        variantTitle: variant.title,
        handle: product.handle,
        imageUrl: product.featuredImage?.url ?? null,
        regularPrice: standardPrice(variant.price, variant.compareAtPrice),
        eligibleForRotation: true,
        active: true,
      },
    });
  }
  return prisma.saleRotationProduct.findMany({ where: { shop }, orderBy: [{ active: "desc" }, { title: "asc" }] });
}

export async function updateSaleProduct(id: string, input: Record<string, unknown>) {
  const shop = assertSpeciesLibraryShop();
  const existing = await prisma.saleRotationProduct.findFirst({ where: { id, shop } });
  if (!existing) throw new Error("Sale product not found.");
  const discount = input.discountPercent === undefined ? existing.discountPercent : Number(input.discountPercent);
  if (discount !== null && !SALE_DISCOUNTS.includes(discount as SaleDiscount)) throw new Error("Discount must be 5, 10, 15, or 20 percent.");
  const twentyPercentCandidate = typeof input.twentyPercentCandidate === "boolean" ? input.twentyPercentCandidate : existing.twentyPercentCandidate;
  const fixedInSale = twentyPercentCandidate
    ? (typeof input.fixedInSale === "boolean" ? input.fixedInSale : existing.fixedInSale)
    : false;
  return prisma.saleRotationProduct.update({
    where: { id },
    data: {
      discountPercent: discount,
      eligibleForRotation: typeof input.eligibleForRotation === "boolean" ? input.eligibleForRotation : existing.eligibleForRotation,
      twentyPercentCandidate,
      fixedInSale: twentyPercentCandidate ? fixedInSale : false,
      active: typeof input.active === "boolean" ? input.active : existing.active,
    },
  });
}

type CollectionSnapshot = { id: string; title: string; handle: string; automated: boolean; compatible: boolean; productIds: string[] };
export async function getSaleCollectionSnapshot(): Promise<CollectionSnapshot> {
  const settings = await getSaleSettings();
  if (!settings.saleCollectionId) throw new Error("Configure the Shopify Sale collection ID first.");
  let after: string | null = null;
  let snapshot: Omit<CollectionSnapshot, "productIds"> | null = null;
  const productIds: string[] = [];
  do {
    const response: Gql<{ collection: null | { id: string; title: string; handle: string; ruleSet: null | { appliedDisjunctively: boolean; rules: Array<{ column: string; relation: string; condition: string }> }; products: { nodes: Array<{ id: string }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } }> = await macroalgaeGraphql(`
      query SaleCollection($id: ID!, $after: String) {
        collection(id: $id) {
          id title handle ruleSet { appliedDisjunctively rules { column relation condition } }
          products(first: 250, after: $after) { nodes { id } pageInfo { hasNextPage endCursor } }
        }
      }
    `, { id: settings.saleCollectionId, after });
    const collection = gqlData(response, "Shopify did not return the Sale collection.").collection;
    if (!collection) throw new Error("The configured Shopify Sale collection was not found.");
    const rules = collection.ruleSet?.rules ?? [];
    const compareAtRule = rules.some((rule) => rule.column === "VARIANT_COMPARE_AT_PRICE" && rule.relation === "GREATER_THAN" && Number(rule.condition) === 0);
    const tagRule = rules.some((rule) => (rule.column === "TAG" || rule.column === "PRODUCT_TAG") && rule.relation === "EQUALS" && rule.condition.trim().toLowerCase() === SALE_TAG);
    const compatible = !collection.ruleSet ||
      (rules.length === 1 && compareAtRule) ||
      (rules.length === 2 && compareAtRule && tagRule && !collection.ruleSet.appliedDisjunctively);
    snapshot = { id: collection.id, title: collection.title, handle: collection.handle, automated: Boolean(collection.ruleSet), compatible };
    productIds.push(...collection.products.nodes.map((product) => product.id));
    after = collection.products.pageInfo.hasNextPage ? collection.products.pageInfo.endCursor : null;
  } while (after);
  return { ...snapshot!, productIds };
}

function shuffled<T>(values: T[]) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

async function historyAwareSelection<T extends { id: string }>(products: T[], count: number) {
  const history = await prisma.saleRotationItem.groupBy({
    by: ["productId"],
    where: {
      productId: { in: products.map((product) => product.id) },
      action: { in: ["ADD", "KEEP"] },
      run: { status: "Completed" },
    },
    _max: { createdAt: true },
  });
  const lastSale = new Map(history.map((item) => [item.productId, item._max.createdAt?.getTime() ?? 0]));
  return products
    .map((product) => ({ product, lastSale: lastSale.get(product.id) ?? -1, tieBreaker: Math.random() }))
    .sort((left, right) => left.lastSale - right.lastSale || left.tieBreaker - right.tieBreaker)
    .slice(0, count)
    .map((entry) => entry.product);
}

export async function buildSaleRotationPreview() {
  const [settings, products, collection] = await Promise.all([getSaleSettings(), listSaleProducts(), getSaleCollectionSnapshot()]);
  const current = new Set(collection.productIds);
  const active = products.filter((product) => product.active);
  const selected = new Map<string, SaleDiscount>();
  const fixed = active.filter((p) => p.twentyPercentCandidate && p.fixedInSale);
  if (fixed.length > settings.discountCount20) {
    throw new Error(`There are ${fixed.length} fixed 20% products, but settings provide only ${settings.discountCount20} 20% slots.`);
  }
  fixed.forEach((product) => selected.set(product.id, 20));
  const rotatingTwentyCount = settings.discountCount20 - fixed.length;
  const rotatingTwentyPool = active.filter((p) => p.twentyPercentCandidate && !p.fixedInSale);
  if (rotatingTwentyPool.length < rotatingTwentyCount) {
    throw new Error(`The sale requires ${rotatingTwentyCount} rotating 20% products, but only ${rotatingTwentyPool.length} are available.`);
  }
  const rotatingTwenty = await historyAwareSelection(rotatingTwentyPool, rotatingTwentyCount);
  rotatingTwenty.forEach((product) => selected.set(product.id, 20));

  const standardPool = active.filter((product) => !product.twentyPercentCandidate);
  const standardCount = settings.discountCount5 + settings.discountCount10 + settings.discountCount15;
  if (standardPool.length < standardCount) {
    throw new Error(`The sale requires ${standardCount} standard products, but only ${standardPool.length} are available.`);
  }
  const randomizedStandard = shuffled(await historyAwareSelection(standardPool, standardCount));
  let offset = 0;
  for (const [discount, count] of [[5, settings.discountCount5], [10, settings.discountCount10], [15, settings.discountCount15]] as const) {
    randomizedStandard.slice(offset, offset + count).forEach((product) => selected.set(product.id, discount));
    offset += count;
  }

  const actions = products.map((product) => {
    const isCurrent = current.has(product.shopifyProductId);
    const assignedDiscountPercent = selected.get(product.id) ?? null;
    const isSelected = assignedDiscountPercent !== null;
    return {
      product,
      action: isSelected ? (isCurrent ? "KEEP" : "ADD") : (isCurrent ? "REMOVE" : "NONE"),
      assignedDiscountPercent,
      salePrice: salePrice(product.regularPrice, assignedDiscountPercent),
    };
  }).filter((item) => item.action !== "NONE");
  return {
    settings,
    collection: { ...collection, productCount: collection.productIds.length },
    selectedCount: selected.size,
    actions,
    shortages: SALE_DISCOUNTS.map((discount) => ({
      discount,
      requested: settings[`discountCount${discount}` as const],
      actual: [...selected.values()].filter((value) => value === discount).length,
      shortage: 0,
    })),
  };
}

async function productMutation(query: string, variables: Record<string, unknown>, failure: string) {
  const response = await macroalgaeGraphql<Gql<Record<string, { userErrors?: Array<{ message: string }> }>>>(query, variables);
  const data = gqlData(response, failure);
  const errors = Object.values(data).flatMap((entry) => entry?.userErrors ?? []);
  if (errors.length) throw new Error(errors.map((error) => error.message).join("; "));
}

async function assertSaleWriteReadiness(collection: CollectionSnapshot) {
  if (!collection.compatible) {
    throw new Error(`Shopify collection "${collection.title}" is not compatible with Sale Rotation.`);
  }
  const response = await macroalgaeGraphql<Gql<{
    currentAppInstallation: { accessScopes: Array<{ handle: string }> };
    __type: { fields: Array<{ name: string }> } | null;
  }>>(`
    query SaleRotationWriteReadiness {
      currentAppInstallation { accessScopes { handle } }
      __type(name: "Mutation") { fields { name } }
    }
  `);
  const data = gqlData(response, "Shopify write readiness could not be verified.");
  const scopes = new Set(data.currentAppInstallation.accessScopes.map((scope) => scope.handle));
  const mutations = new Set(data.__type?.fields.map((field) => field.name) ?? []);
  const missing: string[] = [];
  if (!scopes.has("read_products")) missing.push("read_products scope");
  if (!scopes.has("write_products")) missing.push("write_products scope");
  if (!mutations.has("productVariantsBulkUpdate")) missing.push("productVariantsBulkUpdate mutation");
  if (!mutations.has("collectionUpdate")) missing.push("collectionUpdate mutation");
  if (missing.length) throw new Error(`Shopify write readiness failed: missing ${missing.join(", ")}.`);
}

async function applyMembership(collection: CollectionSnapshot, add: string[], remove: string[], selected = add) {
  if (!collection.compatible) {
    throw new Error(`Shopify collection "${collection.title}" is not compatible with Sale Rotation. Use a manual collection, or an automated collection with compare-at price greater than 0 and an optional ${SALE_TAG} tag rule.`);
  }
  if (collection.automated) {
    for (const productId of selected) await productMutation(`mutation($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { message } } }`, { id: productId, tags: [SALE_TAG] }, "Could not tag a sale product.");
    for (const productId of remove) await productMutation(`mutation($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { message } } }`, { id: productId, tags: [SALE_TAG] }, "Could not remove a sale product tag.");
    return;
  }
  if (add.length) await productMutation(`mutation($id: ID!, $products: [ID!]!) { collectionAddProducts(id: $id, productIds: $products) { userErrors { message } } }`, { id: collection.id, products: add }, "Could not add products to the Sale collection.");
  if (remove.length) await productMutation(`mutation($id: ID!, $products: [ID!]!) { collectionRemoveProducts(id: $id, productIds: $products) { userErrors { message } } }`, { id: collection.id, products: remove }, "Could not remove products from the Sale collection.");
}

type ExplicitSelectionSnapshot = { sourceId: string; productIds: string[] };

async function getExplicitSelectionSnapshot(collection: CollectionSnapshot): Promise<ExplicitSelectionSnapshot | null> {
  if (!collection.automated) return null;
  const response = await macroalgaeGraphql<Gql<{ collection: null | { sources: Array<{
    __typename: string;
    id: string;
    inclusion?: {
      conditions: Array<{ __typename: string }>;
      selections: { nodes: Array<{ product: { id: string } }>; pageInfo: { hasNextPage: boolean } };
    };
  }> } }>>(`
    query SaleRotationExplicitSelections($id: ID!) {
      collection(id: $id) {
        sources {
          __typename id
          ... on CollectionConditionsSource {
            inclusion {
              conditions { __typename }
              selections(first: 250) { nodes { product { id } } pageInfo { hasNextPage } }
            }
          }
        }
      }
    }
  `, { id: collection.id });
  const sources = gqlData(response, "Shopify could not inspect explicit Sale collection selections.").collection?.sources ?? [];
  const matching = sources.filter((source) => {
    if (source.__typename !== "CollectionConditionsSource" || !source.inclusion) return false;
    const types = new Set(source.inclusion.conditions.map((condition) => condition.__typename));
    return types.has("CollectionSourceInclusionConditionVariantCompareAtPrice") && types.has("CollectionSourceInclusionConditionProductTag");
  });
  if (!matching.length) return null;
  if (matching.length !== 1) throw new Error(`Expected one Sale Rotator condition source, but found ${matching.length}.`);
  const source = matching[0];
  if (!source.inclusion) return null;
  if (source.inclusion.selections.pageInfo.hasNextPage) throw new Error("The Sale collection has more than 250 explicit selections; cleanup stopped for safety.");
  return { sourceId: source.id, productIds: [...new Set(source.inclusion.selections.nodes.map((item) => item.product.id))] };
}

async function updateExplicitSelections(collectionId: string, sourceId: string, input: { add?: string[]; remove?: string[] }) {
  const add = [...new Set(input.add ?? [])];
  const addSet = new Set(add);
  const remove = [...new Set(input.remove ?? [])].filter((id) => !addSet.has(id));
  if (!add.length && !remove.length) return;
  const inclusion: Record<string, unknown> = {};
  if (add.length) inclusion.selectionsToAdd = add.map((productId) => ({ productId }));
  if (remove.length) inclusion.selectionsToRemove = remove.map((productId) => ({ productId }));
  await productMutation(`
    mutation UpdateSaleSelections($collection: CollectionUpdateInput!) {
      collectionUpdate(collection: $collection) { userErrors { message } }
    }
  `, { collection: { id: collectionId, sourcesToUpdate: [{ condition: { id: sourceId, inclusion } }] } }, "Could not update explicit Sale collection selections.");
}

async function waitForCollectionMembership(add: string[], remove: string[]) {
  let snapshot = await getSaleCollectionSnapshot();
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const ids = new Set(snapshot.productIds);
    const complete = add.every((id) => ids.has(id)) && remove.every((id) => !ids.has(id));
    if (complete || attempt === 6) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    snapshot = await getSaleCollectionSnapshot();
  }
  return snapshot;
}

async function waitForShopifyJob(jobId: string) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const response = await macroalgaeGraphql<Gql<{ job: { id: string; done: boolean } | null }>>(`
      query SaleRotationJob($id: ID!) { job(id: $id) { id done } }
    `, { id: jobId });
    const job = gqlData(response, "Shopify did not return collection reorder status.").job;
    if (!job) throw new Error(`Shopify job ${jobId} could not be read.`);
    if (job.done) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Shopify job ${jobId} did not finish within 30 seconds.`);
}

async function shuffleSaleCollection(collection: CollectionSnapshot, pinnedProductIds: string[]) {
  const uniqueIds = [...new Set(collection.productIds)];
  if (uniqueIds.length < 2) return 0;
  const collectionSet = new Set(uniqueIds);
  const pinned = [...new Set(pinnedProductIds)].filter((id) => collectionSet.has(id));
  const pinnedSet = new Set(pinned);
  const shuffleable = uniqueIds.filter((id) => !pinnedSet.has(id));
  const firstRowSize = Math.min(6, Math.floor(shuffleable.length / 2));
  const previousFirstRow = shuffleable.slice(0, firstRowSize);
  const lowerProducts = shuffled(shuffleable.slice(firstRowSize));
  const order = [
    ...pinned,
    ...lowerProducts.slice(0, firstRowSize),
    ...shuffled([...lowerProducts.slice(firstRowSize), ...previousFirstRow]),
  ];
  const response = await macroalgaeGraphql<Gql<{ collectionReorderProducts: { job: { id: string; done: boolean } | null; userErrors: Array<{ message: string }> } }>>(`
    mutation ReorderSaleCollection($id: ID!, $moves: [MoveInput!]!) {
      collectionReorderProducts(id: $id, moves: $moves) { job { id done } userErrors { message } }
    }
  `, { id: collection.id, moves: order.map((id, newPosition) => ({ id, newPosition: String(newPosition) })) });
  const result = gqlData(response, "Shopify did not accept the Sale collection reorder.").collectionReorderProducts;
  if (result.userErrors.length) throw new Error(result.userErrors.map((error) => error.message).join("; "));
  if (result.job && !result.job.done) await waitForShopifyJob(result.job.id);
  return order.length;
}

type PriceSnapshot = { productId: string; variantId: string; price: string; compareAtPrice: string | null; hadSaleTag: boolean };

async function writePrices(actions: Awaited<ReturnType<typeof buildSaleRotationPreview>>["actions"], snapshots: PriceSnapshot[]) {
  for (const item of actions) {
    const onSale = item.assignedDiscountPercent !== null;
    const variants = snapshots.filter((snapshot) => snapshot.productId === item.product.shopifyProductId);
    if (!variants.length) throw new Error(`Shopify returned no variants for ${item.product.title}.`);
    await productMutation(`
      mutation UpdateSaleVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { message } }
      }
    `, {
      productId: item.product.shopifyProductId,
      variants: variants.map((variant) => {
        const regularPrice = standardPrice(variant.price, variant.compareAtPrice);
        return {
          id: variant.variantId,
          price: String(onSale ? salePrice(regularPrice, item.assignedDiscountPercent)! : regularPrice),
          compareAtPrice: onSale ? String(regularPrice) : null,
        };
      }),
    }, `Could not update ${item.product.title}.`);
  }
}

async function capturePrices(actions: Awaited<ReturnType<typeof buildSaleRotationPreview>>["actions"]): Promise<PriceSnapshot[]> {
  const response = await macroalgaeGraphql<Gql<{ nodes: Array<null | { id: string; tags: string[]; variants: { nodes: Array<{ id: string; price: string; compareAtPrice: string | null }> } }> }>>(`
    query CaptureSalePrices($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product { id tags variants(first: 250) { nodes { id price compareAtPrice } } }
      }
    }
  `, { ids: actions.map((item) => item.product.shopifyProductId) });
  return gqlData(response, "Shopify could not capture current prices before rotation.").nodes
    .filter((node): node is NonNullable<typeof node> => Boolean(node))
    .flatMap((node) => node.variants.nodes.map((variant) => ({
      productId: node.id,
      variantId: variant.id,
      price: variant.price,
      compareAtPrice: variant.compareAtPrice,
      hadSaleTag: node.tags.some((tag) => tag.toLowerCase() === SALE_TAG),
    })));
}

async function restorePrices(snapshots: PriceSnapshot[]) {
  for (const snapshot of snapshots) {
    await productMutation(`
      mutation RestoreSaleVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { message } }
      }
    `, { productId: snapshot.productId, variants: [{ id: snapshot.variantId, price: snapshot.price, compareAtPrice: snapshot.compareAtPrice }] }, "Could not restore a Shopify price after a failed rotation.");
  }
}

async function restoreTags(snapshots: PriceSnapshot[]) {
  const states = new Map<string, boolean>();
  snapshots.forEach((snapshot) => states.set(snapshot.productId, snapshot.hadSaleTag));
  for (const [productId, hadSaleTag] of states) {
    const field = hadSaleTag ? "tagsAdd" : "tagsRemove";
    await productMutation(`mutation($id: ID!, $tags: [String!]!) { update: ${field}(id: $id, tags: $tags) { userErrors { message } } }`, { id: productId, tags: [SALE_TAG] }, "Could not restore Sale Rotator tags.");
  }
}

export async function runSaleRotation(triggerType: "Manual" | "Scheduled" = "Manual") {
  const settings = await getSaleSettings();
  const lockToken = randomUUID();
  const now = new Date();
  const locked = await prisma.saleRotationSettings.updateMany({
    where: { id: settings.id, OR: [{ lockExpiresAt: null }, { lockExpiresAt: { lt: now } }] },
    data: { lockToken, lockExpiresAt: new Date(now.getTime() + 30 * 60_000) },
  });
  if (!locked.count) throw new Error("Another sale rotation is already running.");
  const run = await prisma.saleRotationRun.create({ data: { shop: settings.shop, triggerType, dryRun: settings.dryRun } });
  let preview: Awaited<ReturnType<typeof buildSaleRotationPreview>> | null = null;
  let priceSnapshots: PriceSnapshot[] = [];
  let explicitSelections: ExplicitSelectionSnapshot | null = null;
  try {
    preview = await buildSaleRotationPreview();
    await prisma.saleRotationItem.createMany({ data: preview.actions.map((item) => ({
      runId: run.id,
      productId: item.product.id,
      action: item.action,
      assignedDiscountPercent: item.assignedDiscountPercent,
      regularPrice: item.product.regularPrice,
      salePrice: item.salePrice,
    })) });
    if (!settings.dryRun) {
      await assertSaleWriteReadiness(preview.collection);
      priceSnapshots = await capturePrices(preview.actions);
      explicitSelections = await getExplicitSelectionSnapshot(preview.collection);
      await writePrices(preview.actions, priceSnapshots);
      const productsToAdd = preview.actions.filter((item) => item.action === "ADD").map((item) => item.product.shopifyProductId);
      const productsToRemove = preview.actions.filter((item) => item.action === "REMOVE").map((item) => item.product.shopifyProductId);
      const selectedProducts = preview.actions.filter((item) => item.assignedDiscountPercent !== null).map((item) => item.product.shopifyProductId);
      await applyMembership(
        preview.collection,
        productsToAdd,
        productsToRemove,
        selectedProducts,
      );
      if (explicitSelections?.productIds.length) {
        await updateExplicitSelections(preview.collection.id, explicitSelections.sourceId, { remove: explicitSelections.productIds });
      }
      const finalCollection = await waitForCollectionMembership(productsToAdd, productsToRemove);
      const pinnedTwenty = preview.actions
        .filter((item) => item.assignedDiscountPercent === 20)
        .map((item) => item.product.shopifyProductId);
      try {
        await shuffleSaleCollection(finalCollection, pinnedTwenty);
      } catch (error) {
        console.warn("Sale rotation pricing completed, but collection ordering could not be shuffled:", error);
      }
    }
    const message = settings.dryRun ? "Dry run completed; Shopify was not changed." : "Sale rotation completed successfully.";
    const finishRun = prisma.saleRotationRun.update({ where: { id: run.id }, data: { status: settings.dryRun ? "Dry Run" : "Completed", message, completedAt: new Date() } });
    if (triggerType === "Scheduled") {
      await prisma.$transaction([
        finishRun,
        prisma.saleRotationSettings.update({ where: { id: settings.id }, data: { lastRotatedAt: new Date() } }),
      ]);
    } else {
      await finishRun;
    }
    return { runId: run.id, executed: !settings.dryRun, message, preview };
  } catch (error) {
    let message = error instanceof Error ? error.message : "Sale rotation failed.";
    if (!settings.dryRun && preview) {
      try {
        await restorePrices(priceSnapshots);
        if (preview.collection.automated) await restoreTags(priceSnapshots);
        else await applyMembership(
            preview.collection,
            preview.actions.filter((item) => item.action === "REMOVE").map((item) => item.product.shopifyProductId),
            preview.actions.filter((item) => item.action === "ADD").map((item) => item.product.shopifyProductId),
          );
        if (explicitSelections) {
          await updateExplicitSelections(preview.collection.id, explicitSelections.sourceId, { add: explicitSelections.productIds });
        }
        message += " Shopify prices and collection membership were restored.";
      } catch (recoveryError) {
        message += ` Automatic recovery also failed: ${recoveryError instanceof Error ? recoveryError.message : "unknown recovery error"}`;
      }
    }
    await prisma.saleRotationRun.update({ where: { id: run.id }, data: { status: "Failed", message, completedAt: new Date() } });
    throw error;
  } finally {
    await prisma.saleRotationSettings.updateMany({ where: { id: settings.id, lockToken }, data: { lockToken: null, lockExpiresAt: null } });
  }
}

export async function getSaleRotationStatus() {
  const [settings, runs] = await Promise.all([
    getSaleSettings(),
    prisma.saleRotationRun.findMany({ where: { shop: assertSpeciesLibraryShop() }, orderBy: { startedAt: "desc" }, take: 20, include: { _count: { select: { items: true } } } }),
  ]);
  return { settings, runs };
}

export async function runScheduledSaleRotation() {
  const settings = await getSaleSettings();
  if (!settings.enabled || !settings.saleCollectionId) return { skipped: true, reason: "Sale rotation automation is disabled or unconfigured." };
  const dueAt = settings.lastRotatedAt ? new Date(settings.lastRotatedAt.getTime() + settings.rotationIntervalHours * 3_600_000) : new Date(0);
  if (dueAt > new Date()) return { skipped: true, reason: `Next rotation is due ${dueAt.toISOString()}.` };
  return runSaleRotation("Scheduled");
}
