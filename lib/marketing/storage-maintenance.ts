import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { atomic, json, record, shop, type Tx } from "./store";
import { isCampaignContentReference, saveCampaignContent } from "./content-storage";

async function requirePaused(tx: Tx) {
  const settings = await tx.marketingResource.findUnique({
    where: { shop_kind_key: { shop: shop(), kind: "SETTINGS", key: "global" } },
  });
  if ((settings?.data as { operations?: { sendingEnabled?: boolean } })?.operations?.sendingEnabled !== false)
    throw new Error("Pause sending in Our Klaviyo Settings before applying storage maintenance.");
  if (await tx.marketingMessage.count({ where: { shop: shop(), status: { in: ["SENDING", "UNKNOWN"] } } }))
    throw new Error("Resolve sending or uncertain messages before storage maintenance.");
}

/** Bounded, resumable and lossless: no message, consent, event or token is deleted. */
export async function compactCampaignMessages(options: { apply?: boolean; limit?: number; after?: string } = {}) {
  if (options.apply) await atomic(requirePaused);
  const limit = Math.max(1, Math.min(options.limit ?? 1000, 10000));
  let cursor = options.after, scanned = 0, candidates = 0, compacted = 0, serializedBytes = 0;
  const snapshots = new Map<string, number>();
  while (scanned < limit) {
    const rows = await prisma.marketingMessage.findMany({
      where: { shop: shop(), campaignId: { not: null }, status: { notIn: ["SENDING", "UNKNOWN"] }, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" }, take: Math.min(10, limit - scanned),
      select: { id: true, content: true, updatedAt: true },
    });
    if (!rows.length) break;
    for (const row of rows) {
      scanned++;
      cursor = row.id;
      if (isCampaignContentReference(row.content)) continue;
      candidates++;
      const serialized = JSON.stringify(row.content);
      serializedBytes += Buffer.byteLength(serialized);
      snapshots.set(createHash("sha256").update(serialized).digest("hex"), Buffer.byteLength(serialized));
      if (!options.apply) continue;
      compacted += await atomic(async (tx) => {
        await requirePaused(tx);
        const current = await tx.marketingMessage.findUniqueOrThrow({ where: { id: row.id } });
        if (current.updatedAt.getTime() !== row.updatedAt.getTime() || ["SENDING", "UNKNOWN"].includes(current.status)) return 0;
        const reference = await saveCampaignContent(tx, shop(), current.content);
        const updated = await tx.marketingMessage.updateMany({
          where: { id: row.id, updatedAt: row.updatedAt, status: { notIn: ["SENDING", "UNKNOWN"] } },
          data: { content: reference },
        });
        if (updated.count) await record(tx, {
          key: `storage:message:${row.id}`, type: "MESSAGE_CONTENT_COMPACTED",
          profileId: current.profileId, messageId: row.id, payload: reference,
        });
        return updated.count;
      });
    }
  }
  const result = { mode: options.apply ? "apply" : "dry-run", scanned, candidates, compacted,
    serializedBytes, uniqueSnapshotBytes: [...snapshots.values()].reduce((a, b) => a + b, 0),
    nextCursor: scanned === limit ? cursor : null };
  if (options.apply && compacted) await atomic(async (tx) => {
    await record(tx, { key: `storage:${randomUUID()}`, type: "STORAGE_COMPACTED", payload: result });
  });
  return result;
}

/** Retain replay keys and diagnostics; only old successfully processed raw bodies are reduced. */
export async function compactProcessedInbox(options: { apply?: boolean; limit?: number; days?: number; after?: string } = {}) {
  if (options.apply) await atomic(requirePaused);
  const days = options.days ?? 30;
  if (!Number.isInteger(days) || days < 30) throw new Error("Keep at least 30 days of raw Shopify payloads.");
  const cutoff = new Date(Date.now() - days * 86400000);
  const rows = await prisma.marketingWebhookInbox.findMany({
    where: { shop: shop(), status: "DONE", processedAt: { lt: cutoff }, ...(options.after ? { id: { gt: options.after } } : {}) },
    orderBy: { id: "asc" }, take: Math.max(1, Math.min(options.limit ?? 100, 1000)),
    select: { id: true, payload: true },
  });
  let compacted = 0;
  const candidates = rows.filter((row) => !(row.payload as { storageCompacted?: boolean })?.storageCompacted);
  for (const row of candidates) {
    if (!options.apply) continue;
    compacted += await atomic(async (tx) => {
      await requirePaused(tx);
      const serialized = JSON.stringify(row.payload);
      const result = await tx.marketingWebhookInbox.updateMany({
        where: { id: row.id, shop: shop(), status: "DONE", processedAt: { lt: cutoff } },
        data: { payload: json({ storageCompacted: true, sha256: createHash("sha256").update(serialized).digest("hex"), originalBytes: Buffer.byteLength(serialized) }) },
      });
      if (result.count) await record(tx, { key: `storage:inbox:${row.id}`, type: "INBOX_PAYLOAD_COMPACTED", payload: { inboxId: row.id, days } });
      return result.count;
    });
  }
  return { mode: options.apply ? "apply" : "dry-run", scanned: rows.length, candidates: candidates.length, compacted,
    serializedBytes: candidates.reduce((n, r) => n + Buffer.byteLength(JSON.stringify(r.payload)), 0), cutoff,
    nextCursor: rows.length ? rows[rows.length - 1].id : null };
}
