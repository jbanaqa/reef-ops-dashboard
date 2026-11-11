import type { Prisma } from "@/app/generated/prisma/client";

/** Cart email is an independent sequence, outside cross-campaign Smart Sending. */
export const isIndependentCartEmail = (message: { flowKey: string | null; channel: string }) =>
  message.channel === "EMAIL" && message.flowKey === "abandoned-cart";

export function emailSpacingHistory(): Prisma.MarketingMessageWhereInput {
  return { OR: [{ flowKey: null }, { flowKey: { notIn: ["email-confirmation", "abandoned-cart"] } }] };
}

/** Uncertain cart sends hold other cart sends, but not unrelated marketing. */
export function emailReservationScope(message: { flowKey: string | null; channel: string }): Prisma.MarketingMessageWhereInput {
  return isIndependentCartEmail(message) ? { flowKey: "abandoned-cart" } : emailSpacingHistory();
}
