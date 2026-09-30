import { prisma } from "@/lib/prisma";
import { shopifyGraphql } from "@/lib/shopify";
import { shop } from "./store";
import { deliveryDateFromTags } from "./delivery-upsell-config";

type OrderPayload = {
  id?: string | number;
  name?: string;
  email?: string;
  tags?: unknown;
  customer?: {
    id?: string | number;
    email?: string;
  } | null;
};

type ShopifyCustomerResult = {
  data?: {
    customer?: {
      id: string;
      email?: string | null;
      emailMarketingConsent?: { marketingState?: string | null } | null;
    } | null;
  };
};

const CUSTOMER_QUERY = `
  query MarketingIdentityReview($id: ID!) {
    customer(id: $id) {
      id
      email
      emailMarketingConsent { marketingState }
    }
  }
`;

/** Read-only facts for a staff review. This never joins identities or changes consent. */
export async function inspectOrderIdentity(inboxId: string) {
  const row = await prisma.marketingWebhookInbox.findFirst({
    where: { id: inboxId, shop: shop(), topic: "orders/updated", status: { not: "DONE" } },
    select: { payload: true, error: true },
  });
  if (!row || !/^(Identity conflict:|Identity change requires review;)/.test(row.error || ""))
    throw new Error("Choose an unresolved order identity conflict.");

  const payload = row.payload as OrderPayload;
  const customer = payload.customer || {};
  const customerId = String(customer.id || "").replace(/^gid:\/\/shopify\/Customer\//, "");
  const eventEmail = String(customer.email || payload.email || "").trim().toLowerCase();
  if (!customerId || !eventEmail)
    throw new Error("This order event has no usable customer ID or email.");

  const [profiles, shopifyLookup] = await Promise.all([
    prisma.marketingProfile.findMany({
      where: { shop: shop(), OR: [{ email: eventEmail }, { shopifyId: customerId }] },
      select: {
        id: true,
        name: true,
        email: true,
        shopifyId: true,
        consents: {
          select: { channel: true, status: true, suppressed: true, source: true, occurredAt: true },
        },
        _count: { select: { events: true, messages: true } },
      },
    }),
    shopifyGraphql<ShopifyCustomerResult>(CUSTOMER_QUERY, {
      id: `gid://shopify/Customer/${customerId}`,
    }).then((result) => ({ customer: result.data?.customer || null, error: null as string | null }))
      .catch((error) => ({
        customer: null,
        error: error instanceof Error ? error.message : "Shopify customer lookup failed.",
      })),
  ]);

  return {
    order: {
      label: String(payload.name || payload.id || "Unknown order"),
      orderEmail: String(payload.email || "").trim().toLowerCase() || null,
      eventCustomerEmail: String(customer.email || "").trim().toLowerCase() || null,
      customerId,
      deliveryDateTag: payload.tags == null ? null : !!deliveryDateFromTags(payload.tags),
    },
    shopify: shopifyLookup.customer && {
      email: shopifyLookup.customer.email?.trim().toLowerCase() || null,
      emailMarketingState: shopifyLookup.customer.emailMarketingConsent?.marketingState || null,
    },
    shopifyError: shopifyLookup.error,
    profiles: profiles.map((profile) => ({
      ...profile,
      matchesOrderEmail: profile.email === eventEmail,
      matchesShopifyId: profile.shopifyId === customerId,
    })),
  };
}
