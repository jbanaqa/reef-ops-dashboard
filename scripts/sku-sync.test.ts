import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";

// This suite creates its own PostgreSQL-compatible database. It never connects
// to a deployment's DATABASE_URL or contacts Cloudflare, Shopify or an email API.
let database: PGlite;
let socket: PGLiteSocketServer;
let db: PrismaClient;
let createSkuSyncService: typeof import("../lib/sku-sync/service").createSkuSyncService;
let SkuSyncMutationRejectedError: typeof import("../lib/sku-sync/shopify").SkuSyncMutationRejectedError;
const previousDatabaseUrl = process.env.DATABASE_URL;
const originalFetch = globalThis.fetch;

type Side = "A" | "B";
type Mapping = {
  id: string;
  name: string;
  category: string | null;
  active: boolean;
  variantAId: string;
  variantBId: string;
};
type Snapshot = {
  variantId: string;
  productId: string;
  title: string;
  variantTitle: string;
  sku: string;
  url: string | null;
};
type Write = { side: Side; variantId: string; sku: string };
type Service = ReturnType<typeof import("../lib/sku-sync/service").createSkuSyncService>;
type View = Awaited<ReturnType<Service["refresh"]>>;

before(async () => {
  globalThis.fetch = async () => { throw Error("SKU integration tests must never contact a real service."); };
  database = await PGlite.create();
  await database.exec(await readFile("prisma/migrations/20261120120000_sku_sync/migration.sql", "utf8"));
  socket = new PGLiteSocketServer({ db: database, host: "127.0.0.1", port: 0, maxConnections: 1 });
  await socket.start();
  process.env.DATABASE_URL = "postgresql://postgres:postgres@" + socket.getServerConn() + "/postgres";
  db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 1 }) });
  ({ createSkuSyncService } = await import("../lib/sku-sync/service"));
  ({ SkuSyncMutationRejectedError } = await import("../lib/sku-sync/shopify"));
});

after(async () => {
  await db?.$disconnect();
  await socket?.stop();
  await database?.close();
  globalThis.fetch = originalFetch;
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
});

const variantId = (id: number) => `gid://shopify/ProductVariant/${id}`;
function mapping(id = 1, a = 11, b = 22): Mapping {
  return { id: String(id), name: `Mapped product ${id}`, category: "fish", active: true,
    variantAId: variantId(a), variantBId: variantId(b) };
}
function snapshot(id: string, sku: string): Snapshot {
  const suffix = id.split("/").at(-1)!;
  return { variantId: id, productId: `gid://shopify/Product/${suffix}`, title: `Product ${suffix}`,
    variantTitle: "Default Title", sku, url: `https://store.example/products/product-${suffix}` };
}

