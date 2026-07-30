import assert from "node:assert/strict";

// lib/collection-rotation-plan.ts depends on live Prisma calls end-to-end,
// so - same approach as verify-out-of-stock-exclusion.ts takes for
// isConfirmedOutOfStock - this mirrors its archived/draft exclusion logic
// exactly as pure functions, rather than trying to invoke
// buildCollectionRotationPlan() directly against a real database.
//
// Covers: archived and draft products are both excluded (Shopify collection
// membership doesn't drop a product just because it's unpublished, but
// neither status is ever visible/purchasable on the storefront); a product
// that's BOTH archived and out of stock is counted once, under
// archivedCount, not double-counted into outOfStockCount too; and the
// unavailable products' original relative order is preserved when they're
// moved to the end (rather than grouping "all archived" before/after "all
// out of stock" regardless of where they actually sat).

type Metric = { hasInventoryData: boolean; availableInventory: number };
type Product = { id: string; status: string };

function isConfirmedOutOfStock(
  metrics: Map<string, Metric>,
  productId: string
) {
  const metric = metrics.get(productId);
  return Boolean(metric?.hasInventoryData) && (metric?.availableInventory ?? 0) <= 0;
}

function isUnpublished(product: Product) {
  return product.status !== "ACTIVE";
}

function classify(products: Product[], metrics: Map<string, Metric>) {
  const inStockProducts = products.filter(
    (product) => !isUnpublished(product) && !isConfirmedOutOfStock(metrics, product.id)
  );
  const unavailableProducts = products.filter(
    (product) => isUnpublished(product) || isConfirmedOutOfStock(metrics, product.id)
  );
  const archivedCount = unavailableProducts.filter((product) =>
    isUnpublished(product)
  ).length;
  const outOfStockCount = unavailableProducts.length - archivedCount;

  return { inStockProducts, unavailableProducts, archivedCount, outOfStockCount };
}

const products: Product[] = [
  { id: "P1", status: "ACTIVE" }, // in stock, active -> scored
  { id: "P2", status: "ARCHIVED" }, // archived, has stock -> excluded (archived)
  { id: "P3", status: "ACTIVE" }, // active, out of stock -> excluded (out of stock)
  { id: "P4", status: "ARCHIVED" }, // archived AND out of stock -> excluded (archived only)
  { id: "P5", status: "DRAFT" }, // draft, in stock -> excluded (archived/unpublished bucket)
  { id: "P6", status: "ACTIVE" }, // active, no inventory data synced yet -> scored (not CONFIRMED out of stock)
];

const metrics = new Map<string, Metric>([
  ["P1", { hasInventoryData: true, availableInventory: 20 }],
  ["P2", { hasInventoryData: true, availableInventory: 15 }],
  ["P3", { hasInventoryData: true, availableInventory: 0 }],
  ["P4", { hasInventoryData: true, availableInventory: 0 }],
  ["P5", { hasInventoryData: true, availableInventory: 10 }],
  // P6 intentionally has no entry - simulates a product with no synced
  // inventory data at all yet.
]);

const result = classify(products, metrics);

console.log("In-stock, active (scored):", result.inStockProducts.map((p) => p.id));
console.log("Unavailable (excluded), in original order:", result.unavailableProducts.map((p) => p.id));
console.log(`archivedCount=${result.archivedCount}, outOfStockCount=${result.outOfStockCount}`);

assert.deepEqual(
  result.inStockProducts.map((p) => p.id),
  ["P1", "P6"],
  "Only the truly in-stock, active/published products should be scored"
);

assert.deepEqual(
  result.unavailableProducts.map((p) => p.id),
  ["P2", "P3", "P4", "P5"],
  "Unavailable products should be excluded in their original relative order, not grouped by reason"
);

assert.equal(
  result.archivedCount,
  3,
  "P2, P4, and P5 (archived or draft) should all count as archived"
);

assert.equal(
  result.outOfStockCount,
  1,
  "Only P3 should count as out-of-stock - P4 is archived AND out of stock but must not be double-counted"
);

console.log("Archived/unpublished exclusion verification passed.");
