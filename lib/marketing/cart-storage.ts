import { createHash } from "node:crypto";
import { content, type Content } from "./rules";
import { validateFlow, type FlowConfig } from "./flow-config";
import { json, type Tx } from "./store";

type Storage = Pick<Tx, "marketingResource">;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value, (_, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest("hex");

async function save(db: Storage, shop: string, kind: string, value: unknown) {
  const key = hash(value);
  await db.marketingResource.upsert({
    where: { shop_kind_key: { shop, kind, key } },
    create: { shop, kind, key, name: "Shared cart email data", data: json({ value }) }, update: {},
  });
  return key;
}
async function load(db: Storage, shop: string, kind: string, key: unknown): Promise<unknown> {
  if (typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key)) throw Error("Invalid shared cart reference");
  const row = await db.marketingResource.findUnique({ where: { shop_kind_key: { shop, kind, key } } });
  const value = (row?.data as { value?: unknown } | undefined)?.value;
  if (value === undefined || hash(value) !== key) throw Error("Shared cart data is missing or damaged; delivery stopped");
  return value;
}
// Artwork is stored once even when different versions of copy use the same upload.
async function artwork(db: Storage, shop: string, value: unknown, saving: boolean): Promise<unknown> {
  if (saving && typeof value === "string" && value.startsWith("data:image/"))
    return { cartAssetRef: await save(db, shop, "CART_ASSET", value) };
  if (!value || typeof value !== "object") return value;
  if (!saving && "cartAssetRef" in value) {
    const image = await load(db, shop, "CART_ASSET", (value as { cartAssetRef: unknown }).cartAssetRef);
    if (typeof image !== "string" || !image.startsWith("data:image/")) throw Error("Invalid cart artwork");
    return image;
  }
  if (Array.isArray(value)) return Promise.all(value.map(item => artwork(db, shop, item, saving)));
  return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) =>
    [key, await artwork(db, shop, item, saving)])));
}

export function isCartContentReference(value: unknown): value is { cartContentRef: string; values: Record<string, unknown> } {
  return !!value && typeof value === "object" && "cartContentRef" in value;
}
/** Shared copy/artwork plus only the checkout URL, selected products and coupon per message. */
export async function saveCartContent(db: Storage, shop: string, value: unknown) {
  if (isCartContentReference(value)) {
    await resolveCartContent(db, shop, value);
    return json(value);
  }
  const { url, products, couponCode, ...shared } = content(value);
  const key = await save(db, shop, "CART_CONTENT", await artwork(db, shop, shared, true));
  return json({ cartContentRef: key, values: { url, products, couponCode } });
}
export async function resolveCartContent(db: Storage, shop: string, value: unknown): Promise<Content> {
  if (!isCartContentReference(value)) return content(value); // Legacy inline messages remain readable.
  const shared = await artwork(db, shop, await load(db, shop, "CART_CONTENT", value.cartContentRef), false);
  const overrides = value.values;
  if (!overrides || typeof overrides !== "object" || Object.keys(overrides).some(k => !["url", "products", "couponCode"].includes(k)))
    throw Error("Invalid cart message values");
  return content({ ...(shared as object), ...overrides });
}

export async function saveCartConfig(db: Storage, shop: string, config: FlowConfig) {
  const stored = {
    ...config,
    steps: await Promise.all(config.steps.map(async step => ({ ...step, content: await saveCartContent(db, shop, step.content) }))),
    ...(config.smsContent ? { smsContent: await saveCartContent(db, shop, config.smsContent) } : {}),
    ...(config.orderBranch ? { orderBranch: {
      yes: { ...config.orderBranch.yes, content: await saveCartContent(db, shop, config.orderBranch.yes.content) },
      no: { ...config.orderBranch.no, content: await saveCartContent(db, shop, config.orderBranch.no.content) },
    } } : {}),
  };
  return save(db, shop, "CART_CONFIG", json(stored));
}
export async function resolveCartConfig(db: Storage, shop: string, key: string): Promise<FlowConfig> {
  const stored = await load(db, shop, "CART_CONFIG", key) as FlowConfig;
  return validateFlow("abandoned-cart", {
    ...stored,
    steps: await Promise.all(stored.steps.map(async step => ({ ...step, content: await resolveCartContent(db, shop, step.content) }))),
    ...(stored.smsContent ? { smsContent: await resolveCartContent(db, shop, stored.smsContent) } : {}),
    ...(stored.orderBranch ? { orderBranch: {
      yes: { ...stored.orderBranch.yes, content: await resolveCartContent(db, shop, stored.orderBranch.yes.content) },
      no: { ...stored.orderBranch.no, content: await resolveCartContent(db, shop, stored.orderBranch.no.content) },
    } } : {}),
  });
}
