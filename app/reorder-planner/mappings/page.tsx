import { prisma } from "@/lib/prisma";
import MappingManager from "./MappingManager";

export const dynamic = "force-dynamic";

export default async function ReorderMappingsPage() {
  const mappings = await prisma.reorderMapping.findMany({
    include: {
      supplierItem: true,

      variants: {
        orderBy: [
          {
            productTitle: "asc",
          },
          {
            variantTitle: "asc",
          },
        ],
      },
    },

    orderBy: {
      supplierName: "asc",
    },
  });

  const serializedMappings = mappings.map((mapping) => ({
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
  }));

  return (
    <MappingManager initialMappings={serializedMappings} />
  );
}