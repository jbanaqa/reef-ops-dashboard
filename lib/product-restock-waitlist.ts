import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import {
  isRestockEmailConfigured,
  sendRestockEmail,
} from "@/lib/restock-email";

const WAITLIST_STATUS_WAITING = "Waiting";
const WAITLIST_STATUS_NOTIFIED = "Notified";
const WAITLIST_STATUS_UNSUBSCRIBED = "Unsubscribed";

type SignupInput = {
  shop?: string | null;
  productId: string;
  productHandle?: string | null;
  productTitle?: string | null;
  email: string;
};

type ProcessRestockInput = {
  shop: string;
  productId?: string | null;
  productHandle?: string | null;
  productTitle?: string | null;
  currentProductTotal: number | null;
};

function normalizeOptionalString(value: unknown) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  return String(value);
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizeShop(value?: string | null) {
  return (
    normalizeOptionalString(value) ||
    process.env.SHOPIFY_SHOP_DOMAIN ||
    "unknown-shop"
  );
}

function isUniqueConstraintError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function buildStoreProductUrl(
  productHandle?: string | null
) {
  const storeUrl =
    process.env.SHOPIFY_STORE_PUBLIC_URL;

  if (!storeUrl || !productHandle) {
    return null;
  }

  return `${storeUrl.replace(
    /\/$/,
    ""
  )}/products/${productHandle}`;
}

function buildUnsubscribeUrl(token: string) {
  const appBaseUrl = process.env.APP_BASE_URL;

  if (!appBaseUrl) {
    return `/api/restock-waitlist/unsubscribe?token=${encodeURIComponent(
      token
    )}`;
  }

  return `${appBaseUrl.replace(
    /\/$/,
    ""
  )}/api/restock-waitlist/unsubscribe?token=${encodeURIComponent(
    token
  )}`;
}

function createUnsubscribeToken() {
  return crypto.randomBytes(32).toString("hex");
}

export async function createProductRestockWaitlistSignup(
  input: SignupInput
) {
  const shop = normalizeShop(input.shop);
  const email = normalizeEmail(input.email);
  const productId = normalizeOptionalString(
    input.productId
  );

  if (!productId) {
    throw new Error("Missing productId.");
  }

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254
  ) {
    throw new Error(
      "Please enter a valid email address."
    );
  }

  const existing =
    await prisma.productRestockWaitlist.findFirst({
      where: {
        shop,
        productId,
        email,
        status: WAITLIST_STATUS_WAITING,
      },
    });

  if (existing) {
    return {
      subscription: existing,
      created: false,
    };
  }

  try {
    const subscription =
      await prisma.productRestockWaitlist.create({
        data: {
          shop,
          productId,
          productHandle: normalizeOptionalString(
            input.productHandle
          ),
          productTitle: normalizeOptionalString(
            input.productTitle
          ),
          email,
          status: WAITLIST_STATUS_WAITING,
          unsubscribeToken:
            createUnsubscribeToken(),
        },
      });

    return {
      subscription,
      created: true,
    };
  } catch (error) {
    /*
      The database has a partial unique index that
      allows only one Waiting record for the same
      shop, product, and email.
    */
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const subscription =
      await prisma.productRestockWaitlist.findFirstOrThrow(
        {
          where: {
            shop,
            productId,
            email,
            status: WAITLIST_STATUS_WAITING,
          },
        }
      );

    return {
      subscription,
      created: false,
    };
  }
}

export async function unsubscribeProductRestockWaitlist(
  token: string
) {
  if (!token) {
    return null;
  }

  const subscription =
    await prisma.productRestockWaitlist.findUnique({
      where: {
        unsubscribeToken: token,
      },
    });

  if (!subscription) {
    return null;
  }

  if (
    subscription.status ===
    WAITLIST_STATUS_UNSUBSCRIBED
  ) {
    return subscription;
  }

  return prisma.productRestockWaitlist.update({
    where: {
      id: subscription.id,
    },
    data: {
      status: WAITLIST_STATUS_UNSUBSCRIBED,
      unsubscribedAt: new Date(),
    },
  });
}

export async function manuallySendProductRestockWaitlistEntry(
  entryId: string
) {
  const subscription =
    await prisma.productRestockWaitlist.findUnique({
      where: {
        id: entryId,
      },
    });

  if (!subscription) {
    throw new Error("This waitlist signup could not be found.");
  }

  if (subscription.status !== WAITLIST_STATUS_WAITING) {
    return {
      action: "manual_send_skipped_not_waiting",
      subscription,
    };
  }

  if (!isRestockEmailConfigured()) {
    throw new Error(
      "Restock email delivery is not configured."
    );
  }

  const productTitle =
    subscription.productTitle ||
    "A product you requested";

  const productHandle =
    subscription.productHandle;

  const emailResult = await sendRestockEmail({
    subscriptionId: subscription.id,
    to: subscription.email,
    productTitle,
    productUrl:
      buildStoreProductUrl(productHandle),
    unsubscribeUrl: buildUnsubscribeUrl(
      subscription.unsubscribeToken
    ),
  });

  if (!emailResult.sent) {
    throw new Error(
      "The restock email could not be sent."
    );
  }

  const updatedSubscription =
    await prisma.productRestockWaitlist.update({
      where: {
        id: subscription.id,
      },
      data: {
        status: WAITLIST_STATUS_NOTIFIED,
        notifiedAt: new Date(),
        productHandle,
        productTitle,
      },
    });

  return {
    action: "manual_notification_sent",
    subscription: updatedSubscription,
  };
}

