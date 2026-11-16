import type { Tx } from "./store";

type Activity = { id: string; key: string; triggerAt: Date | null; createdAt: Date };
type Timing = { enteredAt: string; checkoutStartedAt: string | null };
const instant = (value: unknown): string | null =>
  typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

/** Checkout creation is a purchase boundary, not the time recovery was entered. */
export async function cartActivityTiming(db: Pick<Tx, "marketingResource">, shop: string, messages: Activity[]) {
  const root = (message: Activity) => message.key.slice(0, message.key.lastIndexOf(":"));
  const keys = [...new Set(messages.filter(message => message.key.startsWith("cart-v1:")).map(root))];
  const runs = keys.length ? await db.marketingResource.findMany({
    where: { shop, kind: "CART_RUN", key: { in: keys } }, select: { key: true, data: true },
  }) : [];
  const saved = new Map(runs.map(run => [run.key, run.data as {
    abandonment?: { abandonedAt?: unknown }; checkoutCreatedAt?: unknown;
  }]));
  return new Map(messages.map(message => {
    const run = saved.get(root(message));
    const timing: Timing = {
      // Legacy or deleted-run history still has the actual queue creation time.
      enteredAt: instant(run?.abandonment?.abandonedAt) || message.createdAt.toISOString(),
      checkoutStartedAt: message.triggerAt?.toISOString() || instant(run?.checkoutCreatedAt),
    };
    return [message.id, timing];
  }));
}
