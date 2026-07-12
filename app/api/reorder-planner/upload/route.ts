import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { shopifyGraphql } from "@/lib/shopify";

export const runtime = "nodejs";

type SpreadsheetRow = {
  code: string;
  normalizedCode: string;
  supplierName: string;
  normalizedSupplierName: string;
  supplierAvailable: number;
  spreadsheetRow: number;
};

type ShopifyInventoryNode = {
  id: string;
  legacyResourceId: string;

  inventoryLevels: {
    nodes: {
      quantities: {
        name: string;
        quantity: number;
      }[];
    }[];
  };
};

type InventoryResponse = {
  data?: {
    nodes?: Array<ShopifyInventoryNode | null>;
  };
};

type InventoryTotals = Map<string, number>;

const INVENTORY_QUERY = `
  query ReorderInventoryItems($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on InventoryItem {
        id
        legacyResourceId
        inventoryLevels(first: 100) {
          nodes {
            quantities(names: ["available"]) {
              name
              quantity
            }
          }
        }
      }
    }
  }
`;

function normalizeSupplierName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSupplierCode(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function cleanText(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function parseQuantity(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }

  const cleaned = cleanText(value).replace(/,/g, "");
  const parsed = Number(cleaned);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(0, Math.floor(parsed));
}

function parseRvsSpreadsheet(buffer: Buffer): SpreadsheetRow[] {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    raw: true,
    cellDates: false,
  });

  if (workbook.SheetNames.length === 0) {
    throw new Error(
      "The spreadsheet does not contain any worksheets.",
    );
  }

  const stockReportSheetName =
    workbook.SheetNames.find(
      (sheetName) =>
        sheetName.trim().toUpperCase() === "STOCK REPORT",
    ) ?? workbook.SheetNames[0];

  const worksheet = workbook.Sheets[stockReportSheetName];

  if (!worksheet) {
    throw new Error(
      "The STOCK REPORT worksheet could not be read.",
    );
  }

  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(
    worksheet,
    {
      header: 1,
      defval: "",
      raw: true,
    },
  );

  const rowsByCode = new Map<string, SpreadsheetRow>();

  for (let index = 0; index < rawRows.length; index += 1) {
    const row = rawRows[index];

    const code = cleanText(row[0]);
    const normalizedCode = normalizeSupplierCode(code);
    const supplierName = cleanText(row[1]);
    const supplierAvailable = parseQuantity(row[4]);

    if (
      !normalizedCode ||
      !supplierName ||
      supplierAvailable === null
    ) {
      continue;
    }

    if (
      normalizedCode === "CODE" ||
      supplierName.toUpperCase() === "COMMON NAME"
    ) {
      continue;
    }

    const normalizedSupplierName =
      normalizeSupplierName(supplierName);

    if (!normalizedSupplierName) {
      continue;
    }

    const parsedRow: SpreadsheetRow = {
      code: normalizedCode,
      normalizedCode,
      supplierName,
      normalizedSupplierName,
      supplierAvailable,
      spreadsheetRow: index + 1,
    };

    const existing = rowsByCode.get(normalizedCode);

    if (!existing) {
      rowsByCode.set(normalizedCode, parsedRow);
      continue;
    }

    if (
      parsedRow.supplierAvailable >
      existing.supplierAvailable
    ) {
      rowsByCode.set(normalizedCode, {
        ...parsedRow,
        spreadsheetRow: Math.min(
          existing.spreadsheetRow,
          parsedRow.spreadsheetRow,
        ),
      });
    }
  }

  return Array.from(rowsByCode.values()).sort(
    (first, second) =>
      first.supplierName.localeCompare(second.supplierName),
  );
}

function toInventoryItemGid(inventoryItemId: string) {
  if (
    inventoryItemId.startsWith(
      "gid://shopify/InventoryItem/",
    )
  ) {
    return inventoryItemId;
  }

  return `gid://shopify/InventoryItem/${inventoryItemId}`;
}