export async function processProductRestockWaitlist(
  input: ProcessRestockInput
) {
  const productId = normalizeOptionalString(
    input.productId
  );
  const currentProductTotal =
    input.currentProductTotal;

  /*
    We cannot safely detect a product-level transition
    without a product ID and Shopify's current total.
  */
  if (
    !productId ||
    currentProductTotal === null ||
    !Number.isFinite(currentProductTotal)
  ) {
    return {
      action: "skipped_missing_product_inventory",
      previousProductTotal: null,
      currentProductTotal,
      waitingCount: 0,
      notifiedCount: 0,
      failedCount: 0,
      skippedEmailCount: 0,
    };
  }

  const existingState =
    await prisma.productInventoryState.findUnique({
      where: {
        shop_productId: {
          shop: input.shop,
          productId,
        },
      },
    });

  /*
    The first observation establishes a baseline.
    It must not send emails because no prior state
    exists to prove that a restock occurred.
  */
  if (!existingState) {
    await prisma.productInventoryState.create({
      data: {
        shop: input.shop,
        productId,
        productHandle: normalizeOptionalString(
          input.productHandle
        ),
        productTitle: normalizeOptionalString(
          input.productTitle
        ),
        totalAvailable: currentProductTotal,
        checkedAt: new Date(),
      },
    });

    return {
      action: "initialized_product_inventory_state",
      previousProductTotal: null,
      currentProductTotal,
      waitingCount: 0,
      notifiedCount: 0,
      failedCount: 0,
      skippedEmailCount: 0,
    };
  }

  const previousProductTotal =
    existingState.totalAvailable;

  await prisma.productInventoryState.update({
    where: {
      id: existingState.id,
    },
    data: {
      productHandle:
        normalizeOptionalString(
          input.productHandle
        ) ?? existingState.productHandle,
      productTitle:
        normalizeOptionalString(
          input.productTitle
        ) ?? existingState.productTitle,
      totalAvailable: currentProductTotal,
      checkedAt: new Date(),
    },
  });

  /*
    Only an unavailable-to-available transition
    should notify customers.
  */
  if (
    previousProductTotal > 0 ||
    currentProductTotal <= 0
  ) {
    return {
      action: "no_product_restock_crossing",
      previousProductTotal,
      currentProductTotal,
      waitingCount: 0,
      notifiedCount: 0,
      failedCount: 0,
      skippedEmailCount: 0,
    };
  }

  const waitingSubscriptions =
    await prisma.productRestockWaitlist.findMany({
      where: {
        shop: input.shop,
        productId,
        status: WAITLIST_STATUS_WAITING,
      },
      orderBy: {
        subscribedAt: "asc",
      },
    });

  if (waitingSubscriptions.length === 0) {
    return {
      action:
        "restock_detected_no_waiting_subscriptions",
      previousProductTotal,
      currentProductTotal,
      waitingCount: 0,
      notifiedCount: 0,
      failedCount: 0,
      skippedEmailCount: 0,
    };
  }

  if (!isRestockEmailConfigured()) {
    return {
      action:
        "restock_detected_email_not_configured",
      previousProductTotal,
      currentProductTotal,
      waitingCount: waitingSubscriptions.length,
      notifiedCount: 0,
      failedCount: 0,
      skippedEmailCount:
        waitingSubscriptions.length,
    };
  }

  let notifiedCount = 0;
  let failedCount = 0;

  for (const subscription of waitingSubscriptions) {
    try {
      const productTitle =
        subscription.productTitle ||
        normalizeOptionalString(
          input.productTitle
        ) ||
        "A product you requested";

      const productHandle =
        subscription.productHandle ||
        normalizeOptionalString(
          input.productHandle
        );

      await sendRestockEmail({
        subscriptionId: subscription.id,
        to: subscription.email,
        productTitle,
        productUrl:
          buildStoreProductUrl(productHandle),
        unsubscribeUrl: buildUnsubscribeUrl(
          subscription.unsubscribeToken
        ),
      });

      await prisma.productRestockWaitlist.update({
        where: {
          id: subscription.id,
        },
        data: {
          status: WAITLIST_STATUS_NOTIFIED,
          notifiedAt: new Date(),
          productHandle,
          productTitle,
        },
      });

      notifiedCount += 1;
    } catch (error) {
      failedCount += 1;

      console.error(
        "Failed to notify restock waitlist subscription:",
        {
          subscriptionId: subscription.id,
          error,
        }
      );
    }
  }

  return {
    action:
      "restock_detected_notifications_processed",
    previousProductTotal,
    currentProductTotal,
    waitingCount: waitingSubscriptions.length,
    notifiedCount,
    failedCount,
    skippedEmailCount: 0,
  };
}