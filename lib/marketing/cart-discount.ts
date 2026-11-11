import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { json, shop } from "./store";
import { shopifyGraphql } from "./shopify";
import type { SavedDiscount } from "./discounts";
import { ShopifyRequestNotExecutedError } from "@/lib/shopify-request-error";

export type SavedCartDiscount = SavedDiscount & {
  version: 2;
  profileId: string;
  recipientEmail: string;
  percentage: 10 | 15;
  creationAttemptedAt?: string;
  creationAttemptId?: string;
  creationRejectedAttemptId?: string;
};

/** A known unusable offer stops this recovery run rather than minting another code. */
export class CartDiscountStopped extends Error {}

const LOOKUP = `query CartRecoveryDiscountLookup($code: String!) {
  codeDiscountNodeByCode(code: $code) {
    id
    codeDiscount {
      __typename
      ... on DiscountCodeBasic {
        title startsAt endsAt status asyncUsageCount usageLimit appliesOncePerCustomer
        minimumRequirement { __typename }
        context { __typename }
        combinesWith { orderDiscounts productDiscounts shippingDiscounts }
        customerGets {
          items { __typename ... on AllDiscountItems { allItems } }
          value { __typename ... on DiscountPercentage { percentage } }
        }
      }
    }
  }
}`;
const CREATE = `mutation CartRecoveryDiscountCreate($input: DiscountCodeBasicInput!) {
  discountCodeBasicCreate(basicCodeDiscount: $input) {
    codeDiscountNode { id }
    userErrors { message }
  }
}`;
const UPGRADE = `mutation CartRecoveryDiscountUpgrade($id: ID!, $input: DiscountCodeBasicInput!) {
  discountCodeBasicUpdate(id: $id, basicCodeDiscount: $input) {
    codeDiscountNode { id }
    userErrors { message }
  }
}`;

type RemoteDiscount = {
  id: string;
  codeDiscount: {
    __typename?: string;
    title?: string;
    startsAt?: string;
    endsAt?: string | null;
    status?: string;
    asyncUsageCount?: number;
    usageLimit?: number | null;
    appliesOncePerCustomer?: boolean;
    minimumRequirement?: unknown;
    context?: { __typename?: string };
    combinesWith?: { orderDiscounts: boolean; productDiscounts: boolean; shippingDiscounts: boolean };
    customerGets?: {
      items?: { __typename?: string; allItems?: boolean };
      value?: { __typename?: string; percentage?: number };
    };
  };
};
type MutationResult = {
  codeDiscountNode?: { id: string } | null;
  userErrors?: { message: string }[];
};
const inFlight = new Map<string, Promise<SavedCartDiscount>>();

/** One code for the complete run, including retries; only its percentage can increase. */
export async function ensureCartDiscount(runKey: string, profileId: string, percentage: 10 | 15, couponHours = 168): Promise<SavedCartDiscount> {
  if (![10, 15].includes(percentage) || !Number.isFinite(couponHours) || couponHours < 1 || couponHours > 8760)
    throw new CartDiscountStopped("Recovery discount settings need review");
  const lockKey = shop() + ":" + runKey;
  const previous = inFlight.get(lockKey);
  const work = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(() => ensure(runKey, profileId, percentage, couponHours));
  inFlight.set(lockKey, work);
  try { return await work; }
  finally { if (inFlight.get(lockKey) === work) inFlight.delete(lockKey); }
}

async function runOwner(runKey: string, profileId: string, percentage: 10 | 15) {
  const tenant = shop(), stage = percentage === 10 ? "discount10" : "discount15";
  const [run, active, profile, message, previous] = await Promise.all([
    prisma.marketingResource.findUnique({ where: { shop_kind_key: { shop: tenant, kind: "CART_RUN", key: runKey } } }),
    prisma.marketingResource.findUnique({ where: { shop_kind_key: { shop: tenant, kind: "CART_ACTIVE", key: profileId } } }),
    prisma.marketingProfile.findFirst({ where: { shop: tenant, id: profileId }, select: { email: true, lastOrderAt: true } }),
    prisma.marketingMessage.findFirst({ where: { shop: tenant, key: runKey + ":" + stage, profileId,
      flowKey: "abandoned-cart", channel: "EMAIL", flowCondition: "cart-v2:" + stage } }),
    prisma.marketingMessage.findFirst({ where: { shop: tenant, key: runKey + (percentage === 10 ? ":first" : ":discount10"),
      profileId, flowKey: "abandoned-cart", channel: "EMAIL" } }),
  ]);
  const saved = run?.data as { sequenceVersion?: number; profileId?: string; completedAt?: string; empty?: boolean;
    stockStoppedAt?: string; eligibilityStopped?: string; stop?: string } | undefined;
  if (!saved || saved.sequenceVersion !== 2 || saved.profileId !== profileId ||
      (active?.data as { runKey?: string } | undefined)?.runKey !== runKey || !profile?.email)
    throw new CartDiscountStopped("Recovery discount ownership changed");
  if (saved.completedAt || saved.empty || saved.stockStoppedAt || saved.eligibilityStopped || saved.stop)
    throw new CartDiscountStopped("Checkout recovery has stopped");
  if (profile.lastOrderAt) throw new CartDiscountStopped("Cart offers are only for customers with no previous orders");
  if (message?.status !== "SENDING") throw new CartDiscountStopped("Recovery offer is no longer sending");
  if (previous?.status !== "SENT" || !previous.sentAt)
    throw new CartDiscountStopped("The previous recovery email was not sent");
  return profile.email;
}