function chunkArray<T>(values: T[], size: number) {
  const chunks: T[][] = [];

  for (
    let index = 0;
    index < values.length;
    index += size
  ) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

async function getInventoryTotals(
  inventoryItemIds: string[],
): Promise<InventoryTotals> {
  const uniqueIds = Array.from(
    new Set(
      inventoryItemIds
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );

  const totals: InventoryTotals = new Map();

  for (const id of uniqueIds) {
    totals.set(id, 0);
  }

  const chunks = chunkArray(uniqueIds, 100);

  for (const chunk of chunks) {
    const response =
      await shopifyGraphql<InventoryResponse>(
        INVENTORY_QUERY,
        {
          ids: chunk.map(toInventoryItemGid),
        },
      );

    for (const node of response.data?.nodes ?? []) {
      if (!node) {
        continue;
      }

      let available = 0;

      for (
        const inventoryLevel of node.inventoryLevels.nodes
      ) {
        const availableQuantity =
          inventoryLevel.quantities.find(
            (quantity) =>
              quantity.name === "available",
          );

        available += availableQuantity?.quantity ?? 0;
      }

      totals.set(
        String(node.legacyResourceId),
        available,
      );
    }
  }

  return totals;
}

async function upsertSupplierCatalog(
  supplierRows: SpreadsheetRow[],
) {
  const uploadTime = new Date();

  for (const row of supplierRows) {
    await prisma.supplierItem.upsert({
      where: {
        supplierCode: row.normalizedCode,
      },

      create: {
        supplierCode: row.normalizedCode,
        supplierName: row.supplierName,
        normalizedSupplierName:
          row.normalizedSupplierName,
        latestAvailableQty: row.supplierAvailable,
        lastSeenAt: uploadTime,
      },

      update: {
        supplierName: row.supplierName,
        normalizedSupplierName:
          row.normalizedSupplierName,
        latestAvailableQty: row.supplierAvailable,
        lastSeenAt: uploadTime,
      },
    });
  }

  const supplierItems = await prisma.supplierItem.findMany({
    where: {
      supplierCode: {
        in: supplierRows.map(
          (row) => row.normalizedCode,
        ),
      },
    },
  });

  return new Map(
    supplierItems.map((item) => [
      item.supplierCode,
      item,
    ]),
  );
}

async function backfillExistingMappings() {
  const unlinkedMappings =
    await prisma.reorderMapping.findMany({
      where: {
        supplierItemId: null,
      },
    });

  if (unlinkedMappings.length === 0) {
    return;
  }

  const normalizedNames = Array.from(
    new Set(
      unlinkedMappings.map(
        (mapping) =>
          mapping.normalizedSupplierName,
      ),
    ),
  );

  const possibleSupplierItems =
    await prisma.supplierItem.findMany({
      where: {
        normalizedSupplierName: {
          in: normalizedNames,
        },
      },
    });

  const itemsByNormalizedName = new Map<
    string,
    typeof possibleSupplierItems
  >();

  for (const item of possibleSupplierItems) {
    const current =
      itemsByNormalizedName.get(
        item.normalizedSupplierName,
      ) ?? [];

    current.push(item);

    itemsByNormalizedName.set(
      item.normalizedSupplierName,
      current,
    );
  }

  for (const mapping of unlinkedMappings) {
    const matches =
      itemsByNormalizedName.get(
        mapping.normalizedSupplierName,
      ) ?? [];

    if (matches.length !== 1) {
      continue;
    }

    const supplierItem = matches[0];

    const existingCodeMapping =
      await prisma.reorderMapping.findFirst({
        where: {
          id: {
            not: mapping.id,
          },

          OR: [
            {
              supplierCode:
                supplierItem.supplierCode,
            },
            {
              supplierItemId: supplierItem.id,
            },
          ],
        },
      });

    if (existingCodeMapping) {
      continue;
    }

    await prisma.reorderMapping.update({
      where: {
        id: mapping.id,
      },

      data: {
        supplierItemId: supplierItem.id,
        supplierCode:
          supplierItem.supplierCode,
        supplierName:
          supplierItem.supplierName,
        normalizedSupplierName:
          supplierItem.normalizedSupplierName,
      },
    });
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const fileValue = formData.get("file");

    if (!(fileValue instanceof File)) {
      return NextResponse.json(
        {
          error: "Choose an RVS spreadsheet to upload.",
        },
        {
          status: 400,
        },
      );
    }

    const lowercaseFilename =
      fileValue.name.toLowerCase();

    if (
      !lowercaseFilename.endsWith(".xls") &&
      !lowercaseFilename.endsWith(".xlsx")
    ) {
      return NextResponse.json(
        {
          error:
            "The uploaded file must be an .xls or .xlsx spreadsheet.",
        },
        {
          status: 400,
        },
      );
    }

    const fileBuffer = Buffer.from(
      await fileValue.arrayBuffer(),
    );

    const supplierRows =
      parseRvsSpreadsheet(fileBuffer);

    if (supplierRows.length === 0) {
      return NextResponse.json(
        {
          error:
            "No supplier inventory rows were found in the spreadsheet.",
        },
        {
          status: 400,
        },
      );
    }

    const supplierItemsByCode =
      await upsertSupplierCatalog(supplierRows);

    await backfillExistingMappings();

    const mappings =
      await prisma.reorderMapping.findMany({
        where: {
          isActive: true,
        },

        include: {
          supplierItem: true,

          variants: {
            where: {
              isActive: true,
            },
          },
        },
      });

    const mappingsByCode = new Map(
      mappings
        .filter(
          (
            mapping,
          ): mapping is typeof mapping & {
            supplierCode: string;
          } => Boolean(mapping.supplierCode),
        )
        .map((mapping) => [
          mapping.supplierCode,
          mapping,
        ]),
    );

    const mappingsByName = new Map(
      mappings.map((mapping) => [
        mapping.normalizedSupplierName,
        mapping,
      ]),
    );

    const inventoryItemIds = mappings.flatMap(
      (mapping) =>
        mapping.variants
          .map(
            (variant) =>
              variant.inventoryItemId,
          )
          .filter(
            (
              inventoryItemId,
            ): inventoryItemId is string =>
              Boolean(inventoryItemId),
          ),
    );

    const inventoryTotals =
      await getInventoryTotals(inventoryItemIds);

    const rows = supplierRows.map(
      (supplierRow) => {
        const supplierItem =
          supplierItemsByCode.get(
            supplierRow.normalizedCode,
          );

        const mapping =
          mappingsByCode.get(
            supplierRow.normalizedCode,
          ) ??
          mappingsByName.get(
            supplierRow.normalizedSupplierName,
          );

        if (!mapping) {
          return {
            code: supplierRow.normalizedCode,

            supplierItemId:
              supplierItem?.id ?? null,

            supplierName:
              supplierRow.supplierName,

            supplierAvailable:
              supplierRow.supplierAvailable,

            spreadsheetRow:
              supplierRow.spreadsheetRow,

            mapped: false,
            mappingId: null,

            currentPhysicalStock: null,
            targetStockQuantity: null,
            recommendedOrderQuantity: 0,

            variants: [],
          };
        }

        const variants = mapping.variants.map(
          (variant) => {
            const shopifyAvailable =
              variant.inventoryItemId
                ? inventoryTotals.get(
                    variant.inventoryItemId,
                  ) ?? 0
                : 0;

            const physicalStock =
              shopifyAvailable *
              variant.unitsPerVariant;

            return {
              productId: variant.productId,
              variantId: variant.variantId,

              inventoryItemId:
                variant.inventoryItemId,

              productTitle:
                variant.productTitle,

              variantTitle:
                variant.variantTitle,

              sku: variant.sku,

              shopifyAvailable,

              unitsPerVariant:
                variant.unitsPerVariant,

              physicalStock,
            };
          },
        );

        const currentPhysicalStock =
          variants.reduce(
            (total, variant) =>
              total + variant.physicalStock,
            0,
          );

        const stockShortfall = Math.max(
          mapping.targetStockQuantity -
            currentPhysicalStock,
          0,
        );

        const recommendedOrderQuantity =
          Math.min(
            stockShortfall,
            supplierRow.supplierAvailable,
          );

        return {
          code: supplierRow.normalizedCode,

          supplierItemId:
            supplierItem?.id ??
            mapping.supplierItemId ??
            null,

          supplierName:
            supplierRow.supplierName,

          supplierAvailable:
            supplierRow.supplierAvailable,

          spreadsheetRow:
            supplierRow.spreadsheetRow,

          mapped: true,
          mappingId: mapping.id,

          currentPhysicalStock,

          targetStockQuantity:
            mapping.targetStockQuantity,

          recommendedOrderQuantity,

          variants,
        };
      },
    );

    const mappedRows = rows.filter(
      (row) => row.mapped,
    );

    const recommendedRows = mappedRows.filter(
      (row) =>
        row.recommendedOrderQuantity > 0,
    );

    return NextResponse.json({
      filename: fileValue.name,
      sheetName: "STOCK REPORT",

      totals: {
        supplierRows: rows.length,
        mappedRows: mappedRows.length,

        unmappedRows:
          rows.length - mappedRows.length,

        recommendedRows:
          recommendedRows.length,

        recommendedUnits:
          recommendedRows.reduce(
            (total, row) =>
              total +
              row.recommendedOrderQuantity,
            0,
          ),
      },

      rows,
    });
  } catch (error) {
    console.error(
      "Failed to process supplier spreadsheet:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The supplier spreadsheet could not be processed.",
      },
      {
        status: 500,
      },
    );
  }
}