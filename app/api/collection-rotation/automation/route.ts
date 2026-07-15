import {
  NextRequest,
  NextResponse,
} from "next/server";

import { prisma } from "@/lib/prisma";

import {
  getShopifyShopDomain,
} from "@/lib/shopify";

import {
  formatScheduleInterval,
  getCollectionRotationIntervalMinutes,
  getNextScheduleBoundary,
  isCollectionRotationScheduleEnabled,
} from "@/lib/collection-rotation-schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AutomationRequestBody = {
  collectionId?: unknown;
  collectionTitle?: unknown;
  collectionHandle?: unknown;
  isEnabled?: unknown;
};

export async function GET() {
  try {
    const shop =
      getShopifyShopDomain();

    const intervalMinutes =
      getCollectionRotationIntervalMinutes();

    const [enabledCollectionCount, lastRun] =
      await Promise.all([
        prisma.collectionRotation.count({
          where: {
            shop,
            isEnabled: true,
          },
        }),

        prisma.collectionRotationScheduleRun.findFirst({
          orderBy: {
            scheduledFor: "desc",
          },

          select: {
            id: true,
            scheduledFor: true,
            status: true,
            enabledCount: true,
            completedCount: true,
            failedCount: true,
            startedAt: true,
            completedAt: true,
          },
        }),
      ]);

    return NextResponse.json({
      ok: true,

      serverNow:
        new Date().toISOString(),

      scheduleEnabled:
        isCollectionRotationScheduleEnabled(),

      intervalMinutes,

      intervalLabel:
        formatScheduleInterval(
          intervalMinutes
        ),

      enabledCollectionCount,

      nextScheduledRunAt:
        getNextScheduleBoundary()
          .toISOString(),

      lastRun: lastRun
        ? {
            ...lastRun,

            scheduledFor:
              lastRun.scheduledFor
                .toISOString(),

            startedAt:
              lastRun.startedAt
                .toISOString(),

            completedAt:
              lastRun.completedAt
                ?.toISOString() ??
              null,
          }
        : null,
    });
  } catch (error) {
    console.error(
      "Failed to load collection automation status:",
      error
    );

    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : "Failed to load collection automation status.",
      },
      {
        status: 500,
      }
    );
  }
}

export async function POST(
  request: NextRequest
) {
  try {
    const body =
      (await request.json()) as AutomationRequestBody;

    const collectionId =
      typeof body.collectionId ===
      "string"
        ? body.collectionId.trim()
        : "";

    const collectionTitle =
      typeof body.collectionTitle ===
      "string"
        ? body.collectionTitle.trim()
        : "";

    const collectionHandle =
      typeof body.collectionHandle ===
      "string"
        ? body.collectionHandle.trim()
        : "";

    if (
      !collectionId ||
      !collectionTitle
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "collectionId and collectionTitle are required.",
        },
        {
          status: 400,
        }
      );
    }

    if (
      typeof body.isEnabled !==
      "boolean"
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "isEnabled must be a boolean.",
        },
        {
          status: 400,
        }
      );
    }

    const shop =
      getShopifyShopDomain();

    const rotation =
      await prisma.collectionRotation.upsert({
        where: {
          shop_shopifyCollectionId: {
            shop,
            shopifyCollectionId:
              collectionId,
          },
        },

        update: {
          collectionTitle,
          collectionHandle:
            collectionHandle || null,
          isEnabled:
            body.isEnabled,
        },

        create: {
          shop,
          shopifyCollectionId:
            collectionId,
          collectionTitle,
          collectionHandle:
            collectionHandle || null,
          isEnabled:
            body.isEnabled,
        },

        select: {
          shopifyCollectionId: true,
          isEnabled: true,
        },
      });

    const enabledCollectionCount =
      await prisma.collectionRotation.count({
        where: {
          shop,
          isEnabled: true,
        },
      });

    return NextResponse.json({
      ok: true,

      collectionId:
        rotation.shopifyCollectionId,

      isEnabled:
        rotation.isEnabled,

      enabledCollectionCount,
    });
  } catch (error) {
    console.error(
      "Failed to update collection automation:",
      error
    );

    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : "Failed to update collection automation.",
      },
      {
        status: 500,
      }
    );
  }
}