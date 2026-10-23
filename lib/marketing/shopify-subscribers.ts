import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { currentMarketingBrand, marketingEnv } from "./context";
import { shopifyGraphql } from "./shopify";
import { applyMacroShopifyConsent, macroShopifySnapshotCurrent, macroSubscriberList } from "./macro-subscriber-eligibility";
import { email } from "./rules";
import { atomic, consent, identify, json, shop, type Tx } from "./store";

type Issue = { customerId: string; email?: string; error: string };
type Sync = {
  phase: "customers" | "complete";
  running: boolean;
  cursor?: string;
  checked: number;
  imported: number;
  updated: number;
  suppressed: number;
  skipped: number;
  errors: number;
  issues: Issue[];
  startedAt: string;
  completedAt?: string;
  lastBatchAt?: string;
  leaseOwner?: string;
  leaseUntil?: string;
  error?: string;
};
type Customer = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  updatedAt: string;
  defaultEmailAddress: { emailAddress: string; marketingState: string; marketingUpdatedAt: string | null } | null;
};
type Response = { data?: { customers?: { nodes: Customer[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } };
const query = `query MarketingShopifySubscribers($after: String) {
  customers(first: 100, after: $after, sortKey: ID) {
    nodes { id firstName lastName updatedAt defaultEmailAddress { emailAddress marketingState marketingUpdatedAt } }
    pageInfo { hasNextPage endCursor }
  }
}`;
const where = () => ({ shop: shop(), kind: "SHOPIFY_SUBSCRIBER_SYNC", key: "customers" });
const configured = () => !!(marketingEnv("SHOPIFY_CLIENT_ID") && marketingEnv("SHOPIFY_CLIENT_SECRET"));
const assertMacro = () => {
  if (currentMarketingBrand() !== "macroalgae-farms") throw Error("Shopify subscriber sync is available in Macroalgae Farms.");
};
const observedAt = (customer: Customer, checkedAt: string) => {
  const source = Date.parse(customer.updatedAt);
  return Number.isFinite(source) && source <= Date.parse(checkedAt) ? new Date(source).toISOString() : checkedAt;
};

export async function shopifySubscriberStatus() {
  assertMacro();
  const resource = await prisma.marketingResource.findUnique({ where: { shop_kind_key: where() } });
  const state = resource?.data as Sync | undefined;
  return {
    configured: configured(), phase: state?.phase || "not-started", running: state?.running === true,
    checked: state?.checked || 0, imported: state?.imported || 0, updated: state?.updated || 0,
    suppressed: state?.suppressed || 0, skipped: state?.skipped || 0, errors: state?.errors || 0,
    issues: state?.issues || [], startedAt: state?.startedAt, completedAt: state?.completedAt,
    lastBatchAt: state?.lastBatchAt, error: state?.error,
  };
}
export type ShopifySubscriberSyncStatus = Awaited<ReturnType<typeof shopifySubscriberStatus>>;

export async function setShopifySubscriberSyncRunning(running: boolean) {
  assertMacro();
  if (running && !configured()) throw Error("Configure the Macroalgae Farms Shopify connection before syncing subscribers.");
  await atomic(async tx => {
    const row = await tx.marketingResource.findUnique({ where: { shop_kind_key: where() } });
    const old = row?.data as Sync | undefined;
    const next: Sync = !old || (running && old.phase === "complete")
      ? { phase: "customers", running, checked: 0, imported: 0, updated: 0, suppressed: 0, skipped: 0, errors: 0,
          issues: [], startedAt: new Date().toISOString() }
      : { ...old, running };
    if (running) delete next.error;
    await tx.marketingResource.upsert({ where: { shop_kind_key: where() },
      create: { ...where(), name: "Shopify email subscriber sync", data: json(next) }, update: { data: json(next) } });
  });
  return shopifySubscriberStatus();
}

async function blockConflictingIdentity(tx: Tx, customer: Customer, address: string, checkedAt: string) {
  const shopifyId = customer.id.replace(/^gid:\/\/shopify\/Customer\//, "");
  const matches = await tx.marketingProfile.findMany({ where: { shop: shop(), OR: [{ email: address }, { shopifyId }] } });
  for (const profile of matches) await tx.marketingProfile.update({ where: { id: profile.id }, data: {
    lists: profile.lists.filter(list => list !== macroSubscriberList),
    properties: json({ ...(profile.properties as object), shopifyEmailConsent: { state: "IDENTITY_REVIEW", checkedAt, occurredAt: observedAt(customer, checkedAt) } }),
  } });
}

async function importCustomer(tx: Tx, customer: Customer, state: Sync, checkedAt: string, lookupStartedAt: Date) {
  state.checked++;
  if (!/^gid:\/\/shopify\/Customer\/\d+$/.test(customer.id)) throw Error("Shopify returned an invalid customer ID.");
  const shopifyId = customer.id.replace(/^gid:\/\/shopify\/Customer\//, "");
  let address: string;
  try { address = email(customer.defaultEmailAddress?.emailAddress); } catch {
    const existing = await tx.marketingProfile.findFirst({ where: { shop: shop(), shopifyId } });
    if (existing) {
      if (!macroShopifySnapshotCurrent(existing.properties, new Date(observedAt(customer, checkedAt)), lookupStartedAt)) { state.skipped++; return; }
      await tx.marketingProfile.update({ where: { id: existing.id }, data: {
        lists: existing.lists.filter(list => list !== macroSubscriberList),
        properties: json({ ...(existing.properties as object), shopifyEmailConsent: { state: "NO_VALID_EMAIL", checkedAt, occurredAt: observedAt(customer, checkedAt) } }),
      } });
      state.updated++;
    } else state.skipped++;
    return;
  }
  const marketing = customer.defaultEmailAddress!;
  const status = String(marketing.marketingState || "UNKNOWN").toUpperCase();
  const existing = await tx.marketingProfile.findFirst({ where: { shop: shop(), OR: [{ email: address }, { shopifyId }] } });
  if (!existing && status !== "SUBSCRIBED") { state.skipped++; return; }
  const consentAt = marketing.marketingUpdatedAt ? new Date(marketing.marketingUpdatedAt) : null;
  const sourceAt = consentAt && Number.isFinite(+consentAt) && +consentAt <= Date.now() ? consentAt : new Date(observedAt(customer, checkedAt));
  if (existing && !macroShopifySnapshotCurrent(existing.properties, sourceAt, lookupStartedAt)) { state.skipped++; return; }
  if (status === "SUBSCRIBED" && (!consentAt || !Number.isFinite(+consentAt) || +consentAt > Date.now())) {
    state.errors++;
    if (state.issues.length < 20) state.issues.push({ customerId: shopifyId, email: address, error: "Subscribed consent date is missing or invalid." });
    // Do not create or authorize a new contact without dated consent evidence.
    if (existing) await tx.marketingProfile.update({ where: { id: existing.id }, data: {
      lists: existing.lists.filter(list => list !== macroSubscriberList),
      properties: json({ ...(existing.properties as object), shopifyEmailConsent: { state: "CONSENT_REVIEW", checkedAt, occurredAt: observedAt(customer, checkedAt) } }),
    } });
    return;
  }
  let profile;
  try { profile = await identify(tx, { email: address, shopifyId, name: [customer.firstName, customer.lastName].filter(Boolean).join(" ") }); }
  catch (error) {
    await blockConflictingIdentity(tx, customer, address, checkedAt);
    state.errors++;
    if (state.issues.length < 20) state.issues.push({ customerId: shopifyId, email: address,
      error: error instanceof Error ? error.message : "Customer identity needs review." });
    return;
  }
  if (status === "SUBSCRIBED" || status === "UNSUBSCRIBED") await consent(tx, profile.id, "EMAIL", status, "shopify",
    consentAt && Number.isFinite(+consentAt) && +consentAt <= Date.now() ? consentAt : new Date(checkedAt), undefined, false);
  const current = await tx.marketingConsent.findUnique({ where: { profileId_channel: { profileId: profile.id, channel: "EMAIL" } } });
  await applyMacroShopifyConsent(tx, profile.id, status,
    Number.isFinite(+sourceAt) && +sourceAt <= Date.now() ? sourceAt : new Date(checkedAt),
    { authoritative: true, checkedAt: new Date(checkedAt), lookupStartedAt });
  if (current?.suppressed) state.suppressed++;
  if (existing) state.updated++; else state.imported++;
}

/** One compact Shopify page per worker run; never enrolls or sends a flow. */
export async function syncShopifySubscribers(): Promise<ShopifySubscriberSyncStatus> {
  assertMacro();
  const state = await atomic(async tx => {
    const row = await tx.marketingResource.findUnique({ where: { shop_kind_key: where() } });
    const old = row?.data as Sync | undefined;
    if (!old?.running || old.phase === "complete" || (old.leaseUntil && new Date(old.leaseUntil) > new Date())) return null;
    const next: Sync = { ...old, issues: [...old.issues], leaseOwner: randomUUID(), leaseUntil: new Date(Date.now() + 300000).toISOString() };
    await tx.marketingResource.update({ where: { id: row!.id }, data: { data: json(next) } });
    return next;
  });
  if (!state) return shopifySubscriberStatus();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const lookupStartedAt = new Date();
    const result = await Promise.race([
      shopifyGraphql<Response>(query, { after: state.cursor || null }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("Shopify subscriber lookup timed out. Continue to retry this page.")), 20000); }),
    ]);
    const connection = result.data?.customers;
    if (!connection || !Array.isArray(connection.nodes) || !connection.pageInfo || connection.nodes.length > 100)
      throw Error("Shopify subscriber response is incomplete. Continue to retry this page.");
    const cursor = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : undefined;
    if (connection.pageInfo.hasNextPage && (!cursor || cursor === state.cursor)) throw Error("Shopify subscriber pagination did not advance.");
    await atomic(async tx => {
      const row = await tx.marketingResource.findUniqueOrThrow({ where: { shop_kind_key: where() } });
      const saved = row.data as Sync;
      if (saved.leaseOwner !== state.leaseOwner) return;
      const next: Sync = { ...state, issues: [...state.issues] };
      const checkedAt = new Date().toISOString();
      for (const customer of connection.nodes) await importCustomer(tx, customer, next, checkedAt, lookupStartedAt);
      next.cursor = cursor || undefined;
      next.lastBatchAt = checkedAt;
      next.running = saved.running;
      if (!cursor) {
        // Only a complete successful sweep can remove a customer missing from Shopify.
        // A paused or failed page never prunes unseen members.
        await tx.$executeRaw(Prisma.sql`UPDATE "MarketingProfile"
          SET lists = array_remove(lists, ${macroSubscriberList}),
            properties = jsonb_set(COALESCE(properties, '{}'::jsonb), '{shopifyEmailConsent}',
              ${JSON.stringify({ state: "NOT_FOUND", checkedAt, occurredAt: checkedAt })}::jsonb)
          WHERE shop = ${shop()} AND ${macroSubscriberList} = ANY(lists)
            AND properties->'shopifyEmailConsent'->>'checkedAt' < ${next.startedAt}`);
        next.phase = "complete"; next.running = false; next.completedAt = checkedAt;
      }
      delete next.leaseOwner; delete next.leaseUntil; delete next.error;
      await tx.marketingResource.update({ where: { id: row.id }, data: { data: json(next) } });
    });
  } catch (error) {
    await atomic(async tx => {
      const row = await tx.marketingResource.findUniqueOrThrow({ where: { shop_kind_key: where() } });
      const saved = row.data as Sync;
      if (saved.leaseOwner !== state.leaseOwner) return;
      const next = { ...saved, running: false, error: error instanceof Error ? error.message : "Shopify subscriber sync paused." };
      delete next.leaseOwner; delete next.leaseUntil;
      await tx.marketingResource.update({ where: { id: row.id }, data: { data: json(next) } });
    });
  } finally { if (timer) clearTimeout(timer); }
  return shopifySubscriberStatus();
}
