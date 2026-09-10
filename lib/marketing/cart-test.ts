import { prisma } from "@/lib/prisma";
import { atomic, json, record, shop, type Tx } from "./store";
import { cartRunKey, type CartRun } from "./cart";
import { cartTestBlock } from "./cart-config";
import { validateFlow } from "./flow-config";
import { marketingSettings } from "./rules";
import { setup } from "./delivery";
import { runMarketing } from "./worker";

type Candidate = {
  id: string;
  key: string;
  flowKey: string | null;
  flowCondition: string | null;
  status: string;
  channel: string;
  attempts: number;
};
export async function cartTestSendState(
  tx: Tx,
  m: Candidate,
  address: string | null,
) {
  if (
    m.flowKey !== "abandoned-cart" ||
    m.channel !== "EMAIL" ||
    m.status !== "PENDING" ||
    m.attempts !== 0 ||
    !["cart-v1:first", "cart-v1:final"].includes(m.flowCondition || "")
  )
    return null;
  const flow = await tx.marketingResource.findUnique({
    where: {
      shop_kind_key: { shop: shop(), kind: "FLOW", key: "abandoned-cart" },
    },
  });
  if (!flow) return null;
  const config = validateFlow("abandoned-cart", flow.data);
  if (!config.cart?.testEmail) return null;
  const row = await tx.marketingResource.findUnique({
    where: {
      shop_kind_key: { shop: shop(), kind: "CART_RUN", key: cartRunKey(m.key) },
    },
  });
  const run = row?.data as unknown as CartRun | undefined;
  if (cartTestBlock(config.cart, run || null, address, m.channel)) return null;
  if (!flow.enabled || !config.reviewed)
    return {
      canSendNow: false,
      reason: "Enable and review the restricted test flow first.",
    };
  if (m.flowCondition === "cart-v1:final") {
    const previous = await tx.marketingMessage.findUnique({
      where: { key: cartRunKey(m.key) + ":first" },
      select: { status: true },
    });
    if (!previous || !["SENT", "CANCELLED"].includes(previous.status))
      return {
        canSendNow: false,
        reason: "Finish the first email step before testing this follow-up.",
      };
  }
  return { canSendNow: true, reason: null };
}

/** Accelerate only an authenticated staff-selected test email, preserving all other delivery checks. */
export async function sendCartTestNow(profileId: string, messageId: string) {
  if (!profileId || !messageId)
    throw new Error("Choose a test message from this account.");
  await atomic(async (tx) => {
    const m = await tx.marketingMessage.findFirst({
      where: { id: messageId, profileId, shop: shop() },
      include: { profile: { select: { email: true } } },
    });
    if (!m) throw new Error("This message was not found for this account.");
    const state = await cartTestSendState(tx, m, m.profile.email);
    if (!state)
      throw new Error(
        "Only an unsent email in the current account-restricted cart test can be sent early.",
      );
    if (!state.canSendNow) throw new Error(state.reason!);
    const settings = await tx.marketingResource.findUnique({
      where: {
        shop_kind_key: { shop: shop(), kind: "SETTINGS", key: "global" },
      },
    });
    const saved = marketingSettings(settings?.data),
      ready = setup(saved.operations, saved.postalAddress);
    if (
      !ready.sendingEnabled ||
      !ready.migrationConfirmed ||
      !ready.emailReady ||
      !ready.ingestEnabled
    )
      throw new Error(
        "Sending or Shopify ingestion is paused, or email setup is incomplete. Existing safety controls still apply.",
      );
    if (
      await tx.marketingWebhookInbox.count({
        where: { shop: shop(), status: { not: "DONE" } },
      })
    )
      throw new Error(
        "Process outstanding Shopify events before sending this test.",
      );
    const dueAt = new Date();
    await tx.marketingMessage.update({
      where: { id: m.id },
      data: { dueAt, error: null },
    });
    // This overrides the selected wait, not the preceding step or following delays.
    await tx.marketingResource.upsert({
      where: { shop_kind_key: { shop: shop(), kind: "CART_WAIT", key: m.id } },
      create: {
        shop: shop(),
        kind: "CART_WAIT",
        key: m.id,
        name: "Test wait advanced",
        data: json({ dueAt: dueAt.toISOString(), testAdvance: true }),
      },
      update: { data: json({ dueAt: dueAt.toISOString(), testAdvance: true }) },
    });
    await record(tx, {
      key: "cart-test-advance:" + m.id,
      type: "CART_TEST_SEND_REQUESTED",
      profileId,
      messageId: m.id,
      payload: { originalDueAt: m.dueAt.toISOString() },
    });
  });
  const result = await runMarketing(messageId);
  const message = await prisma.marketingMessage.findFirstOrThrow({
    where: { id: messageId, profileId, shop: shop() },
    select: { status: true, error: true },
  });
  return {
    status: message.status,
    message:
      message.status === "SENT"
        ? "Test email sent. Check this account’s inbox."
        : message.status === "SENDING"
          ? "This test email is being sent. Refresh shortly."
          : message.status === "CANCELLED"
            ? "Not sent: " +
              (message.error || "a delivery check stopped this email.")
            : message.status === "UNKNOWN"
              ? "Delivery is uncertain. Check the inbox and provider before retrying."
              : message.error ||
                ("skipped" in result
                  ? result.skipped
                  : "Not sent yet. Refresh to see the latest delivery status."),
  };
}

