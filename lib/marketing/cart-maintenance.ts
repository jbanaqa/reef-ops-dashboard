import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { atomic, json, record, shop, type Tx } from "./store";
import { cartRunKey, type CartRun } from "./cart";
import { isCartContentReference, saveCartConfig, saveCartContent } from "./cart-storage";

async function requirePausedCart(tx: Tx) {
  const flow = await tx.marketingResource.findUnique({ where: { shop_kind_key: { shop: shop(), kind: "FLOW", key: "abandoned-cart" } } });
  if (!flow || flow.enabled) throw Error("Pause Abandoned Cart before cleaning up its storage or queue.");
  if (await tx.marketingMessage.count({ where: { shop: shop(), flowKey: "abandoned-cart", status: { in: ["SENDING", "UNKNOWN"] } } }))
    throw Error("Review in-flight or uncertain cart deliveries before cleanup.");
}

/** Explicit staff cleanup only. Keeps sent history, customers, consent and other flows. */
export async function clearPausedCartMessages(before: Date) {
  if (!Number.isFinite(+before) || before > new Date()) throw Error("Invalid cart cleanup cutoff");
  return atomic(async tx => {
    await requirePausedCart(tx);
    const messages = await tx.marketingMessage.findMany({ where: {
      shop: shop(), flowKey: "abandoned-cart", status: "PENDING", providerId: null, createdAt: { lt: before },
    }, select: { id: true, key: true } });
    const ids = messages.map(m => m.id);
    await tx.marketingResource.deleteMany({ where: { shop: shop(), kind: { in: ["CART_WAIT", "CART_READY"] }, key: { in: ids } } });
    const deleted = await tx.marketingMessage.deleteMany({ where: {
      shop: shop(), id: { in: ids }, flowKey: "abandoned-cart", status: "PENDING", providerId: null,
    } });
    for (const key of new Set(messages.filter(m => m.key.startsWith("cart-v1:")).map(m => cartRunKey(m.key)))) {
      if (!(await tx.marketingMessage.count({ where: { shop: shop(), key: { startsWith: key + ":" } } })))
        await tx.marketingResource.deleteMany({ where: { shop: shop(), kind: "CART_RUN", key, NOT: { data: { path: ["completedAt"], not: Prisma.AnyNull } } } });
    }
    if (deleted.count) await record(tx, { key: "cart-queue-cleared:" + before.toISOString(), type: "CART_QUEUE_CLEARED",
      payload: { count: deleted.count, messageIds: ids, before: before.toISOString() } });
    return { deleted: deleted.count };
  });
}

/** Lossless compaction; new and legacy messages remain readable by the same worker. */
export async function compactCartStorage(limit = 500) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw Error("Choose a cart compaction limit of 1–1000");
  await atomic(requirePausedCart);
  let runs = 0, messages = 0, prepared = 0;
  const runRows = await prisma.marketingResource.findMany({ where: { shop: shop(), kind: "CART_RUN", data: { path: ["config"], not: Prisma.AnyNull } }, take: limit });
  for (const row of runRows) await atomic(async tx => {
    await requirePausedCart(tx);
    const stored = row.data as unknown as CartRun & { configRef?: string };
    if (!stored.config || stored.configRef) return;
    const { config, ...values } = stored;
    const configRef = await saveCartConfig(tx, shop(), config);
    await tx.marketingResource.update({ where: { id: row.id }, data: { data: json({ ...values, configRef }), updatedAt: row.updatedAt } });
    runs++;
  });
  const rows = await prisma.marketingMessage.findMany({ where: { shop: shop(), flowKey: "abandoned-cart", NOT: { content: { path: ["cartContentRef"], not: Prisma.AnyNull } } }, take: limit });
  for (const row of rows) await atomic(async tx => {
    await requirePausedCart(tx);
    if (isCartContentReference(row.content)) return;
    await tx.marketingMessage.update({ where: { id: row.id }, data: { content: await saveCartContent(tx, shop(), row.content), updatedAt: row.updatedAt } });
    messages++;
  });
  const ready = await prisma.marketingResource.findMany({ where: { shop: shop(), kind: "CART_READY", NOT: { data: { path: ["cartContentRef"], not: Prisma.AnyNull } } }, take: limit });
  for (const row of ready) await atomic(async tx => {
    await requirePausedCart(tx);
    if (isCartContentReference(row.data)) return;
    await tx.marketingResource.update({ where: { id: row.id }, data: { data: await saveCartContent(tx, shop(), row.data), updatedAt: row.updatedAt } });
    prepared++;
  });
  return { runs, messages, prepared };
}
