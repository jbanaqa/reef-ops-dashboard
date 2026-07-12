import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const searchText =
      request.nextUrl.searchParams.get("q")?.trim() ?? "";

    const requestedId =
      request.nextUrl.searchParams
        .get("id")
        ?.trim() ?? "";

    if (requestedId) {
      const item = await prisma.supplierItem.findUnique({
        where: {
          id: requestedId,
        },
        include: {
          reorderMapping: {
            select: {
              id: true,
            },
          },
        },
      });

      return NextResponse.json({
        items: item
          ? [
              {
                id: item.id,
                supplierCode: item.supplierCode,
                supplierName: item.supplierName,
                normalizedSupplierName:
                  item.normalizedSupplierName,
                latestAvailableQty:
                  item.latestAvailableQty,
                lastSeenAt:
                  item.lastSeenAt?.toISOString() ?? null,
                mappingId:
                  item.reorderMapping?.id ?? null,
              },
            ]
          : [],
      });
    }

    if (searchText.length < 1) {
      const items = await prisma.supplierItem.findMany({
        orderBy: [
          {
            lastSeenAt: "desc",
          },
          {
            supplierName: "asc",
          },
        ],
        take: 40,
        include: {
          reorderMapping: {
            select: {
              id: true,
            },
          },
        },
      });

      return NextResponse.json({
        items: items.map((item) => ({
          id: item.id,
          supplierCode: item.supplierCode,
          supplierName: item.supplierName,
          normalizedSupplierName:
            item.normalizedSupplierName,
          latestAvailableQty: item.latestAvailableQty,
          lastSeenAt:
            item.lastSeenAt?.toISOString() ?? null,
          mappingId: item.reorderMapping?.id ?? null,
        })),
      });
    }

    const items = await prisma.supplierItem.findMany({
      where: {
        OR: [
          {
            supplierCode: {
              contains: searchText,
              mode: "insensitive",
            },
          },
          {
            supplierName: {
              contains: searchText,
              mode: "insensitive",
            },
          },
          {
            normalizedSupplierName: {
              contains: searchText.toLowerCase(),
              mode: "insensitive",
            },
          },
        ],
      },

      orderBy: [
        {
          lastSeenAt: "desc",
        },
        {
          supplierName: "asc",
        },
      ],

      take: 40,

      include: {
        reorderMapping: {
          select: {
            id: true,
          },
        },
      },
    });

    return NextResponse.json({
      items: items.map((item) => ({
        id: item.id,
        supplierCode: item.supplierCode,
        supplierName: item.supplierName,
        normalizedSupplierName:
          item.normalizedSupplierName,
        latestAvailableQty: item.latestAvailableQty,
        lastSeenAt:
          item.lastSeenAt?.toISOString() ?? null,
        mappingId: item.reorderMapping?.id ?? null,
      })),
    });
  } catch (error) {
    console.error("Failed to search supplier items:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Supplier items could not be loaded.",
      },
      {
        status: 500,
      },
    );
  }
}