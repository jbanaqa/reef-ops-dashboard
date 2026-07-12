import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type VariantInput = {
  shop?: string;
  productId?: string | null;
  variantId?: string;
  inventoryItemId?: string | null;
  productTitle?: string;
  variantTitle?: string | null;
  sku?: string | null;
  unitsPerVariant?: number;
  isActive?: boolean;
};

type MappingInput = {
  supplierItemId?: string | null;
  supplierCode?: string | null;
  supplierName?: string;

  targetStockQuantity?: number;
  isActive?: boolean;

  variants?: VariantInput[];
};

function normalizeSupplierName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.trim();
  return cleaned || null;
}

function validateInput(input: MappingInput): string | null {
  if (
    !input.supplierItemId?.trim() &&
    !input.supplierName?.trim()
  ) {
    return "Select an RVS supplier item.";
  }

  if (
    !Number.isInteger(input.targetStockQuantity) ||
    Number(input.targetStockQuantity) < 0
  ) {
    return "Target stock quantity must be zero or greater.";
  }

  if (
    !Array.isArray(input.variants) ||
    input.variants.length === 0
  ) {
    return "Add at least one Shopify variant.";
  }

  for (let index = 0; index < input.variants.length; index += 1) {
    const variant = input.variants[index];

    if (!variant.productTitle?.trim()) {
      return `Product title is required for variant ${index + 1}.`;
    }

    if (!variant.variantId?.trim()) {
      return `Variant ID is required for variant ${index + 1}.`;
    }

    if (
      !Number.isInteger(variant.unitsPerVariant) ||
      Number(variant.unitsPerVariant) < 1
    ) {
      return `Physical units must be at least 1 for variant ${
        index + 1
      }.`;
    }
  }

  return null;
}

function cleanMappingResponse<
  T extends {
    createdAt: Date;
    updatedAt: Date;
    variants: Array<{
      createdAt: Date;
      updatedAt: Date;
    }>;
    supplierItem?: {
      lastSeenAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    } | null;
  },
>(mapping: T) {
  return {
    ...mapping,
    createdAt: mapping.createdAt.toISOString(),
    updatedAt: mapping.updatedAt.toISOString(),

    supplierItem: mapping.supplierItem
      ? {
          ...mapping.supplierItem,
          lastSeenAt:
            mapping.supplierItem.lastSeenAt?.toISOString() ??
            null,
          createdAt:
            mapping.supplierItem.createdAt.toISOString(),
          updatedAt:
            mapping.supplierItem.updatedAt.toISOString(),
        }
      : null,

    variants: mapping.variants.map((variant) => ({
      ...variant,
      createdAt: variant.createdAt.toISOString(),
      updatedAt: variant.updatedAt.toISOString(),
    })),
  };
}

async function resolveSupplierItem(input: MappingInput) {
  const supplierItemId = cleanOptionalString(
    input.supplierItemId,
  );

  if (supplierItemId) {
    const supplierItem = await prisma.supplierItem.findUnique({
      where: {
        id: supplierItemId,
      },
    });

    if (!supplierItem) {
      throw new Error(
        "The selected RVS supplier item no longer exists.",
      );
    }

    return supplierItem;
  }

  const supplierCode = cleanOptionalString(input.supplierCode);

  if (supplierCode) {
    return prisma.supplierItem.findUnique({
      where: {
        supplierCode,
      },
    });
  }

  return null;
}

export async function PUT(
  request: NextRequest,
  context: RouteContext,
) {
  try {
    const { id } = await context.params;
    const input = (await request.json()) as MappingInput;

    const validationError = validateInput(input);

    if (validationError) {
      return NextResponse.json(
        {
          error: validationError,
        },
        {
          status: 400,
        },
      );
    }

    const existingMapping =
      await prisma.reorderMapping.findUnique({
        where: {
          id,
        },
      });

    if (!existingMapping) {
      return NextResponse.json(
        {
          error: "The mapping could not be found.",
        },
        {
          status: 404,
        },
      );
    }

    const supplierItem = await resolveSupplierItem(input);

    const supplierName = supplierItem
      ? supplierItem.supplierName
      : input.supplierName!.trim();

    const normalizedSupplierName = supplierItem
      ? supplierItem.normalizedSupplierName
      : normalizeSupplierName(supplierName);

    const supplierCode = supplierItem
      ? supplierItem.supplierCode
      : cleanOptionalString(input.supplierCode);

    const duplicateConditions: Array<
      | { normalizedSupplierName: string }
      | { supplierCode: string }
      | { supplierItemId: string }
    > = [
      {
        normalizedSupplierName,
      },
    ];

    if (supplierCode) {
      duplicateConditions.push({
        supplierCode,
      });
    }

    if (supplierItem) {
      duplicateConditions.push({
        supplierItemId: supplierItem.id,
      });
    }

    const duplicate = await prisma.reorderMapping.findFirst({
      where: {
        id: {
          not: id,
        },
        OR: duplicateConditions,
      },
    });

    if (duplicate) {
      return NextResponse.json(
        {
          error:
            "Another mapping already exists for this RVS supplier item.",
        },
        {
          status: 409,
        },
      );
    }

    const mapping = await prisma.$transaction(
      async (transaction) => {
        await transaction.reorderVariantMapping.deleteMany({
          where: {
            mappingId: id,
          },
        });

        return transaction.reorderMapping.update({
          where: {
            id,
          },

          data: {
            supplierItemId: supplierItem?.id ?? null,
            supplierCode,
            supplierName,
            normalizedSupplierName,

            targetStockQuantity: Number(
              input.targetStockQuantity,
            ),

            isActive: input.isActive !== false,

            variants: {
              create: input.variants!.map((variant) => ({
                shop:
                  variant.shop?.trim() ||
                  "corals-anonymous.myshopify.com",

                productId: cleanOptionalString(
                  variant.productId,
                ),

                variantId: variant.variantId!.trim(),

                inventoryItemId: cleanOptionalString(
                  variant.inventoryItemId,
                ),

                productTitle: variant.productTitle!.trim(),

                variantTitle: cleanOptionalString(
                  variant.variantTitle,
                ),

                sku: cleanOptionalString(variant.sku),

                unitsPerVariant: Number(
                  variant.unitsPerVariant,
                ),

                isActive: variant.isActive !== false,
              })),
            },
          },

          include: {
            supplierItem: true,
            variants: true,
          },
        });
      },
    );

    return NextResponse.json({
      mapping: cleanMappingResponse(mapping),
    });
  } catch (error) {
    console.error("Failed to update reorder mapping:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The mapping could not be updated.",
      },
      {
        status: 500,
      },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext,
) {
  try {
    const { id } = await context.params;

    await prisma.reorderMapping.delete({
      where: {
        id,
      },
    });

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error("Failed to delete reorder mapping:", error);

    return NextResponse.json(
      {
        error: "The mapping could not be deleted.",
      },
      {
        status: 500,
      },
    );
  }
}