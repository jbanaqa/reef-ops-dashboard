import { prisma } from "@/lib/prisma";

const SETTLING_WINDOW_MINUTES =
  Number(process.env.INVENTORY_MONITOR_SETTLING_MINUTES) || 0;

type ProcessInventoryUpdateInput = {
  shop?: string;
  inventoryItemId: string;
  locationId: string;
  available: number;

  productId?: string | null;
  variantId?: string | null;
  sku?: string | null;
  productTitle?: string | null;
  variantTitle?: string | null;
  locationName?: string | null;

  rawPayload?: unknown;
};

function getFinalizeAfter() {
  const date = new Date();
  date.setMinutes(date.getMinutes() + SETTLING_WINDOW_MINUTES);
  return date;
}

function normalizeOptionalString(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return String(value);
}

export async function processInventoryUpdate(input: ProcessInventoryUpdateInput) {
  const shop = input.shop || process.env.SHOPIFY_SHOP_DOMAIN || "unknown-shop";
  const inventoryItemId = String(input.inventoryItemId || "");
  const locationId = String(input.locationId || "");
  const available = Number(input.available);

  if (!inventoryItemId || !locationId || Number.isNaN(available)) {
    throw new Error(
      "Missing required inventory update fields: inventoryItemId, locationId, available"
    );
  }

  const now = new Date();
  const finalizeAfter = getFinalizeAfter();

  await prisma.rawInventoryUpdate.create({
    data: {
      shop,
      inventoryItemId,
      locationId,
      available,
      rawPayload:
        input.rawPayload === undefined ? null : JSON.stringify(input.rawPayload),
      receivedAt: now,
    },
  });

  const existingSnapshot = await prisma.inventorySnapshot.findUnique({
    where: {
      shop_inventoryItemId_locationId: {
        shop,
        inventoryItemId,
        locationId,
      },
    },
  });

  if (!existingSnapshot) {
    const snapshot = await prisma.inventorySnapshot.create({
      data: {
        shop,
        productId: normalizeOptionalString(input.productId),
        variantId: normalizeOptionalString(input.variantId),
        inventoryItemId,
        locationId,
        sku: normalizeOptionalString(input.sku),
        productTitle: normalizeOptionalString(input.productTitle),
        variantTitle: normalizeOptionalString(input.variantTitle),
        locationName: normalizeOptionalString(input.locationName),
        available,
      },
    });

    return {
      action: "initialized_snapshot",
      message:
        "No previous inventory snapshot existed, so this quantity was saved as the starting point.",
      snapshot,
      movementWindow: null,
      previousAvailable: null,
      newAvailable: available,
      immediateDelta: null,
    };
  }

  const previousAvailable = existingSnapshot.available;

  if (previousAvailable === available) {
    const snapshot = await prisma.inventorySnapshot.update({
      where: {
        shop_inventoryItemId_locationId: {
          shop,
          inventoryItemId,
          locationId,
        },
      },
      data: {
        available,
        productId:
          normalizeOptionalString(input.productId) ?? existingSnapshot.productId,
        variantId:
          normalizeOptionalString(input.variantId) ?? existingSnapshot.variantId,
        sku: normalizeOptionalString(input.sku) ?? existingSnapshot.sku,
        productTitle:
          normalizeOptionalString(input.productTitle) ??
          existingSnapshot.productTitle,
        variantTitle:
          normalizeOptionalString(input.variantTitle) ??
          existingSnapshot.variantTitle,
        locationName:
          normalizeOptionalString(input.locationName) ??
          existingSnapshot.locationName,
      },
    });

    return {
      action: "no_quantity_change",
      message: "Inventory quantity did not change.",
      snapshot,
      movementWindow: null,
      previousAvailable,
      newAvailable: available,
      immediateDelta: 0,
    };
  }

  const pendingWindow = await prisma.inventoryMovementWindow.findFirst({
    where: {
      shop,
      inventoryItemId,
      locationId,
      status: "Pending",
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  let movementWindow;

  if (pendingWindow) {
    movementWindow = await prisma.inventoryMovementWindow.update({
      where: {
        id: pendingWindow.id,
      },
      data: {
        latestAvailable: available,
        netDelta: available - pendingWindow.startingAvailable,
        lastChangeAt: now,
        finalizeAfter,

        productId:
          normalizeOptionalString(input.productId) ?? pendingWindow.productId,
        variantId:
          normalizeOptionalString(input.variantId) ?? pendingWindow.variantId,
        sku: normalizeOptionalString(input.sku) ?? pendingWindow.sku,
        productTitle:
          normalizeOptionalString(input.productTitle) ??
          pendingWindow.productTitle,
        variantTitle:
          normalizeOptionalString(input.variantTitle) ??
          pendingWindow.variantTitle,
        locationName:
          normalizeOptionalString(input.locationName) ??
          pendingWindow.locationName,
      },
    });
  } else {
    movementWindow = await prisma.inventoryMovementWindow.create({
      data: {
        shop,
        productId:
          normalizeOptionalString(input.productId) ?? existingSnapshot.productId,
        variantId:
          normalizeOptionalString(input.variantId) ?? existingSnapshot.variantId,
        inventoryItemId,
        locationId,
        sku: normalizeOptionalString(input.sku) ?? existingSnapshot.sku,
        productTitle:
          normalizeOptionalString(input.productTitle) ??
          existingSnapshot.productTitle,
        variantTitle:
          normalizeOptionalString(input.variantTitle) ??
          existingSnapshot.variantTitle,
        locationName:
          normalizeOptionalString(input.locationName) ??
          existingSnapshot.locationName,

        startingAvailable: previousAvailable,
        latestAvailable: available,
        netDelta: available - previousAvailable,

        firstChangeAt: now,
        lastChangeAt: now,
        finalizeAfter,
        status: "Pending",
      },
    });
  }

  const snapshot = await prisma.inventorySnapshot.update({
    where: {
      shop_inventoryItemId_locationId: {
        shop,
        inventoryItemId,
        locationId,
      },
    },
    data: {
      available,
      productId:
        normalizeOptionalString(input.productId) ?? existingSnapshot.productId,
      variantId:
        normalizeOptionalString(input.variantId) ?? existingSnapshot.variantId,
      sku: normalizeOptionalString(input.sku) ?? existingSnapshot.sku,
      productTitle:
        normalizeOptionalString(input.productTitle) ??
        existingSnapshot.productTitle,
      variantTitle:
        normalizeOptionalString(input.variantTitle) ??
        existingSnapshot.variantTitle,
      locationName:
        normalizeOptionalString(input.locationName) ??
        existingSnapshot.locationName,
    },
  });

  return {
    action: pendingWindow
      ? "updated_pending_movement_window"
      : "created_pending_movement_window",
    previousAvailable,
    newAvailable: available,
    immediateDelta: available - previousAvailable,
    movementWindow,
    snapshot,
  };
}