function fixture(skuA = "CORALS-OLD", skuB = "MACRO-OLD") {
  let time = Date.UTC(2026, 10, 20, 12);
  const initial = mapping();
  const state = {
    mappings: [initial] as Mapping[],
    mappingFailure: null as Error | null,
    readFailure: null as Side | null,
    beforeRead: null as ((side: Side, ids: string[]) => Promise<void>) | null,
    beforeWrite: null as ((write: Write) => Promise<void>) | null,
    afterWrite: null as ((write: Write) => Promise<void>) | null,
    variants: { A: new Map([[initial.variantAId, snapshot(initial.variantAId, skuA)]]),
      B: new Map([[initial.variantBId, snapshot(initial.variantBId, skuB)]]) },
    writes: [] as Write[],
    reads: [] as { side: Side; ids: string[] }[],
  };
  const dependencies = {
    db,
    namespace: "sku-test-" + randomUUID(),
    now: () => new Date(time),
    fetchMappings: async () => {
      if (state.mappingFailure) throw state.mappingFailure;
      return state.mappings.map(item => ({ ...item }));
    },
    shopify: {
      fetchVariantSnapshots: async (side: Side, ids: string[]) => {
        state.reads.push({ side, ids: [...ids] });
        await state.beforeRead?.(side, ids);
        if (state.readFailure === side) throw Error("Fixture Shopify reads are unavailable.");
        return new Map(ids.flatMap(id => {
          const item = state.variants[side].get(id);
          return item ? [[id, { ...item }] as const] : [];
        }));
      },
      updateVariantSku: async (side: Side, item: Snapshot, sku: string) => {
        const write = { side, variantId: item.variantId, sku };
        state.writes.push(write);
        await state.beforeWrite?.(write);
        const current = state.variants[side].get(item.variantId);
        assert.ok(current, "A missing Shopify variant cannot be written.");
        state.variants[side].set(item.variantId, { ...current, sku });
        await state.afterWrite?.(write);
      },
    },
  };
  const service = createSkuSyncService(dependencies);
  const setSku = (side: Side, sku: string, id = side === "A" ? initial.variantAId : initial.variantBId) => {
    const current = state.variants[side].get(id);
    assert.ok(current);
    state.variants[side].set(id, { ...current, sku });
  };
  const sku = (side: Side, id = side === "A" ? initial.variantAId : initial.variantBId) => state.variants[side].get(id)?.sku;
  const row = (view: View, name = initial.name) => {
    const result = view.mappings.find(item => item.name === name);
    assert.ok(result, `Expected ${name} in the SKU comparison view.`);
    return result;
  };
  const choose = (view: View, source: Side, name = initial.name) => {
    const selected = row(view, name);
    const item = state.mappings.find(candidate => candidate.name === name)!;
    return service.resolve({ mappingId: selected.id, source,
      expectedSkuA: selected.storeA?.sku ?? "", expectedSkuB: selected.storeB?.sku ?? "",
      expectedVariantAId: item.variantAId, expectedVariantBId: item.variantBId });
  };
  const run = async () => { time += 5 * 60_000; return service.run(); };
  return { state, service, dependencies, initial, setSku, sku, row, choose, run,
    advance: (milliseconds: number) => { time += milliseconds; } };
}

async function mayReportFailure(work: () => Promise<unknown>) {
  try { await work(); } catch (error) {
    assert.ok(error instanceof Error);
    assert.match(error.message, /fixture|unavailable|mapping|conflict|already|busy|running|changed|refresh|missing/i);
  }
}

test("first comparison and first scheduled run preserve different starting SKUs", async () => {
  const h = fixture();
  const first = await h.service.refresh();
  assert.equal(h.row(first).storeA?.sku, "CORALS-OLD");
  assert.equal(h.row(first).storeB?.sku, "MACRO-OLD");
  assert.equal(h.row(first).status, "different");
  await h.run();
  assert.deepEqual(h.state.writes, []);
  assert.equal(h.sku("A"), "CORALS-OLD");
  assert.equal(h.sku("B"), "MACRO-OLD");
});

test("the last automatic check records completed scheduled runs, not refreshes or manual choices", async () => {
  const h = fixture();
  assert.equal((await h.service.refresh()).lastAutomaticCheckAt, null);
  h.advance(60_000);
  assert.equal((await h.service.refresh()).lastAutomaticCheckAt, null);

  await h.run();
  const firstAutomaticAt = h.dependencies.now().toISOString();
  h.advance(30_000);
  const refreshed = await h.service.refresh();
  assert.equal(refreshed.lastAutomaticCheckAt, firstAutomaticAt);
  assert.notEqual(refreshed.checkedAt, firstAutomaticAt, "Refreshing may update the comparison time without implying the cron ran.");

  h.advance(30_000);
  const resolved = await h.choose(refreshed, "A");
  assert.equal(h.row(resolved).status, "matching");
  assert.equal(resolved.lastAutomaticCheckAt, firstAutomaticAt, "A successful manual correction is not an automatic check.");
  assert.equal((await h.service.refresh()).lastAutomaticCheckAt, firstAutomaticAt);

  await h.run();
  const secondAutomaticAt = h.dependencies.now().toISOString();
  assert.notEqual(secondAutomaticAt, firstAutomaticAt);
  h.advance(30_000);
  assert.equal((await h.service.refresh()).lastAutomaticCheckAt, secondAutomaticAt);
});

test("one-sided SKU edits propagate in either direction and only write the opposite store", async () => {
  const h = fixture();
  await h.service.refresh();
  h.setSku("A", "FIRST-CHANGE");
  await h.run();
  assert.equal(h.sku("B"), "FIRST-CHANGE");
  assert.deepEqual(h.state.writes, [{ side: "B", variantId: h.initial.variantBId, sku: "FIRST-CHANGE" }]);
  await h.run();
  assert.equal(h.state.writes.length, 1, "The app's own target write must not echo back.");
  h.setSku("B", "SECOND-CHANGE");
  await h.run();
  assert.equal(h.sku("A"), "SECOND-CHANGE");
  assert.deepEqual(h.state.writes.at(-1), { side: "A", variantId: h.initial.variantAId, sku: "SECOND-CHANGE" });
  await h.run();
  assert.equal(h.state.writes.length, 2);
});

