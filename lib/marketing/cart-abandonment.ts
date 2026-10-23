import { prisma } from "@/lib/prisma";
import { shopifyGraphql } from "./shopify";
import { Prisma } from "@/app/generated/prisma/client";
import { atomic, json, shop, type Tx } from "./store";
import { scopedMarketingSettings as marketingSettings } from "./settings";
import { setup } from "./delivery";
import { validateFlow } from "./flow-config";
import { cartMerchandiseBlock, type CartMerchandise } from "./cart-merchandise";
import { cartCheckoutKey, type CartLine } from "./cart";

/** Shopify's native abandonment, rather than a generic checkout update. */
export type CartAbandonment = { id: string; checkoutId: string; abandonedAt: string };
export const CART_ABANDONMENT_STATE_KEY = "cart-abandonment:v1";
const LIFETIME = 72 * 60 * 60 * 1000;
const RETRY = 5 * 60 * 1000;

type Candidate = {
  profileId: string;
  checkout: string;
  createdAt: string;
  url: string;
  lines?: CartLine[];
  observedAt: string;
  merchandise?: CartMerchandise;
  stagedAt: string;
  nextAttemptAt?: string;
  status: "PENDING" | "ADMITTED" | "IGNORED";
  reason?: string;
  abandonment?: CartAbandonment;
};
type NativeCheckout = {
  id: string;
  createdAt?: string;
  completedAt: string | null;
  abandonedCheckoutUrl: string;
  customer: { id: string; defaultEmailAddress: { emailAddress: string } | null } | null;
};
type NativeAbandonment = {
  id: string;
  createdAt: string;
  abandonmentType: string;
  customerHasNoOrderSinceAbandonment: boolean;
  abandonedCheckoutPayload: NativeCheckout | null;
};
type Confirmation = { data?: { abandonmentByAbandonedCheckoutId: NativeAbandonment | null } };
type Profile = { email: string | null; shopifyId: string | null };

// Schema and read-only examples verified against Shopify Admin 2026-07.
const CANDIDATES = `query CartAbandonmentCandidates($query: String!, $after: String) {
  abandonedCheckouts(first: 50, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
    nodes { id createdAt completedAt abandonedCheckoutUrl customer { id defaultEmailAddress { emailAddress } } }
    pageInfo { hasNextPage endCursor }
  }
}`;
const confirmationQuery = (name: string) => `query ${name}($id: ID!) {
  abandonmentByAbandonedCheckoutId(abandonedCheckoutId: $id) {
    id createdAt abandonmentType customerHasNoOrderSinceAbandonment
    abandonedCheckoutPayload { id completedAt abandonedCheckoutUrl customer { id defaultEmailAddress { emailAddress } } }
  }
}`;

function recoveryIdentity(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    url.hash = "";
    url.searchParams.delete("locale");
    url.searchParams.sort();
    return url.href;
  } catch { return null; }
}
function sameCheckout(a: string, b: string): boolean {
  const identity = recoveryIdentity(a);
  return !!identity && identity === recoveryIdentity(b);
}
function matchesProfile(checkout: NativeCheckout, profile: Profile): boolean {
  const customer = checkout.customer;
  if (!profile.email || !customer?.defaultEmailAddress?.emailAddress ||
    customer.defaultEmailAddress.emailAddress.trim().toLowerCase() !== profile.email.trim().toLowerCase()) return false;
  return !profile.shopifyId || customer.id === `gid://shopify/Customer/${profile.shopifyId.replace(/^gid:\/\/shopify\/Customer\//, "")}`;
}
function nativeBlock(native: NativeAbandonment | null, url: string, profile: Profile): string | null {
  if (!native?.abandonedCheckoutPayload) return "Shopify has not confirmed this abandoned checkout";
  const checkout = native.abandonedCheckoutPayload;
  if (native.abandonmentType !== "CHECKOUT") return "Shopify has not confirmed a checkout abandonment";
  if (!sameCheckout(checkout.abandonedCheckoutUrl, url) || !matchesProfile(checkout, profile))
    return "Shopify abandoned checkout identity does not match this recipient";
  if (checkout.completedAt || native.customerHasNoOrderSinceAbandonment !== true) return "Checkout completed or customer has ordered";
  return null;
}
async function within<T>(work: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw Error("Shopify abandonment verification timed out; retry required");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error("Shopify abandonment verification timed out; retry required")), remaining);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
async function gates(tx: Tx) {
  const [flow, settingsRow] = await Promise.all([
    tx.marketingResource.findUnique({ where: { shop_kind_key: { shop: shop(), kind: "FLOW", key: "abandoned-cart" } } }),
    tx.marketingResource.findUnique({ where: { shop_kind_key: { shop: shop(), kind: "SETTINGS", key: "global" } } }),
  ]);
  const settings = marketingSettings(settingsRow?.data);
  const config = setup(settings.operations, settings.postalAddress);
  if (!flow?.enabled || !config.sendingEnabled || !config.ingestEnabled || !config.migrationConfirmed || !config.emailReady) return null;
  const f = validateFlow("abandoned-cart", flow.data);
  return f.reviewed && f.cart ? f : null;
}

