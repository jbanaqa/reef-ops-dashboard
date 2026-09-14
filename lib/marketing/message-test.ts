import { prisma } from "@/lib/prisma";
import { cartRunKey, type CartRun } from "./cart";
import { cartTestBlock } from "./cart-config";
import { setup } from "./delivery";
import { validateFlow, type FlowConfig } from "./flow-config";
import { marketingSettings } from "./rules";
import { atomic, json, record, shop, type Tx } from "./store";
import { welcomeAudienceBlock, type WelcomeRun } from "./welcome";
import { runMarketing } from "./worker";

type Candidate = {
  id: string;
  key: string;
  profileId: string;
  flowKey: string | null;
  flowStep?: number | null;
  flowCondition: string | null;
  status: string;
  channel: string;
  attempts: number;
  dueAt: Date;
};
type TestContext = {
  flow: { enabled: boolean; data: unknown };
  config: FlowConfig;
  kind: "cart" | "welcome";
  cartRun?: CartRun;
  welcomeRun?: WelcomeRun;
};
export type MessageTestActions = {
  canSendNow: boolean;
  reason: string | null;
  canCancel: boolean;
};

async function testContext(
  tx: Tx,
  m: Candidate,
  address: string | null,
): Promise<TestContext | null> {
  if (m.channel !== "EMAIL" || !m.flowKey || !address) return null;
  const flow = await tx.marketingResource.findUnique({
    where: {
      shop_kind_key: { shop: shop(), kind: "FLOW", key: m.flowKey },
    },
    select: { enabled: true, data: true },
  });
  if (!flow) return null;
  if (m.flowKey === "abandoned-cart") {
    if (!["cart-v1:first", "cart-v1:final"].includes(m.flowCondition || ""))
      return null;
    const config = validateFlow(m.flowKey, flow.data);
    if (!config.cart?.testEmail) return null;
    const row = await tx.marketingResource.findUnique({
      where: {
        shop_kind_key: {
          shop: shop(),
          kind: "CART_RUN",
          key: cartRunKey(m.key),
        },
      },
    });
    const cartRun = row?.data as unknown as CartRun | undefined;
    if (cartTestBlock(config.cart, cartRun || null, address, m.channel))
      return null;
    return { flow, config, kind: "cart", cartRun };
  }
  if (
    m.flowKey === "welcome" &&
    /^welcome-v1:[0-3]$/.test(m.flowCondition || "")
  ) {
    const config = validateFlow(m.flowKey, flow.data);
    if (!config.welcome?.testEmail) return null;
    const row = await tx.marketingResource.findUnique({
      where: {
        shop_kind_key: {
          shop: shop(),
          kind: "WELCOME_RUN",
          key: m.profileId,
        },
      },
    });
    const welcomeRun = row?.data as unknown as WelcomeRun | undefined;
    if (!welcomeRun || welcomeAudienceBlock(config, welcomeRun, address))
      return null;
    return { flow, config, kind: "welcome", welcomeRun };
  }
  return null;
}

export async function messageTestState(
  tx: Tx,
  m: Candidate,
  address: string | null,
): Promise<{ testScoped: boolean; testActions?: MessageTestActions }> {
  const context = await testContext(tx, m, address);
  if (!context) return { testScoped: false };
  if (m.status !== "PENDING" || m.attempts !== 0)
    return { testScoped: true };
  if (!context.flow.enabled || !context.config.reviewed)
    return {
      testScoped: true,
      testActions: {
        canSendNow: false,
        reason: "Enable and review this restricted test flow first.",
        canCancel: true,
      },
    };
  let reason: string | null = null;
  if (context.kind === "cart" && m.flowCondition === "cart-v1:final") {
    const previous = await tx.marketingMessage.findUnique({
      where: { key: cartRunKey(m.key) + ":first" },
      select: { status: true },
    });
    if (!previous || !["SENT", "CANCELLED"].includes(previous.status))
      reason = "Finish the previous email step before testing this one.";
  }
  if (context.kind === "welcome") {
    const step = m.flowStep ?? Number(m.flowCondition?.split(":").at(-1));
    if (step > 0) {
      const previous = await tx.marketingMessage.findFirst({
        where: {
          shop: shop(),
          profileId: m.profileId,
          flowKey: "welcome",
          flowStep: step - 1,
        },
        orderBy: { createdAt: "desc" },
        select: { status: true },
      });
      if (!previous || !["SENT", "CANCELLED"].includes(previous.status))
        reason = "Finish the previous email step before testing this one.";
      const first = await tx.marketingMessage.findFirst({
        where: {
          shop: shop(),
          profileId: m.profileId,
          flowKey: "welcome",
          flowStep: 0,
        },
        orderBy: { createdAt: "desc" },
        select: { status: true },
      });
      if (step < 3 && first?.status !== "SENT")
        reason = "The welcome offer must be sent before testing a discount reminder.";
    }
  }
  return {
    testScoped: true,
    testActions: { canSendNow: !reason, reason, canCancel: true },
  };
}