test("refresh displays a later SKU edit without treating refresh as permission to write", async () => {
  const h = fixture();
  await h.service.refresh();
  h.setSku("A", "EXTERNAL-EDIT");
  const view = await h.service.refresh();
  assert.equal(h.row(view).storeA?.sku, "EXTERNAL-EDIT");
  assert.equal(h.state.writes.length, 0);
  await h.run();
  assert.equal(h.sku("B"), "EXTERNAL-EDIT", "Refresh must not swallow the old baseline.");
});

test("unrelated product title changes never reconcile an existing SKU difference", async () => {
  const h = fixture();
  await h.service.refresh();
  const current = h.state.variants.A.get(h.initial.variantAId)!;
  h.state.variants.A.set(h.initial.variantAId, { ...current, title: "Renamed product", variantTitle: "Renamed option" });
  await h.run();
  assert.equal(h.sku("A"), "CORALS-OLD"); assert.equal(h.sku("B"), "MACRO-OLD");
  assert.equal(h.state.writes.length, 0);
  assert.equal(h.row(await h.service.refresh()).storeA?.title, "Renamed product");
});

test("matching independent edits settle without any redundant Shopify write", async () => {
  const h = fixture();
  await h.service.refresh();
  h.setSku("A", "BOTH-CHANGED"); h.setSku("B", "BOTH-CHANGED");
  await h.run(); await h.run();
  assert.equal(h.state.writes.length, 0);
  assert.equal(h.row(await h.service.refresh()).status, "matching");
});

test("different edits to both stores remain a conflict until a staff member chooses a winner", async () => {
  const h = fixture();
  await h.service.refresh();
  h.setSku("A", "NEW-CA"); h.setSku("B", "NEW-MACRO");
  await h.run(); await h.run();
  let view = await h.service.refresh();
  assert.equal(h.row(view).status, "conflict");
  assert.equal(h.state.writes.length, 0);
  h.setSku("A", "NEWER-CA");
  await h.run();
  assert.equal(h.state.writes.length, 0, "Another edit must not silently resolve a two-sided conflict.");
  view = await h.service.refresh();
  await h.choose(view, "B");
  assert.equal(h.sku("A"), "NEW-MACRO");
  assert.equal(h.sku("B"), "NEW-MACRO");
  assert.deepEqual(h.state.writes, [{ side: "A", variantId: h.initial.variantAId, sku: "NEW-MACRO" }]);
  await h.run();
  assert.equal(h.state.writes.length, 1);
});

test("manual winner selection works for initial differences without rewriting the source", async () => {
  const h = fixture();
  const view = await h.service.refresh();
  await h.choose(view, "A");
  assert.equal(h.sku("A"), "CORALS-OLD"); assert.equal(h.sku("B"), "CORALS-OLD");
  assert.deepEqual(h.state.writes, [{ side: "B", variantId: h.initial.variantBId, sku: "CORALS-OLD" }]);
  await h.run();
  assert.equal(h.state.writes.length, 1);
});

test("manual choices reject an out-of-date SKU preview", async () => {
  const h = fixture();
  const view = await h.service.refresh();
  h.setSku("B", "EDIT-AFTER-PREVIEW");
  await assert.rejects(h.choose(view, "A"), /changed|refresh|stale/i);
  assert.equal(h.sku("B"), "EDIT-AFTER-PREVIEW");
  assert.equal(h.state.writes.length, 0);
});

test("manual choices reject a remapped variant pair even when the displayed SKU strings still match", async () => {
  const h = fixture();
  const view = await h.service.refresh();
  const oldPair = h.initial;
  const nextPair = mapping(1, 33, 44);
  h.state.mappings = [nextPair];
  h.state.variants.A.set(nextPair.variantAId, snapshot(nextPair.variantAId, "CORALS-OLD"));
  h.state.variants.B.set(nextPair.variantBId, snapshot(nextPair.variantBId, "MACRO-OLD"));
  await assert.rejects(h.service.resolve({ mappingId: h.row(view).id, source: "A",
    expectedSkuA: "CORALS-OLD", expectedSkuB: "MACRO-OLD",
    expectedVariantAId: oldPair.variantAId, expectedVariantBId: oldPair.variantBId }), /changed|refresh|stale|mapping/i);
  assert.equal(h.state.writes.length, 0);
});

