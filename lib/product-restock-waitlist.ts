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
  previousAvailable: number | null;
  newAvailable: number;
};

function normalizeOptionalString(value: unknown) {
  if (value === undefined || value === null || value === "") {
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

function buildStoreProductUrl(productHandle?: string | null) {
  const storeUrl = process.env.SHOPIFY_STORE_PUBLIC_URL;

  if (!storeUrl || !productHandle) {
    return null;
  }

  return `${storeUrl.replace(/\/$/, "")}/products/${productHandle}`;
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
  )}/api/restock-waitlist/unsubscribe?token=${encodeURIComponent(token)}`;
}

function createUnsubscribeToken() {
  return crypto.randomBytes(32).toString("hex");
}

export async function createProductRestockWaitlistSignup(input: SignupInput) {
  const shop = normalizeShop(input.shop);
  const email = normalizeEmail(input.email);
  const productId = normalizeOptionalString(input.productId);

  if (!productId) {
    throw new Error("Missing productId.");
  }

  if (!email || !email.includes("@")) {
    throw new Error("Please enter a valid email address.");
  }

  const existing = await prisma.productRestockWaitlist.findFirst({
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
    const subscription = await prisma.productRestockWaitlist.create({
      data: {
        shop,
        productId,
        productHandle: normalizeOptionalString(input.productHandle),
        productTitle: normalizeOptionalString(input.productTitle),
        email,
        status: WAITLIST_STATUS_WAITING,
        unsubscribeToken: createUnsubscribeToken(),
      },
    });

    return {
      subscription,
      created: true,
    };
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const subscription = await prisma.productRestockWaitlist.findFirstOrThrow({
      where: {
        shop,
        productId,
        email,
        status: WAITLIST_STATUS_WAITING,
      },
    });

    return {
      subscription,
      created: false,
    };
  }
}

export async function unsubscribeProductRestockWaitlist(token: string) {
  if (!token) {
    return null;
  }

  const subscription = await prisma.productRestockWaitlist.findUnique({
    where: {
      unsubscribeToken: token,
    },
  });

  if (!subscription) {
    return null;
  }

  if (subscription.status === WAITLIST_STATUS_UNSUBSCRIBED) {
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

export async function processProductRestockWaitlist(
  input: ProcessRestockInput
) {
  const productId = normalizeOptionalString(input.productId);

  if (!productId || input.previousAvailable === null) {
    return {
      action: "skipped_missing_product_or_previous_quantity",
      previousProductTotal: null,
      currentProductTotal: null,
      waitingCount: 0,
      notifiedCount: 0,
      skippedEmailCount: 0,
    };
  }

  const currentProductTotalResult = await prisma.inventorySnapshot.aggregate({
    where: {
      shop: input.shop,
      productId,
    },
    _sum: {
      available: true,
    },
  });

  const currentProductTotal =
    currentProductTotalResult._sum.available ?? input.newAvailable;
  const previousProductTotal =
    currentProductTotal - input.newAvailable + input.previousAvailable;

  if (previousProductTotal > 0 || currentProductTotal <= 0) {
    return {
      action: "no_product_restock_crossing",
      previousProductTotal,
      currentProductTotal,
      waitingCount: 0,
      notifiedCount: 0,
      skippedEmailCount: 0,
    };
  }

  const waitingSubscriptions = await prisma.productRestockWaitlist.findMany({
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
      action: "restock_detected_no_waiting_subscriptions",
      previousProductTotal,
      currentProductTotal,
      waitingCount: 0,
      notifiedCount: 0,
      skippedEmailCount: 0,
    };
  }

  if (!isRestockEmailConfigured()) {
    return {
      action: "restock_detected_email_not_configured",
      previousProductTotal,
      currentProductTotal,
      waitingCount: waitingSubscriptions.length,
      notifiedCount: 0,
      skippedEmailCount: waitingSubscriptions.length,
    };
  }

  let notifiedCount = 0;
  let failedCount = 0;

  for (const subscription of waitingSubscriptions) {
    try {
      const productTitle =
        subscription.productTitle ||
        normalizeOptionalString(input.productTitle) ||
        "A product you requested";
      const productHandle =
        subscription.productHandle || normalizeOptionalString(input.productHandle);

      await sendRestockEmail({
        subscriptionId: subscription.id,
        to: subscription.email,
        productTitle,
        productUrl: buildStoreProductUrl(productHandle),
        unsubscribeUrl: buildUnsubscribeUrl(subscription.unsubscribeToken),
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
      console.error("Failed to notify restock waitlist subscription:", {
        subscriptionId: subscription.id,
        error,
      });
    }
  }

  return {
    action: "restock_detected_notifications_processed",
    previousProductTotal,
    currentProductTotal,
    waitingCount: waitingSubscriptions.length,
    notifiedCount,
    failedCount,
    skippedEmailCount: 0,
  };
}
