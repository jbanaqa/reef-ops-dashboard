import { createHash } from "node:crypto";
import { content, type Content } from "./rules";
import { json, type Tx } from "./store";

type Storage = Pick<Tx, "marketingResource">;
const kind = "CAMPAIGN_CONTENT";
// PostgreSQL JSONB reorders object keys. Hash a canonical representation so
// snapshots verify identically before and after database round trips.
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value, (_, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]))
    : item)).digest("hex");

/** Immutable, shop-scoped email snapshots. Recipient rows keep only this reference. */
export async function saveCampaignContent(db: Storage, shop: string, value: unknown) {
  const snapshot = content(value);
  const key = hash(snapshot);
  await db.marketingResource.upsert({
    where: { shop_kind_key: { shop, kind, key } },
    create: { shop, kind, key, name: "Shared campaign email", data: json({ content: snapshot }) },
    update: {},
  });
  return { campaignContentRef: key };
}

export function isCampaignContentReference(value: unknown) {
  return !!value && typeof value === "object" && "campaignContentRef" in value;
}

export async function resolveCampaignContent(db: Storage, shop: string, value: unknown): Promise<Content> {
  if (!isCampaignContentReference(value)) return content(value); // Existing messages remain readable.
  const key = (value as { campaignContentRef: unknown }).campaignContentRef;
  if (typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key))
    throw new Error("Invalid campaign email reference");
  const row = await db.marketingResource.findUnique({
    where: { shop_kind_key: { shop, kind, key } },
  });
  const snapshot = (row?.data as { content?: unknown } | undefined)?.content;
  if (!snapshot || hash(snapshot) !== key)
    throw new Error("Shared campaign email is missing or damaged; delivery stopped");
  return content(snapshot);
}
