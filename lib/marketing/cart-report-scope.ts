import type { Tx } from "./store";

/** A restricted test remains a test after the live flow's audience changes. */
export async function customerCartMessages<T extends { key: string; flowKey: string | null }>(
  db: Pick<Tx, "marketingResource">, shop: string, messages: T[],
): Promise<T[]> {
  const roots = [...new Set(messages.filter(m => m.flowKey === "abandoned-cart" && m.key.startsWith("cart-v1:"))
    .map(m => m.key.slice(0, m.key.lastIndexOf(":"))))];
  if (!roots.length) return messages;
  const runs = await db.marketingResource.findMany({
    where: { shop, kind: "CART_RUN", key: { in: roots } }, select: { key: true, data: true },
  });
  const tests = new Set(runs.filter(r => !!(r.data as { testEmail?: string }).testEmail).map(r => r.key));
  return messages.filter(m => m.flowKey !== "abandoned-cart" || !tests.has(m.key.slice(0, m.key.lastIndexOf(":"))));
}
