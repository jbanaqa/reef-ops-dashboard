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
          id title handle status featuredImage { url }
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
  const products = await prisma.saleRotationProduct.findMany({ where: { shop }, orderBy: [{ active: "desc" }, { title: "asc" }] });
  if (!products.length) return products;
  const response = await macroalgaeGraphql<Gql<{ nodes: Array<CatalogNode | null> }>>(`
    query RefreshSaleProducts($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id title handle status featuredImage { url }
          variants(first: 100) { nodes { id title price compareAtPrice } }
        }
      }
    }
  `, { ids: products.map((product) => product.shopifyProductId) });
  const nodes = gqlData(response, "Shopify could not refresh the sale product pool.").nodes;
  const refreshed = await Promise.all(products.map(async (product) => {
    const node = nodes.find((candidate) => candidate?.id === product.shopifyProductId);
    const variant = node?.variants.nodes.find((candidate) => candidate.id === product.shopifyVariantId);
    if (!node || !variant) return product;
    return prisma.saleRotationProduct.update({
      where: { id: product.id },
      data: {
        title: node.title,
        variantTitle: variant.title,
        handle: node.handle,
        imageUrl: node.featuredImage?.url ?? null,
        regularPrice: standardPrice(variant.price, variant.compareAtPrice),
        active: node.status === "ACTIVE" ? product.active : false,
      },
    });
  }));
  return refreshed.sort((a, b) => Number(b.active) - Number(a.active) || a.title.localeCompare(b.title));
}

export async function updateSaleProduct(id: string, input: Record<string, unknown>) {
  const shop = assertSpeciesLibraryShop();
  const existing = await prisma.saleRotationProduct.findFirst({ where: { id, shop } });
  if (!existing) throw new Error("Sale product not found.");
  const discount = input.discountPercent === undefined ? existing.discountPercent : Number(input.discountPercent);
  if (discount !== null && !SALE_DISCOUNTS.includes(discount as SaleDiscount)) throw new Error("Discount must be 5, 10, 15, or 20 percent.");
  const twentyPercentCandidate = typeof input.twentyPercentCandidate === "boolean" ? input.twentyPercentCandidate : existing.twentyPercentCandidate;
  const fixedInSale = typeof input.fixedInSale === "boolean" ? input.fixedInSale : existing.fixedInSale;
  if (fixedInSale && !twentyPercentCandidate) throw new Error("Only products in the 20% pool can be fixed in the sale.");
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
    const compatible = !collection.ruleSet || (compareAtRule && (rules.length === 1 || (tagRule && !collection.ruleSet.appliedDisjunctively)));
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

export async function buildSaleRotationPreview() {
  const [settings, products, collection] = await Promise.all([getSaleSettings(), listSaleProducts(), getSaleCollectionSnapshot()]);
  const current = new Set(collection.productIds);
  const active = products.filter((product) => product.active);
  const selected = new Map<string, SaleDiscount>();
  const selectTier = (discount: SaleDiscount, count: number, candidates: typeof active) => {
    const ordered = shuffled(candidates).sort((a, b) => Number(current.has(a.shopifyProductId)) - Number(current.has(b.shopifyProductId)));
    ordered.slice(0, count).forEach((product) => selected.set(product.id, discount));
  };
  selectTier(5, settings.discountCount5, active.filter((p) => p.eligibleForRotation && !p.twentyPercentCandidate));
  selectTier(10, settings.discountCount10, active.filter((p) => p.eligibleForRotation && !p.twentyPercentCandidate && !selected.has(p.id)));
  selectTier(15, settings.discountCount15, active.filter((p) => p.eligibleForRotation && !p.twentyPercentCandidate && !selected.has(p.id)));
  const fixed = active.filter((p) => p.twentyPercentCandidate && p.fixedInSale);
  fixed.forEach((product) => selected.set(product.id, 20));
  selectTier(20, Math.max(0, settings.discountCount20 - fixed.length), active.filter((p) => p.twentyPercentCandidate && !p.fixedInSale));

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
    shortages: SALE_DISCOUNTS.map((discount) => {
      const requested = settings[`discountCount${discount}` as const];
      const actual = [...selected.values()].filter((value) => value === discount).length;
      return { discount, requested, actual, shortage: Math.max(0, requested - actual) };
    }),
  };
}

