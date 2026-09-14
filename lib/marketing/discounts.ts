import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { shopifyGraphql } from "@/lib/shopify";
import { shop } from "./store";
import { DAY } from "./rules";

export type SavedDiscount = {
  code: string;
  discountId?: string;
  startsAt: string;
  endsAt: string;
};
/** One durable allocation per business key. Lost API responses never mint another code or extend expiry. */
export async function uniqueDiscount(
  key: string,
  options: { kind: string; name: string; prefix: string; days?: number },
) {
  const start = new Date(),
    end = new Date(start);
  if (options.days) end.setTime(+start + options.days * DAY);
  else end.setUTCFullYear(end.getUTCFullYear() + 1);
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const code =
    options.prefix +
    Array.from(
      crypto.randomBytes(8),
      (b) => alphabet[b % alphabet.length],
    ).join("");
  const r = await prisma.marketingResource.upsert({
    where: { shop_kind_key: { shop: shop(), kind: options.kind, key } },
    create: {
      shop: shop(),
      kind: options.kind,
      key,
      name: options.name,
      data: { code, startsAt: start.toISOString(), endsAt: end.toISOString() },
    },
    update: {},
  });
  const saved = r.data as SavedDiscount;
  if (saved.discountId) return saved;
  // Older cart allocations did not persist dates until remote creation.
  if (!saved.startsAt || !saved.endsAt) {
    saved.startsAt = start.toISOString();
    saved.endsAt = end.toISOString();
    await prisma.marketingResource.update({
      where: { id: r.id },
      data: { data: saved },
    });
  }
  if (new Date(saved.endsAt) <= new Date())
    throw new Error("Discount has expired");
  const title = "Reef Ops " + options.name + " " + key;
  const lookup = await shopifyGraphql<{
    data?: {
      codeDiscountNodeByCode: {
        id: string;
        codeDiscount: { title?: string };
      } | null;
    };
  }>(
    `query CartCouponLookup($code: String!) { codeDiscountNodeByCode(code:$code) { id codeDiscount { ... on DiscountCodeBasic { title } } } }`,
    { code: saved.code },
  );
  if (!lookup.data || !("codeDiscountNodeByCode" in lookup.data))
    throw new Error("Discount lookup unavailable");
  let id = lookup.data.codeDiscountNodeByCode?.id;
  if (id && lookup.data.codeDiscountNodeByCode?.codeDiscount.title !== title)
    throw new Error("Discount code conflict; review required");
  if (!id) {
    const result = await shopifyGraphql<{
      data?: {
        discountCodeBasicCreate?: {
          codeDiscountNode?: { id: string } | null;
          userErrors?: { message: string }[];
        };
      };
    }>(
      `mutation CartCouponCreate($input: DiscountCodeBasicInput!) { discountCodeBasicCreate(basicCodeDiscount:$input) { codeDiscountNode { id } userErrors { message } } }`,
      {
        input: {
          title,
          code: saved.code,
          context: { all: "ALL" },
          startsAt: saved.startsAt,
          endsAt: saved.endsAt,
          customerGets: { value: { percentage: 0.1 }, items: { all: true } },
          combinesWith: {
            orderDiscounts: false,
            productDiscounts: false,
            shippingDiscounts: false,
          },
          usageLimit: 1,
          appliesOncePerCustomer: true,
        },
      },
    );
    id = result.data?.discountCodeBasicCreate?.codeDiscountNode?.id;
    if (!id)
      throw new Error(
        result.data?.discountCodeBasicCreate?.userErrors
          ?.map((e) => e.message)
          .join("; ") || "Discount creation unavailable",
      );
  }
  saved.discountId = id;
  await prisma.marketingResource.update({
    where: { id: r.id },
    data: { data: saved },
  });
  return saved;
}
