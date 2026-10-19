import type { Tx } from "./store";
import { Prisma } from "@/app/generated/prisma/client";

/** A restricted test remains a test after the live flow's audience changes. */
export async function customerFlowMessages<T extends { key: string; flowKey: string | null; profileId?: string }>(
  db: Pick<Tx, "marketingResource">, shop: string, messages: T[],
): Promise<T[]> {
  const roots = [...new Set(messages.filter(m => m.flowKey === "abandoned-cart" && m.key.startsWith("cart-v1:"))
    .map(m => m.key.slice(0, m.key.lastIndexOf(":"))))];
  const welcomeProfile = (m: T) => m.profileId || (m.key.startsWith("welcome-v1:")
    ? m.key.slice("welcome-v1:".length, m.key.lastIndexOf(":")) : "");
  const welcome = [...new Set(messages.filter(m => m.flowKey === "welcome").map(welcomeProfile).filter(Boolean))];
  if (!roots.length && !welcome.length) return messages;
  // Select only identity fields. A Welcome run can contain a large saved design.
  const runs = await db.marketingResource.findMany({
    where: { shop, OR: [
      { kind: "CART_RUN", key: { in: roots } },
      { kind: "WELCOME_RUN", key: { in: welcome } },
    ], data: { path: ["testEmail"], not: Prisma.AnyNull },
      NOT: { data: { path: ["testEmail"], equals: "" } },
    }, select: { key: true, kind: true },
  });
  const tests = new Set(runs.map(r => r.kind + ":" + r.key));
  return messages.filter(m => m.flowKey === "abandoned-cart"
    ? !tests.has("CART_RUN:" + m.key.slice(0, m.key.lastIndexOf(":")))
    : m.flowKey !== "welcome" || !tests.has("WELCOME_RUN:" + welcomeProfile(m)));
}

// Keep the original export for callers and older report integrations.
export const customerCartMessages = customerFlowMessages;