test("an intentional SKU clearing is different from a failed or missing product lookup", async () => {
  const h = fixture("ORIGINAL", "ORIGINAL");
  await h.service.refresh();
  h.setSku("A", "");
  await h.run();
  assert.equal(h.sku("B"), "");
  assert.equal(h.state.writes.length, 1);
  assert.equal(h.state.writes[0].sku, "");
  const blank = fixture("", "KEEP-THIS");
  await blank.service.refresh(); await blank.run();
  assert.equal(blank.sku("B"), "KEEP-THIS", "Initial missing SKU does not trigger a bulk clear.");
  assert.equal(blank.state.writes.length, 0);
});

test("SKU comparisons preserve case and whitespace rather than silently normalizing identifiers", async () => {
  const h = fixture("ABC", "ABC");
  await h.service.refresh();
  h.setSku("B", " abc ");
  await h.run();
  assert.equal(h.sku("A"), " abc ");
  assert.equal(h.state.writes[0].sku, " abc ");
});

test("missing Shopify variants never become blank SKU writes and do not consume the baseline", async () => {
  const h = fixture("ORIGINAL-A", "ORIGINAL-B");
  await h.service.refresh();
  const removed = h.state.variants.A.get(h.initial.variantAId)!;
  h.state.variants.A.delete(h.initial.variantAId);
  h.setSku("B", "RECOVERABLE-EDIT");
  await mayReportFailure(h.run);
  assert.equal(h.state.writes.length, 0);
  h.state.variants.A.set(h.initial.variantAId, removed);
  await h.run();
  assert.equal(h.sku("A"), "RECOVERABLE-EDIT");
});

test("transient provider reads preserve the baseline and recover on the next poll", async () => {
  const h = fixture();
  await h.service.refresh();
  h.setSku("A", "WAIT-FOR-READS");
  h.state.readFailure = "B";
  await mayReportFailure(h.run);
  assert.equal(h.state.writes.length, 0);
  h.state.readFailure = null;
  await h.run();
  assert.equal(h.sku("B"), "WAIT-FOR-READS");
});

test("uncertain write completion is resolved by readback rather than repeating or reversing it", async () => {
  const h = fixture();
  await h.service.refresh();
  h.setSku("A", "ACCEPTED-BUT-TIMED-OUT");
  h.state.afterWrite = async () => { throw Error("Fixture connection timed out after Shopify accepted the write."); };
  await mayReportFailure(h.run);
  assert.equal(h.sku("B"), "ACCEPTED-BUT-TIMED-OUT");
  assert.equal(h.state.writes.length, 1);
  h.state.afterWrite = null;
  await h.run(); await h.run();
  assert.equal(h.state.writes.length, 1);
  assert.equal(h.row(await h.service.refresh()).status, "matching");
});

test("a failed write does not replace the baseline and retries the intended target safely", async () => {
  const h = fixture();
  await h.service.refresh();
  h.setSku("A", "RETRY-ME");
  h.state.beforeWrite = async () => { throw new SkuSyncMutationRejectedError("Fixture Shopify mutation rejected before execution."); };
  await mayReportFailure(h.run);
  assert.equal(h.sku("B"), "MACRO-OLD");
  h.state.beforeWrite = null;
  await h.run();
  assert.equal(h.sku("B"), "RETRY-ME");
  assert.ok(h.state.writes.every(item => item.side === "B"));
});