async function lookup(code: string) {
  const response = await shopifyGraphql<{ data?: { codeDiscountNodeByCode?: RemoteDiscount | null } }>(LOOKUP, { code });
  if (!response.data || !("codeDiscountNodeByCode" in response.data)) throw Error("Recovery discount lookup unavailable");
  return response.data.codeDiscountNodeByCode || null;
}

function verified(remote: RemoteDiscount, saved: SavedCartDiscount, title: string): 10 | 15 {
  const discount = remote.codeDiscount, actual = discount.customerGets?.value?.percentage;
  if (discount.__typename !== "DiscountCodeBasic" || discount.title !== title ||
      (saved.discountId && remote.id !== saved.discountId))
    throw new CartDiscountStopped("Recovery discount ownership changed");
  if (typeof discount.asyncUsageCount !== "number" || !Number.isSafeInteger(discount.asyncUsageCount) || discount.asyncUsageCount < 0)
    throw Error("Recovery discount usage could not be verified");
  if (discount.asyncUsageCount > 0) throw new CartDiscountStopped("Recovery discount was already used");
  if (discount.status === "EXPIRED" || +new Date(saved.endsAt) <= Date.now())
    throw new CartDiscountStopped("Recovery discount expired");
  if (discount.status !== "ACTIVE" || +new Date(discount.startsAt || "") !== +new Date(saved.startsAt) ||
      +new Date(discount.endsAt || "") !== +new Date(saved.endsAt) || discount.usageLimit !== 1 ||
      discount.appliesOncePerCustomer !== true || discount.minimumRequirement !== null ||
      discount.context?.__typename !== "DiscountBuyerSelectionAll" ||
      discount.customerGets?.items?.__typename !== "AllDiscountItems" || discount.customerGets.items.allItems !== true ||
      !discount.combinesWith || Object.values(discount.combinesWith).some(value => value !== false) ||
      discount.customerGets?.value?.__typename !== "DiscountPercentage" || (actual !== 0.1 && actual !== 0.15))
    throw new CartDiscountStopped("Recovery discount was changed; review required");
  const percentage = actual === 0.1 ? 10 : 15;
  if (percentage < saved.percentage) throw new CartDiscountStopped("Recovery discount was reduced; review required");
  return percentage;
}

