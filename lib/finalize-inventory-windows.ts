import { prisma } from "@/lib/prisma";

function getEventType(netDelta: number, matchedOrderQuantity: number) {
  if (netDelta === 0) {
    return "IgnoredNetZero";
  }

  if (netDelta > 0) {
    return "Increase";
  }

  const decrementQuantity = Math.abs(netDelta);

  if (matchedOrderQuantity >= decrementQuantity) {
    return "SaleMatched";
  }

  if (matchedOrderQuantity > 0) {
    return "PartialUnknownDecrement";
  }

  return "UnknownDecrement";
}

export async function finalizeReadyInventoryWindows() {
  const now = new Date();

  const pendingWindows = await prisma.inventoryMovementWindow.findMany({
    where: {
      status: "Pending",
      finalizeAfter: {
        lte: now,
      },
    },
    orderBy: {
      firstChangeAt: "asc",
    },
    take: 100,
  });

  const finalized = [];
  const ignored = [];

  for (const window of pendingWindows) {
    const netDelta = window.netDelta;

    if (netDelta === 0) {
      const updatedWindow = await prisma.inventoryMovementWindow.update({
        where: {
          id: window.id,
        },
        data: {
          status: "Ignored",
        },
      });

      ignored.push({
        windowId: updatedWindow.id,
        reason: "net_zero",
        startingAvailable: window.startingAvailable,
        latestAvailable: window.latestAvailable,
        netDelta,
      });

      continue;
    }

    let matchedOrderQuantity = 0;
    let unknownChangeQuantity = 0;
    const matchedOrderIds: string[] = [];
    const matchedOrderNames: string[] = [];

    if (netDelta < 0) {
      const decrementQuantity = Math.abs(netDelta);

      const matchingClaims = await prisma.orderInventoryClaim.findMany({
        where: {
          shop: window.shop,
          OR: [
            window.variantId
              ? {
                  variantId: window.variantId,
                }
              : undefined,
            {
              inventoryItemId: window.inventoryItemId,
            },
          ].filter(Boolean) as {
            variantId?: string;
            inventoryItemId?: string;
          }[],
          orderCreatedAt: {
            gte: new Date(window.firstChangeAt.getTime() - 60 * 60 * 1000),
            lte: new Date(window.lastChangeAt.getTime() + 60 * 60 * 1000),
          },
        },
        orderBy: {
          orderCreatedAt: "asc",
        },
      });

      let remainingToMatch = decrementQuantity;

      for (const claim of matchingClaims) {
        const availableToClaim = claim.quantitySold - claim.claimedQuantity;

        if (availableToClaim <= 0) {
          continue;
        }

        const quantityToClaim = Math.min(availableToClaim, remainingToMatch);

        matchedOrderQuantity += quantityToClaim;
        remainingToMatch -= quantityToClaim;

        matchedOrderIds.push(claim.orderId);

        if (claim.orderName) {
          matchedOrderNames.push(claim.orderName);
        }

        await prisma.orderInventoryClaim.update({
          where: {
            id: claim.id,
          },
          data: {
            claimedQuantity: claim.claimedQuantity + quantityToClaim,
          },
        });

        if (remainingToMatch <= 0) {
          break;
        }
      }

      unknownChangeQuantity = Math.max(
        0,
        decrementQuantity - matchedOrderQuantity
      );
    }

    const eventType = getEventType(netDelta, matchedOrderQuantity);

    const event = await prisma.inventoryEvent.create({
      data: {
        shop: window.shop,

        productId: window.productId,
        variantId: window.variantId,
        inventoryItemId: window.inventoryItemId,
        locationId: window.locationId,

        sku: window.sku,
        productTitle: window.productTitle,
        variantTitle: window.variantTitle,
        locationName: window.locationName,

        startingAvailable: window.startingAvailable,
        endingAvailable: window.latestAvailable,
        netDelta,

        matchedOrderQuantity,
        unknownChangeQuantity,

        eventType,
        matchedOrderIds:
          matchedOrderIds.length > 0 ? matchedOrderIds.join(",") : null,
        matchedOrderNames:
          matchedOrderNames.length > 0 ? matchedOrderNames.join(",") : null,

        reviewStatus:
          eventType === "UnknownDecrement" ||
          eventType === "PartialUnknownDecrement"
            ? "Unreviewed"
            : "Reviewed",

        detectedAt: window.lastChangeAt,
      },
    });

    await prisma.inventoryMovementWindow.update({
      where: {
        id: window.id,
      },
      data: {
        status: "Finalized",
      },
    });

    finalized.push(event);
  }

  return {
    processed: pendingWindows.length,
    finalizedCount: finalized.length,
    ignoredCount: ignored.length,
    finalized,
    ignored,
  };
}