async function productMutation(query: string, variables: Record<string, unknown>, failure: string) {
  const response = await macroalgaeGraphql<Gql<Record<string, { userErrors?: Array<{ message: string }> }>>>(query, variables);
  const data = gqlData(response, failure);
  const errors = Object.values(data).flatMap((entry) => entry?.userErrors ?? []);
  if (errors.length) throw new Error(errors.map((error) => error.message).join("; "));
}

async function applyMembership(collection: CollectionSnapshot, add: string[], remove: string[]) {
  if (!collection.compatible) {
    throw new Error(`Shopify collection "${collection.title}" is not compatible with Sale Rotation. Use a manual collection, or an automated collection with compare-at price greater than 0 and an optional ${SALE_TAG} tag rule.`);
  }
  if (collection.automated) {
    for (const productId of add) await productMutation(`mutation($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { message } } }`, { id: productId, tags: [SALE_TAG] }, "Could not tag a sale product.");
    for (const productId of remove) await productMutation(`mutation($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { message } } }`, { id: productId, tags: [SALE_TAG] }, "Could not remove a sale product tag.");
    return;
  }
  if (add.length) await productMutation(`mutation($id: ID!, $products: [ID!]!) { collectionAddProducts(id: $id, productIds: $products) { userErrors { message } } }`, { id: collection.id, products: add }, "Could not add products to the Sale collection.");
  if (remove.length) await productMutation(`mutation($id: ID!, $products: [ID!]!) { collectionRemoveProducts(id: $id, productIds: $products) { userErrors { message } } }`, { id: collection.id, products: remove }, "Could not remove products from the Sale collection.");
}

type PriceSnapshot = { productId: string; variantId: string; price: string; compareAtPrice: string | null };

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
  const response = await macroalgaeGraphql<Gql<{ nodes: Array<null | { id: string; variants: { nodes: Array<{ id: string; price: string; compareAtPrice: string | null }> } }> }>>(`
    query CaptureSalePrices($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product { id variants(first: 250) { nodes { id price compareAtPrice } } }
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

export async function runSaleRotation(triggerType: "Manual" | "Scheduled" = "Manual") {
  const settings = await getSaleSettings();
  const lockToken = randomUUID();
  const now = new Date();
  const locked = await prisma.saleRotationSettings.updateMany({
    where: { id: settings.id, OR: [{ lockExpiresAt: null }, { lockExpiresAt: { lt: now } }] },
    data: { lockToken, lockExpiresAt: new Date(now.getTime() + 15 * 60_000) },
  });
  if (!locked.count) throw new Error("Another sale rotation is already running.");
  const run = await prisma.saleRotationRun.create({ data: { shop: settings.shop, triggerType, dryRun: settings.dryRun } });
  let preview: Awaited<ReturnType<typeof buildSaleRotationPreview>> | null = null;
  let priceSnapshots: PriceSnapshot[] = [];
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
      priceSnapshots = await capturePrices(preview.actions);
      await writePrices(preview.actions, priceSnapshots);
      await applyMembership(
        preview.collection,
        preview.actions.filter((item) => item.action === "ADD").map((item) => item.product.shopifyProductId),
        preview.actions.filter((item) => item.action === "REMOVE").map((item) => item.product.shopifyProductId),
      );
    }
    const message = settings.dryRun ? "Dry run completed; Shopify was not changed." : "Sale rotation completed successfully.";
    await prisma.$transaction([
      prisma.saleRotationRun.update({ where: { id: run.id }, data: { status: settings.dryRun ? "Dry Run" : "Completed", message, completedAt: new Date() } }),
      prisma.saleRotationSettings.update({ where: { id: settings.id }, data: { lastRotatedAt: new Date() } }),
    ]);
    return { runId: run.id, executed: !settings.dryRun, message, preview };
  } catch (error) {
    let message = error instanceof Error ? error.message : "Sale rotation failed.";
    if (!settings.dryRun && preview) {
      try {
        await restorePrices(priceSnapshots);
        await applyMembership(
          preview.collection,
          preview.actions.filter((item) => item.action === "REMOVE").map((item) => item.product.shopifyProductId),
          preview.actions.filter((item) => item.action === "ADD").map((item) => item.product.shopifyProductId),
        );
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