async function assertDeliveryReady(tx: Tx) {
  const settings = await tx.marketingResource.findUnique({
    where: {
      shop_kind_key: { shop: shop(), kind: "SETTINGS", key: "global" },
    },
  });
  const saved = marketingSettings(settings?.data);
  const ready = setup(saved.operations, saved.postalAddress);
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
    throw new Error("Process outstanding Shopify events before sending this test.");
}

/** Accelerate one staff-selected message in a flow restricted to this test account. */
export async function sendTestMessageNow(profileId: string, messageId: string) {
  if (!profileId || !messageId) throw new Error("Choose a test message.");
  await atomic(async (tx) => {
    const m = await tx.marketingMessage.findFirst({
      where: { id: messageId, profileId, shop: shop() },
      include: { profile: { select: { email: true } } },
    });
    if (!m) throw new Error("This message was not found for this account.");
    const state = await messageTestState(tx, m, m.profile.email);
    if (!state.testActions)
      throw new Error(
        "Only an unsent email in a flow restricted to this test account can be sent early.",
      );
    if (!state.testActions.canSendNow)
      throw new Error(
        state.testActions.reason || "This test email cannot be sent yet.",
      );
    await assertDeliveryReady(tx);
    const dueAt = new Date();
    await tx.marketingMessage.update({
      where: { id: m.id },
      data: { dueAt, error: null },
    });
    if (m.flowKey === "abandoned-cart") {
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
    }
    await record(tx, {
      key: "message-test-advance:" + m.id,
      type: "MESSAGE_TEST_SEND_REQUESTED",
      profileId,
      messageId: m.id,
      payload: { flowKey: m.flowKey, originalDueAt: m.dueAt.toISOString() },
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

export async function cancelTestMessage(profileId: string, messageId: string) {
  if (!profileId || !messageId) throw new Error("Choose a test message.");
  await atomic(async (tx) => {
    const m = await tx.marketingMessage.findFirst({
      where: { id: messageId, profileId, shop: shop(), status: "PENDING" },
      include: { profile: { select: { email: true } } },
    });
    if (!m) throw new Error("This pending message was not found.");
    const state = await messageTestState(tx, m, m.profile.email);
    if (!state.testActions?.canCancel)
      throw new Error(
        "Only a message in a flow restricted to this test account can be cancelled here.",
      );
    await tx.marketingMessage.update({
      where: { id: m.id },
      data: { status: "CANCELLED", error: "Cancelled by staff for testing" },
    });
  });
}

/** Remove unsent messages from every flow currently restricted to this test account. */
export async function clearUnsentTestMessages(profileId: string) {
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
        status: { in: ["PENDING", "CANCELLED", "FAILED"] },
      },
    });
    const removable: string[] = [];
    const cartRuns = new Set<string>();
    for (const m of messages) {
      if (await testContext(tx, m, profile.email)) {
        removable.push(m.id);
        if (m.flowKey === "abandoned-cart") cartRuns.add(cartRunKey(m.key));
      }
    }
    if (!removable.length) return 0;
    await tx.marketingResource.deleteMany({
      where: {
        shop: shop(),
        kind: { in: ["CART_WAIT", "CART_READY", "WELCOME_READY"] },
        key: { in: removable },
      },
    });
    await tx.marketingResource.deleteMany({
      where: { shop: shop(), kind: "CART_RUN", key: { in: [...cartRuns] } },
    });
    const result = await tx.marketingMessage.deleteMany({
      where: { id: { in: removable }, profileId, shop: shop() },
    });
    return result.count;
  });
}