async function ensure(runKey: string, profileId: string, percentage: 10 | 15, couponHours: number): Promise<SavedCartDiscount> {
  const recipientEmail = await runOwner(runKey, profileId, percentage);
  const where = { shop: shop(), kind: "CART_COUPON", key: runKey };
  let row = await prisma.marketingResource.findUnique({ where: { shop_kind_key: where } });
  if (!row) {
    if (percentage !== 10) throw new CartDiscountStopped("The initial recovery discount is missing");
    // Whole seconds match Shopify's DateTime representation exactly.
    const startsAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const code = "CART-" + Array.from(crypto.randomBytes(12), value => alphabet[value % alphabet.length]).join("");
    row = await prisma.marketingResource.upsert({ where: { shop_kind_key: where },
      create: { ...where, name: "Shared cart recovery offer", data: {
        version: 2, profileId, recipientEmail, code, percentage: 10, startsAt: startsAt.toISOString(),
        endsAt: new Date(+startsAt + couponHours * 3600000).toISOString(),
      } }, update: {} });
  }
  const allocationId = row.id;
  let saved = row.data as SavedCartDiscount;
  if (!saved || typeof saved !== "object" || Array.isArray(saved) || saved.version !== 2 || saved.profileId !== profileId || saved.recipientEmail !== recipientEmail ||
      !/^CART-[A-Z2-9]{12}$/.test(saved.code) || ![10, 15].includes(saved.percentage) ||
      !Number.isFinite(+new Date(saved.startsAt)) || !Number.isFinite(+new Date(saved.endsAt)) ||
      +new Date(saved.endsAt) <= +new Date(saved.startsAt))
    throw new CartDiscountStopped("Recovery discount allocation needs review");
  if (+new Date(saved.endsAt) <= Date.now()) throw new CartDiscountStopped("Recovery discount expired");
  const title = "Reef Ops Cart Recovery " + runKey;
  const persist = async (next: SavedCartDiscount) => {
    const changed = await prisma.marketingResource.updateMany({ where: { id: allocationId, shop: shop(), data: { equals: json(saved) } }, data: { data: json(next) } });
    if (!changed.count) throw Error("Recovery discount allocation changed; retry verification");
    saved = next;
  };
  const releaseRejectedCreation = async () => {
    const retryable = { ...saved };
    delete retryable.creationAttemptedAt;
    delete retryable.creationAttemptId;
    delete retryable.creationRejectedAttemptId;
    await persist(retryable);
  };
  const reconcileRejectedCreation = async () => {
    await persist({ ...saved, creationRejectedAttemptId: saved.creationAttemptId });
    const found = await lookup(saved.code);
    if (!found) await releaseRejectedCreation();
    return found;
  };
  let remote = await lookup(saved.code);
  if (!remote) {
    if (saved.discountId) throw new CartDiscountStopped("Recovery discount was removed");
    // An uncertain create must be reconciled by code, never recreated after possible deletion/use.
    if (saved.creationAttemptedAt) {
      if (!saved.creationAttemptId || saved.creationRejectedAttemptId !== saved.creationAttemptId)
        throw Error("Recovery discount creation is awaiting verification");
      // A previous known rejection can survive a temporary reconciliation outage.
      await releaseRejectedCreation();
    }
    if (percentage !== 10) throw new CartDiscountStopped("The initial recovery discount is missing");
    if (await runOwner(runKey, profileId, percentage) !== recipientEmail) throw new CartDiscountStopped("Recovery discount ownership changed");
    await persist({ ...saved, creationAttemptedAt: new Date().toISOString(), creationAttemptId: crypto.randomUUID() });
    let response: { data?: { discountCodeBasicCreate?: MutationResult } } | undefined;
    try {
      response = await shopifyGraphql<{ data?: { discountCodeBasicCreate?: MutationResult } }>(CREATE, { input: {
        title, code: saved.code, context: { all: "ALL" }, startsAt: saved.startsAt, endsAt: saved.endsAt,
        customerGets: { value: { percentage: 0.1 }, items: { all: true } },
        combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false },
        usageLimit: 1, appliesOncePerCustomer: true,
      } });
    } catch (error) {
      // Only the transport's explicit pre-execution proof permits a retry.
      // A timeout/network failure after POST remains an uncertain creation.
      if (!(error instanceof ShopifyRequestNotExecutedError)) throw error;
      remote = await reconcileRejectedCreation();
      if (!remote) throw error;
    }
    if (!remote) {
      const result = response?.data?.discountCodeBasicCreate;
      const rejected = result?.codeDiscountNode === null && Array.isArray(result.userErrors) &&
        result.userErrors.length > 0 && result.userErrors.every(error => !!error && typeof error.message === "string" && !!error.message.trim());
      if (rejected) {
        // A definitive rejection is a known non-creation. Reconcile first in
        // case another process completed this allocation, then release only our
        // unchanged claim so a later attempt can use the same code and dates.
        remote = await reconcileRejectedCreation();
        if (!remote) throw Error("Recovery discount creation rejected: " + result!.userErrors!.map(error => error.message).join("; "));
      } else if (!result?.codeDiscountNode?.id || result.userErrors?.length) {
        throw Error(result?.userErrors?.map(error => error.message).join("; ") || "Recovery discount creation unavailable");
      } else {
        await persist({ ...saved, discountId: result.codeDiscountNode.id });
        remote = await lookup(saved.code);
      }
    }
    if (!remote) throw Error("Recovery discount creation could not be verified");
  }
  let effective = verified(remote, saved, title);
  if (effective < percentage) {
    if (await runOwner(runKey, profileId, percentage) !== recipientEmail) throw new CartDiscountStopped("Recovery discount ownership changed");
    const response = await shopifyGraphql<{ data?: { discountCodeBasicUpdate?: MutationResult } }>(UPGRADE, {
      id: remote.id, input: { customerGets: { value: { percentage: 0.15 } } },
    });
    const result = response.data?.discountCodeBasicUpdate;
    if (result?.codeDiscountNode?.id !== remote.id || result.userErrors?.length)
      throw Error(result?.userErrors?.map(error => error.message).join("; ") || "Recovery discount upgrade unavailable");
    remote = await lookup(saved.code);
    if (!remote) throw new CartDiscountStopped("Recovery discount was removed");
    effective = verified(remote, saved, title);
    if (effective !== 15) throw Error("Recovery discount upgrade could not be verified");
  }
  if (await runOwner(runKey, profileId, percentage) !== recipientEmail) throw new CartDiscountStopped("Recovery discount ownership changed");
  const next = { ...saved, discountId: remote.id, percentage: effective };
  delete next.creationRejectedAttemptId;
  if (JSON.stringify(next) !== JSON.stringify(saved)) await persist(next);
  return next;
}