/** Cancel one pending message from the current account-restricted cart test. */
export async function cancelCartTestMessage(
  profileId: string,
  messageId: string,
) {
  if (!profileId || !messageId) throw new Error("Choose a test message.");
  await atomic(async (tx) => {
    const m = await tx.marketingMessage.findFirst({
      where: {
        id: messageId,
        profileId,
        shop: shop(),
        flowKey: "abandoned-cart",
        status: "PENDING",
      },
      include: { profile: { select: { email: true } } },
    });
    if (!m) throw new Error("This pending test message was not found.");
    const flow = await tx.marketingResource.findUnique({
      where: {
        shop_kind_key: { shop: shop(), kind: "FLOW", key: "abandoned-cart" },
      },
    });
    const config = flow && validateFlow("abandoned-cart", flow.data);
    if (
      !config?.cart?.testEmail ||
      config.cart.testEmail !== m.profile.email
    )
      throw new Error("Only messages in the current restricted cart test can be cancelled.");
    await tx.marketingMessage.update({
      where: { id: m.id },
      data: { status: "CANCELLED", error: "Cancelled by staff for testing" },
    });
  });
}

/** Remove unsent messages belonging to account-restricted cart test runs. */
export async function clearCartTestHistory(profileId: string) {
  if (!profileId) throw new Error("Choose a contact first.");
  return atomic(async (tx) => {
    const profile = await tx.marketingProfile.findFirst({
      where: { id: profileId, shop: shop() },
      select: { email: true },
    });
    if (!profile?.email) throw new Error("This contact has no email address.");
    const messages = await tx.marketingMessage.findMany({
      where: {
        profileId,
        shop: shop(),
        flowKey: "abandoned-cart",
        status: { in: ["PENDING", "CANCELLED", "FAILED"] },
      },
      select: { id: true, key: true },
    });
    const removable: string[] = [];
    for (const m of messages) {
      const run = await tx.marketingResource.findUnique({
        where: {
          shop_kind_key: {
            shop: shop(),
            kind: "CART_RUN",
            key: cartRunKey(m.key),
          },
        },
        select: { data: true },
      });
      const testEmail = (run?.data as { config?: { cart?: { testEmail?: string } } } | null)
        ?.config?.cart?.testEmail;
      if (testEmail === profile.email) removable.push(m.id);
    }
    if (!removable.length) return 0;
    await tx.marketingResource.deleteMany({
      where: { shop: shop(), kind: "CART_WAIT", key: { in: removable } },
    });
    const result = await tx.marketingMessage.deleteMany({
      where: { id: { in: removable }, profileId, shop: shop() },
    });
    return result.count;
  });
}