/** One compact candidate per checkout. Generic updates never move its first-seen time. */
export async function stageCartAbandonment(tx: Tx, input: {
  profileId: string; checkout: string; createdAt: Date; url: string;
  lines?: CartLine[]; observedAt: Date; merchandise?: CartMerchandise;
}) {
  const now = new Date();
  if (!Number.isFinite(+input.createdAt) || !Number.isFinite(+input.observedAt) ||
    +input.createdAt > +now || +input.observedAt > +now) return;
  const flow = await tx.marketingResource.findUnique({ where: { shop_kind_key: { shop: shop(), kind: "FLOW", key: "abandoned-cart" } } });
  if (!flow?.enabled) return;
  const config = validateFlow("abandoned-cart", flow.data);
  if (!config.reviewed || !config.cart) return;
  const key = cartCheckoutKey(input.profileId, input.checkout);
  const existing = await tx.marketingResource.findUnique({ where: { shop_kind_key: { shop: shop(), kind: "CART_CANDIDATE", key } } });
  const saved = existing?.data as Candidate | undefined;
  if (saved && +input.observedAt <= +new Date(saved.observedAt)) return;
  const merchandise = input.merchandise !== undefined ? input.merchandise
    : input.lines === undefined ? saved?.merchandise : undefined;
  const reason = cartMerchandiseBlock(merchandise, Math.round((config.cart?.minimumSubtotal ?? 100) * 100));
  if (reason && !existing) return;
  const data: Candidate = {
    profileId: input.profileId, checkout: input.checkout,
    createdAt: new Date(Math.min(+input.createdAt, saved?.createdAt && Number.isFinite(+new Date(saved.createdAt)) ? +new Date(saved.createdAt) : +input.createdAt)).toISOString(),
    url: input.url, observedAt: input.observedAt.toISOString(), merchandise,
    stagedAt: saved?.stagedAt || now.toISOString(), nextAttemptAt: now.toISOString(),
    ...(input.lines !== undefined ? { lines: input.lines.slice(0, 100).map(line => ({
      product_id: line.product_id, variant_id: line.variant_id, quantity: line.quantity,
      ...(typeof line.title === "string" ? { title: line.title.slice(0, 200) } : {}),
    })) } : saved?.lines ? { lines: saved.lines } : {}),
    status: saved?.status === "ADMITTED" ? "ADMITTED" : reason ? "IGNORED" : "PENDING",
    ...(saved?.abandonment ? { abandonment: saved.abandonment } : {}),
    ...(reason ? { reason } : {}),
  };
  await tx.marketingResource.upsert({ where: { shop_kind_key: { shop: shop(), kind: "CART_CANDIDATE", key } },
    create: { shop: shop(), kind: "CART_CANDIDATE", key, name: "Shopify abandonment verification", enabled: data.status === "PENDING", data: json(data) },
    update: { enabled: data.status === "PENDING", data: json(data) } });
}

/** Read-only setup probe using the same native resource required by recovery. */
export async function verifyCartAbandonmentAccess(): Promise<void> {
  const response = await shopifyGraphql<{ data?: { abandonedCheckouts?: { nodes: { id: string }[] } } }>(
    `query CartAbandonmentReadiness { abandonedCheckouts(first: 1) { nodes { id } pageInfo { hasNextPage endCursor } } }`,
  );
  if (!response.data?.abandonedCheckouts?.nodes) throw Error("Shopify abandoned checkout access could not be verified");
  const first = response.data.abandonedCheckouts.nodes[0];
  if (first) {
    const confirmation = await shopifyGraphql<Confirmation>(confirmationQuery("CartAbandonmentConfirmation"), { id: first.id });
    if (!confirmation.data || !("abandonmentByAbandonedCheckoutId" in confirmation.data))
      throw Error("Shopify native abandonment access could not be verified");
  }
}

