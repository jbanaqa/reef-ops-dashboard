import { prisma } from "@/lib/prisma";
import { shopifyGraphql } from "@/lib/shopify";
import { json, shop, type Tx } from "./store";

const kind = "SHOPIFY_EMAIL_UNSUBSCRIBE";

export function unsubscribeUrl(token: string) {
  const origin = process.env.MARKETING_UNSUBSCRIBE_ORIGIN || process.env.APP_BASE_URL;
  if (!origin) throw new Error("Public unsubscribe origin is not configured.");
  const url = new URL("/api/marketing/unsubscribe", origin);
  if (url.protocol !== "https:" && process.env.NODE_ENV === "production")
    throw new Error("Public unsubscribe origin must use HTTPS.");
  url.searchParams.set("token", token);
  return url.toString();
}

export async function queueShopifyEmailUnsubscribe(
  tx: Tx,
  profileId: string,
  occurredAt: Date,
) {
  const data = json({ profileId, occurredAt: occurredAt.toISOString(), attempts: 0 });
  await tx.marketingResource.upsert({
    where: { shop_kind_key: { shop: shop(), kind, key: profileId } },
    create: { shop: shop(), kind, key: profileId, name: "Shopify email opt-out sync", data },
    update: { data },
  });
}

type Customer = { id: string; defaultEmailAddress: { emailAddress: string; marketingState?: string } | null };
type FindResponse = { data?: { customers?: { nodes: Customer[] } } };
type UpdateResponse = {
  data?: { customerEmailMarketingConsentUpdate?: {
    customer: Customer | null;
    userErrors: { message: string }[];
  } };
};

async function updateShopify(profile: { email: string | null }, occurredAt: string) {
  if (!profile.email) throw new Error("Profile has no email address.");
  // Resolve by the exact address, even when a stored Shopify ID is available:
  // a stale customer ID must never change another person's consent.
  const escaped = profile.email.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const found = await shopifyGraphql<FindResponse>(
    `query FindCustomerForUnsubscribe($search: String!) {
      customers(first: 3, query: $search) {
        nodes { id defaultEmailAddress { emailAddress } }
      }
    }`,
    { search: `email:"${escaped}"` },
  );
  const matches = (found.data?.customers?.nodes || []).filter(
    (customer) => customer.defaultEmailAddress?.emailAddress.toLowerCase() === profile.email!.toLowerCase(),
  );
  if (matches.length !== 1) throw new Error("Shopify customer email is missing or ambiguous.");
  const customer = matches[0];
  const updated = await shopifyGraphql<UpdateResponse>(
    `mutation UnsubscribeCustomer($input: CustomerEmailMarketingConsentUpdateInput!) {
      customerEmailMarketingConsentUpdate(input: $input) {
        customer { id defaultEmailAddress { emailAddress marketingState marketingUpdatedAt } }
        userErrors { field message }
      }
    }`,
    { input: { customerId: customer.id, emailMarketingConsent: {
      marketingState: "UNSUBSCRIBED", consentUpdatedAt: occurredAt,
    } } },
  );
  const result = updated.data?.customerEmailMarketingConsentUpdate;
  if (result?.userErrors?.length || result?.customer?.defaultEmailAddress?.marketingState !== "UNSUBSCRIBED")
    throw new Error(result?.userErrors?.map((error) => error.message).join("; ") || "Shopify did not confirm the unsubscribe.");
}

export async function syncShopifyEmailUnsubscribes(limit = 25, profileId?: string) {
  const rows = await prisma.marketingResource.findMany({
    where: { shop: shop(), kind, ...(profileId ? { key: profileId } : {}) },
    orderBy: { updatedAt: "asc" }, take: limit,
  });
  let synced = 0;
  for (const row of rows) {
    const data = row.data as { profileId?: string; occurredAt?: string; attempts?: number; nextAt?: string };
    if (!data.profileId || !data.occurredAt) continue;
    if (data.nextAt && Date.parse(data.nextAt) > Date.now()) continue;
    const profile = await prisma.marketingProfile.findUnique({
      where: { id: data.profileId }, include: { consents: { where: { channel: "EMAIL" } } },
    });
    const consent = profile?.consents[0];
    if (!profile || consent?.status !== "UNSUBSCRIBED" || !consent.suppressed) {
      await prisma.marketingResource.delete({ where: { id: row.id } });
      continue;
    }
    try {
      await updateShopify(profile, data.occurredAt);
      // A repeated POST may have refreshed the request while the API call ran.
      await prisma.marketingResource.deleteMany({ where: { id: row.id, updatedAt: row.updatedAt } });
      synced++;
    } catch (error) {
      const attempts = (data.attempts || 0) + 1;
      const nextAt = new Date(Date.now() + Math.min(3600000, 60000 * 2 ** Math.min(attempts, 6))).toISOString();
      await prisma.marketingResource.updateMany({
        where: { id: row.id, updatedAt: row.updatedAt },
        data: { data: json({ ...data, attempts, nextAt, error: error instanceof Error ? error.message : "Shopify sync failed" }) },
      });
    }
  }
  return { inspected: rows.length, synced };
}