test("a rejected SKU update remains visibly failed through refreshes until a successful retry", async () => {
  const h = fixture();
  await h.service.refresh();
  h.setSku("A", "PERSISTENT-RETRY");
  h.state.beforeWrite = async () => { throw new SkuSyncMutationRejectedError("Fixture Shopify rejected the SKU update."); };
  const failed = await h.run();
  assert.equal(failed.synced, 0);
  assert.equal(h.sku("B"), "MACRO-OLD");

  for (let attempt = 0; attempt < 2; attempt++) {
    h.advance(60_000);
    const refreshed = h.row(await h.service.refresh());
    assert.equal(refreshed.status, "sync-error");
    assert.ok(refreshed.error?.trim(), "The row must retain a useful failure note after a fresh comparison.");
  }
  assert.equal(h.state.writes.length, 1, "Refreshing must neither hide the failure nor retry the Shopify write.");

  h.state.beforeWrite = null;
  const recovered = await h.run();
  assert.equal(recovered.synced, 1);
  assert.equal(h.sku("B"), "PERSISTENT-RETRY");
  const refreshed = h.row(await h.service.refresh());
  assert.equal(refreshed.status, "matching");
  assert.equal(refreshed.error, null);
  assert.equal(h.state.writes.length, 2);
  assert.ok(h.state.writes.every(item => item.side === "B"));
});

test("pending retries cannot overwrite a newer target-side edit with stale intent", async () => {
  const h = fixture();
  await h.service.refresh();
  h.setSku("A", "OLD-PENDING-VALUE");
  h.state.beforeWrite = async () => { throw Error("Fixture write outcome is unknown."); };
  await mayReportFailure(h.run);
  h.state.beforeWrite = null;
  h.setSku("B", "NEW-TARGET-EDIT");
  const previousWrites = h.state.writes.length;
  await h.run();
  assert.equal(h.sku("B"), "NEW-TARGET-EDIT");
  assert.equal(h.state.writes.length, previousWrites);
  assert.equal(h.row(await h.service.refresh()).status, "conflict");
});

test("uncertain writes that have not appeared in Shopify require an explicit same-SKU retry", async () => {
  const h = fixture();
  await h.service.refresh();
  h.setSku("A", "EXPLICIT-RETRY");
  h.state.beforeWrite = async () => { throw Error("Fixture request outcome is unknown."); };
  await mayReportFailure(h.run);
  assert.equal(h.state.writes.length, 1);
  h.state.beforeWrite = null;
  await h.run();
  assert.equal(h.state.writes.length, 1, "Unknown outcomes must not cause an automatic repeated write.");
  const view = await h.service.refresh();
  assert.equal(h.row(view).canResolve, true, "A verified fresh comparison must offer the deliberate retry.");
  await h.choose(view, "A");
  assert.equal(h.sku("B"), "EXPLICIT-RETRY");
  assert.equal(h.state.writes.length, 2);
});

test("a source edit during a pending retry cannot replay the superseded value", async () => {
  const h = fixture();
  await h.service.refresh();
  h.setSku("A", "SUPERSEDED-PENDING");
  h.state.beforeWrite = async () => { throw new SkuSyncMutationRejectedError("Fixture mutation was rejected."); };
  await mayReportFailure(h.run);
  h.state.beforeWrite = null;
  h.setSku("A", "NEWER-SOURCE");
  const previousWrites = h.state.writes.length;
  await h.run();
  assert.equal(h.sku("B"), "MACRO-OLD");
  assert.equal(h.state.writes.length, previousWrites);
  assert.equal(h.row(await h.service.refresh()).status, "conflict");
});

test("a target edit between the poll and final preflight is retained rather than overwritten", async () => {
  const h = fixture();
  await h.service.refresh();
  h.setSku("A", "POLL-SOURCE");
  let targetReads = 0;
  h.state.beforeRead = async side => {
    if (side === "B" && ++targetReads === 2) h.setSku("B", "TARGET-EDIT-DURING-CHECK");
  };
  await h.run();
  assert.equal(h.sku("B"), "TARGET-EDIT-DURING-CHECK");
  assert.equal(h.state.writes.length, 0);
  assert.equal(h.row(await h.service.refresh()).status, "conflict");
});

test("a remapped pair discards an old pending intent instead of writing the new postings", async () => {
  const h = fixture();
  await h.service.refresh();
  h.setSku("A", "OLD-PAIR-PENDING");
  h.state.beforeWrite = async () => { throw new SkuSyncMutationRejectedError("Fixture mutation was rejected."); };
  await mayReportFailure(h.run);
  h.state.beforeWrite = null;
  const next = mapping(1, 33, 44);
  h.state.mappings = [next];
  h.state.variants.A.set(next.variantAId, snapshot(next.variantAId, "NEW-PAIR-A"));
  h.state.variants.B.set(next.variantBId, snapshot(next.variantBId, "NEW-PAIR-B"));
  const previousWrites = h.state.writes.length;
  await h.run();
  assert.equal(h.state.writes.length, previousWrites);
  assert.equal(h.sku("A", next.variantAId), "NEW-PAIR-A");
  assert.equal(h.sku("B", next.variantBId), "NEW-PAIR-B");
});