/** Authoritative remote check; local send authorization still runs afterward. */
export async function checkCartAbandonment(run: { abandonment?: CartAbandonment; url: string; profileId?: string }): Promise<string | null> {
  if (!run.abandonment || !run.profileId) return "Checkout abandonment has not been verified";
  const profile = await prisma.marketingProfile.findFirst({ where: { id: run.profileId, shop: shop() }, select: { email: true, shopifyId: true } });
  if (!profile) return "Checkout recipient is unavailable";
  const result = await shopifyGraphql<Confirmation>(confirmationQuery("CartAbandonmentCheck"), { id: run.abandonment.checkoutId });
  if (!result.data || !("abandonmentByAbandonedCheckoutId" in result.data)) throw Error("Shopify abandonment verification response is unavailable");
  const native = result.data.abandonmentByAbandonedCheckoutId;
  const blocked = nativeBlock(native, run.url, profile);
  if (blocked) return blocked;
  if (native!.id !== run.abandonment.id || native!.abandonedCheckoutPayload!.id !== run.abandonment.checkoutId ||
    +new Date(native!.createdAt) !== +new Date(run.abandonment.abandonedAt)) return "Shopify abandonment has changed; recovery was stopped";
  return null;
}

/** Bounded native classification checks never poison the shared Shopify inbox. */
export async function syncCartAbandonments(): Promise<{ checked: number; admitted: number; ignored: number; error?: string; skipped?: string }> {
  const result = { checked: 0, admitted: 0, ignored: 0 };
  const now = new Date(), deadline = +now + 20000;
  const stateWhere = { shop: shop(), kind: "SYSTEM", key: CART_ABANDONMENT_STATE_KEY };
  const state = await prisma.marketingResource.upsert({ where: { shop_kind_key: stateWhere },
    create: { ...stateWhere, name: "Shopify abandoned checkout verification", data: { cutoverAt: now.toISOString() } }, update: {} });
  const stateData = state.data as { cutoverAt: string; checkedAt?: string; error?: string };
  const cutoverAt = new Date(stateData.cutoverAt);
  if (!Number.isFinite(+cutoverAt)) return { ...result, error: "Shopify abandonment cutover is invalid" };
  if (!await atomic(tx => gates(tx))) return { ...result, skipped: "Abandoned Cart is paused or setup is incomplete" };
  const rows = await prisma.marketingResource.findMany({ where: {
    shop: shop(), kind: "CART_CANDIDATE", enabled: true,
    OR: [
      { data: { path: ["nextAttemptAt"], lte: now.toISOString() } },
      { data: { path: ["nextAttemptAt"], equals: Prisma.AnyNull } },
    ],
  }, orderBy: { updatedAt: "asc" }, take: 25 });
  try {
    for (const row of rows) {
      if (Date.now() >= deadline) break;
      const candidate = row.data as Candidate;
      if (candidate.nextAttemptAt && +new Date(candidate.nextAttemptAt) > Date.now()) continue;
      let reason: string | undefined, proof: CartAbandonment | undefined;
      const profile = await prisma.marketingProfile.findFirst({ where: { id: candidate.profileId, shop: shop() }, select: { email: true, shopifyId: true } });
      if (!profile?.email) reason = "Checkout recipient is unavailable";
      else if (!Number.isFinite(+new Date(candidate.stagedAt)) || +new Date(candidate.stagedAt) + LIFETIME <= Date.now()) reason = "Shopify did not confirm this abandonment before it expired";
      else {
        result.checked++;
        let checkout: NativeCheckout | undefined, after: string | undefined;
        const cursors = new Set<string>();
        for (let page = 0; page < 4 && !checkout; page++) {
          const response = await within(shopifyGraphql<{ data?: { abandonedCheckouts: { nodes: NativeCheckout[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } }>(CANDIDATES,
            { query: `"${profile.email.replace(/["\\]/g, "\\$&")}"`, ...(after ? { after } : {}) }), deadline);
          const connection = response.data?.abandonedCheckouts;
          if (!connection?.nodes || !connection.pageInfo) throw Error("Shopify abandoned checkout list is unavailable; retry required");
          const matchingUrl = connection.nodes.find(value => sameCheckout(value.abandonedCheckoutUrl, candidate.url));
          if (matchingUrl) {
            if (!matchesProfile(matchingUrl, profile)) reason = "Shopify abandoned checkout identity does not match this recipient";
            else checkout = matchingUrl;
            break;
          }
          if (!connection.pageInfo.hasNextPage) break;
          const cursor = connection.pageInfo.endCursor;
          if (!cursor || cursors.has(cursor)) throw Error("Shopify abandoned checkout pagination is incomplete; retry required");
          cursors.add(cursor); after = cursor;
        }
        if (checkout) {
          const response = await within(shopifyGraphql<Confirmation>(confirmationQuery("CartAbandonmentConfirmation"), { id: checkout.id }), deadline);
          if (!response.data || !("abandonmentByAbandonedCheckoutId" in response.data)) throw Error("Shopify abandonment confirmation is unavailable; retry required");
          const native = response.data.abandonmentByAbandonedCheckoutId;
          if (native) {
            reason = nativeBlock(native, candidate.url, profile) || undefined;
            const abandonedAt = new Date(native.createdAt);
            if (!reason && (native.abandonedCheckoutPayload?.id !== checkout.id || !Number.isFinite(+abandonedAt))) reason = "Shopify abandonment details could not be verified";
            if (!reason && +abandonedAt < +cutoverAt) reason = "Existing abandonment predates the corrected flow";
            if (!reason && +abandonedAt > Date.now()) reason = "Shopify abandonment timestamp is in the future";
            if (!reason && +abandonedAt + LIFETIME <= Date.now()) reason = "Shopify abandoned checkout expired";
            if (!reason) proof = { id: native.id, checkoutId: checkout.id, abandonedAt: abandonedAt.toISOString() };
          }
        }
      }
      const outcome = await atomic(async tx => {
        const fresh = await tx.marketingResource.findUnique({ where: { id: row.id } });
        if (!fresh?.enabled || +fresh.updatedAt !== +row.updatedAt) return;
        const flow = await gates(tx);
        if (!flow) return;
        const currentProfile = await tx.marketingProfile.findFirst({ where: { id: candidate.profileId, shop: shop() }, select: { email: true, shopifyId: true } });
        if (profile && (!currentProfile || currentProfile.email !== profile.email || currentProfile.shopifyId !== profile.shopifyId)) return;
        const minimum = cartMerchandiseBlock(candidate.merchandise, Math.round((flow.cart?.minimumSubtotal ?? 100) * 100));
        if (minimum) reason = minimum;
        if (!reason && proof) {
          const { enrollCart } = await import("./cart");
          const admitted = await enrollCart(tx, candidate.profileId, candidate.checkout, new Date(candidate.createdAt), flow,
            candidate.url, candidate.lines, new Date(candidate.observedAt), candidate.merchandise, proof);
          if (!admitted) reason = "Checkout recovery was already handled, replaced or stopped";
        }
        const data: Candidate = { ...candidate,
          status: reason ? "IGNORED" : proof ? "ADMITTED" : "PENDING",
          ...(reason ? { reason } : {}), ...(proof ? { abandonment: proof } : {}),
          ...(!reason && !proof ? { nextAttemptAt: new Date(Date.now() + RETRY).toISOString() } : {}) };
        await tx.marketingResource.update({ where: { id: row.id }, data: { enabled: !reason && !proof, data: json(data) } });
        return reason ? "ignored" : proof ? "admitted" : undefined;
      });
      if (outcome === "admitted") result.admitted++;
      if (outcome === "ignored") result.ignored++;
    }
    await prisma.marketingResource.update({ where: { id: state.id }, data: { data: json({ cutoverAt: stateData.cutoverAt, checkedAt: new Date().toISOString() }) } });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shopify abandonment verification failed; retry required";
    await prisma.marketingResource.update({ where: { id: state.id }, data: { data: json({ cutoverAt: stateData.cutoverAt, checkedAt: new Date().toISOString(), error: message }) } });
    return { ...result, error: message };
  }
}
