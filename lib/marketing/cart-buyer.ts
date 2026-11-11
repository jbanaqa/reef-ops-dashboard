import { prisma } from "@/lib/prisma";
import { shop } from "./store";
import { shopifyGraphql } from "./shopify";
import { cartStage } from "./cart-sequence";

export const CART_RETURNING_CUSTOMER = "Cart offers are only for customers with no previous orders";
export const CART_BUYER_WAIT = "Waiting to verify the customer's lifetime order history";
const MAX_PROOF_AGE_MS = 120000;

type Identity = { id: string; email: string | null; shopifyId: string | null; lastOrderAt?: Date | null };
export type CartBuyerCheck = {
  shop: string;
  profileId: string;
  email: string;
  shopifyId: string | null;
  hasOrders: boolean;
  checkedAt: number;
};
type Customer = { id: string; defaultEmailAddress: { emailAddress: string } | null; numberOfOrders: string | number };
const normalizedEmail = (value: string) => value.trim().toLowerCase();
function customerId(value: string | null): string | null {
  if (!value) return null;
  const id = value.replace(/^gid:\/\/shopify\/Customer\//, "");
  if (!/^\d+$/.test(id)) throw Error(CART_BUYER_WAIT + ": customer identity is invalid");
  return "gid://shopify/Customer/" + id;
}
export function isCartFollowup(message: { flowKey: string | null; channel: string; flowCondition: string | null }) {
  const stage = cartStage(message.flowCondition);
  return message.flowKey === "abandoned-cart" && message.channel === "EMAIL" &&
    !!stage && stage !== "first" && stage !== "sms";
}
export function cartBuyerProofValid(check: CartBuyerCheck | null | undefined, profile: Identity, now = Date.now()): check is CartBuyerCheck {
  return !!check && check.shop === shop() && check.profileId === profile.id && !!profile.email &&
    check.email === normalizedEmail(profile.email) && check.shopifyId === profile.shopifyId &&
    Number.isFinite(check.checkedAt) && check.checkedAt <= now && now - check.checkedAt <= MAX_PROOF_AGE_MS;
}

/** Never infer a first purchase from a recent-order query or missing imported history.
 * Shopify's Customer.numberOfOrders is a lifetime count, including older orders
 * outside the default Orders API window. A zero is never cached across attempts.
 */
export async function cartBuyerHistory(profileId: string): Promise<CartBuyerCheck> {
  const profile = await prisma.marketingProfile.findFirst({ where: { id: profileId, shop: shop() },
    select: { id: true, email: true, shopifyId: true, lastOrderAt: true } });
  if (!profile?.email) throw Error(CART_BUYER_WAIT + ": recipient identity is unavailable");
  const check = { shop: shop(), profileId, email: normalizedEmail(profile.email), shopifyId: profile.shopifyId,
    hasOrders: false, checkedAt: Date.now() };
  // Positive local evidence can deny an offer; only a fresh Shopify zero can allow one.
  if (profile.lastOrderAt) return { ...check, hasOrders: true };
  const id = customerId(profile.shopifyId);
  const response = await shopifyGraphql<{ data?: {
    nodes?: (Customer | null)[];
    customers?: { nodes: Customer[]; pageInfo: { hasNextPage: boolean } };
  } }>(`query CartBuyerHistory($ids: [ID!]!, $query: String!) {
    nodes(ids: $ids) { ... on Customer { id defaultEmailAddress { emailAddress } numberOfOrders } }
    customers(first: 25, query: $query) {
      nodes { id defaultEmailAddress { emailAddress } numberOfOrders }
      pageInfo { hasNextPage }
    }
  }`, { ids: id ? [id] : [], query: "email:" + JSON.stringify(check.email) });
  const data = response.data, customers = data?.customers;
  if (!Array.isArray(data?.nodes) || !Array.isArray(customers?.nodes) || typeof customers?.pageInfo?.hasNextPage !== "boolean")
    throw Error(CART_BUYER_WAIT + ": Shopify history is incomplete");
  const known = id ? data.nodes.find(node => node?.id === id) : undefined;
  const exact = customers.nodes.filter(node => typeof node?.defaultEmailAddress?.emailAddress === "string" &&
    normalizedEmail(node.defaultEmailAddress.emailAddress) === check.email);
  const relevant = [...exact, ...(known ? [known] : [])];
  const counts = relevant.map(node => {
    const value = node.numberOfOrders;
    if ((typeof value !== "string" && typeof value !== "number") ||
      !/^\d+$/.test(String(value)) || (typeof value === "number" && !Number.isSafeInteger(value)))
      throw Error(CART_BUYER_WAIT + ": lifetime order count is unavailable");
    return BigInt(value);
  });
  if (counts.some(count => count > BigInt(0))) return { ...check, hasOrders: true };
  if (customers.pageInfo.hasNextPage || (!exact.length && !known) ||
    (id && (!known || normalizedEmail(known.defaultEmailAddress?.emailAddress || "") !== check.email)))
    throw Error(CART_BUYER_WAIT + ": customer identity or history needs verification");
  return check;
}