test("mapping feed outages prevent writes but do not retire existing pairs or consume pending edits", async () => {
  const h = fixture();
  await h.service.refresh();
  h.setSku("A", "WAIT-FOR-MAPPINGS");
  h.state.mappingFailure = Error("Fixture mapping response was malformed or unavailable.");
  await mayReportFailure(h.run);
  assert.equal(h.state.writes.length, 0);
  h.state.mappingFailure = null;
  await h.run();
  assert.equal(h.sku("B"), "WAIT-FOR-MAPPINGS");
});

test("new Cloudflare mappings appear automatically and establish a fresh non-destructive baseline", async () => {
  const h = fixture();
  await h.service.refresh();
  const added = mapping(2, 33, 44);
  h.state.mappings.push(added);
  h.state.variants.A.set(added.variantAId, snapshot(added.variantAId, "NEW-CA-OLD"));
  h.state.variants.B.set(added.variantBId, snapshot(added.variantBId, "NEW-MACRO-OLD"));
  await h.run();
  assert.equal(h.row(await h.service.refresh(), added.name).storeA?.sku, "NEW-CA-OLD");
  assert.equal(h.state.writes.length, 0);
  h.setSku("B", "NEW-PAIR-EDIT", added.variantBId);
  await h.run();
  assert.equal(h.sku("A", added.variantAId), "NEW-PAIR-EDIT");
  assert.equal(h.state.writes.length, 1);
});

test("remapping an existing Cloudflare ID resets its baseline without changing either new posting", async () => {
  const h = fixture();
  await h.service.refresh();
  const next = mapping(1, 33, 44);
  h.state.mappings = [next];
  h.state.variants.A.set(next.variantAId, snapshot(next.variantAId, "NEW-A"));
  h.state.variants.B.set(next.variantBId, snapshot(next.variantBId, "NEW-B"));
  await h.run(); await h.run();
  assert.equal(h.sku("A", next.variantAId), "NEW-A");
  assert.equal(h.sku("B", next.variantBId), "NEW-B");
  assert.equal(h.state.writes.length, 0);
  h.setSku("A", "LATER-REMAPPED-EDIT", next.variantAId);
  await h.run();
  assert.equal(h.sku("B", next.variantBId), "LATER-REMAPPED-EDIT");
});

test("inactive and removed mappings stop synchronization; reactivation initializes without overwriting", async () => {
  const h = fixture();
  await h.service.refresh();
  h.state.mappings[0].active = false;
  h.setSku("A", "EDIT-WHILE-PAUSED");
  await h.run();
  assert.equal(h.state.writes.length, 0);
  h.state.mappings[0].active = true;
  await h.run();
  assert.equal(h.sku("B"), "MACRO-OLD");
  assert.equal(h.state.writes.length, 0);
  h.state.mappings = [];
  h.setSku("B", "EDIT-WHILE-REMOVED");
  await h.run();
  assert.equal(h.state.writes.length, 0);
  h.state.mappings = [{ ...h.initial, active: true }];
  await h.run();
  assert.equal(h.state.writes.length, 0);
  h.setSku("B", "EDIT-AFTER-REACTIVATION");
  await h.run();
  assert.equal(h.sku("A"), "EDIT-AFTER-REACTIVATION");
});

test("overlapping active mappings cannot cause one changed SKU to overwrite multiple unrelated postings", async () => {
  const h = fixture();
  await h.service.refresh();
  const duplicate = mapping(2, 11, 44);
  h.state.mappings.push(duplicate);
  h.state.variants.B.set(duplicate.variantBId, snapshot(duplicate.variantBId, "UNRELATED"));
  h.setSku("A", "AMBIGUOUS-CHANGE");
  await mayReportFailure(h.run);
  assert.equal(h.state.writes.length, 0);
  assert.equal(h.sku("B"), "MACRO-OLD");
  assert.equal(h.sku("B", duplicate.variantBId), "UNRELATED");
});

