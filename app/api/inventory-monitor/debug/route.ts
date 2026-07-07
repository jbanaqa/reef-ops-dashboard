import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rawUpdates = await prisma.rawInventoryUpdate.findMany({
      orderBy: {
        receivedAt: "desc",
      },
      take: 10,
    });

    const snapshots = await prisma.inventorySnapshot.findMany({
      orderBy: {
        updatedAt: "desc",
      },
      take: 10,
    });

    const windows = await prisma.inventoryMovementWindow.findMany({
      orderBy: {
        updatedAt: "desc",
      },
      take: 10,
    });

    const events = await prisma.inventoryEvent.findMany({
      orderBy: {
        createdAt: "desc",
      },
      take: 10,
    });

    return NextResponse.json({
      ok: true,
      rawUpdates,
      snapshots,
      windows,
      events,
    });
  } catch (error) {
    console.error("Inventory monitor debug error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load inventory monitor debug data.",
      },
      { status: 500 }
    );
  }
}