test("concurrent service instances cannot both synchronize while one instance owns the shared lease", { timeout: 20_000 }, async () => {
  const h = fixture();
  await h.service.refresh();
  h.setSku("A", "SERIALIZED");
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  h.state.beforeWrite = async () => { entered(); await gate; };
  const first = h.run();
  await started;
  const second = createSkuSyncService(h.dependencies);
  try {
    await mayReportFailure(() => second.run());
    assert.equal(h.state.writes.length, 1, "A second instance must not submit another write.");
  } finally { release(); }
  await first;
  assert.equal(h.sku("B"), "SERIALIZED");
  assert.equal(h.state.writes.length, 1);
});

test("a worker that loses its lease during provider reads cannot write or clear a replacement owner's lock", { timeout: 20_000 }, async () => {
  const h = fixture();
  await h.service.refresh();
  h.setSku("A", "WAIT-FOR-OWNERSHIP");
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let pauseOnce = true;
  h.state.beforeRead = async side => {
    if (side === "A" && pauseOnce) { pauseOnce = false; entered(); await gate; }
  };
  const running = h.run();
  await started;
  const replacementToken = "replacement-test-owner";
  await db.skuSyncControl.update({ where: { id: h.dependencies.namespace }, data: {
    leaseToken: replacementToken, leaseUntil: new Date(h.dependencies.now().getTime() + 60 * 60_000),
  } });
  release();
  await running;
  assert.equal(h.state.writes.length, 0);
  assert.equal((await db.skuSyncControl.findUniqueOrThrow({ where: { id: h.dependencies.namespace } })).leaseToken, replacementToken);
  await db.skuSyncControl.update({ where: { id: h.dependencies.namespace }, data: { leaseToken: null, leaseUntil: null } });
  h.state.beforeRead = null;
  await h.run();
  assert.equal(h.sku("B"), "WAIT-FOR-OWNERSHIP", "The abandoned observation must not consume the real change.");
});

test("losing ownership during mapping import prevents later upserts, retirement and lease release", { timeout: 20_000 }, async () => {
  const h = fixture();
  const previousPair = mapping(2, 33, 44);
  h.state.mappings.push(previousPair);
  h.state.variants.A.set(previousPair.variantAId, snapshot(previousPair.variantAId, "PREVIOUS-A"));
  h.state.variants.B.set(previousPair.variantBId, snapshot(previousPair.variantBId, "PREVIOUS-B"));
  await h.service.refresh();
  const nextPair = mapping(3, 55, 66);
  h.state.mappings = [h.initial, nextPair];
  h.state.variants.A.set(nextPair.variantAId, snapshot(nextPair.variantAId, "NEXT-A"));
  h.state.variants.B.set(nextPair.variantBId, snapshot(nextPair.variantBId, "NEXT-B"));
  const replacementToken = "replacement-import-owner";
  let imported = 0;
  const delegate = new Proxy(db.skuSyncPair, {
    get(target, property, receiver) {
      if (property !== "upsert") return Reflect.get(target, property, receiver);
      return async (args: Parameters<typeof db.skuSyncPair.upsert>[0]) => {
        const result = await target.upsert(args);
        if (++imported === 1) {
          await db.skuSyncControl.update({ where: { id: h.dependencies.namespace }, data: {
            leaseToken: replacementToken, leaseUntil: new Date(h.dependencies.now().getTime() + 60 * 60_000),
          } });
        }
        return result;
      };
    },
  });
  const fencedDb = new Proxy(db, {
    get(target, property, receiver) {
      return property === "skuSyncPair" ? delegate : Reflect.get(target, property, receiver);
    },
  });
  const interrupted = createSkuSyncService({ ...h.dependencies, db: fencedDb });
  await interrupted.run();
  assert.equal(imported, 1, "An old owner cannot continue importing rows after ownership changes.");
  assert.equal(await db.skuSyncPair.findUnique({ where: { id: `${h.dependencies.namespace}:3` } }), null);
  const retained = await db.skuSyncPair.findUniqueOrThrow({ where: { id: `${h.dependencies.namespace}:2` } });
  assert.equal(retained.present, true, "An old owner cannot retire a previously imported pair.");
  assert.equal((await db.skuSyncControl.findUniqueOrThrow({ where: { id: h.dependencies.namespace } })).leaseToken, replacementToken);
  assert.equal(h.state.writes.length, 0);
});
