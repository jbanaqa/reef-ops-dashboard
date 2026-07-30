import { createSign } from "node:crypto";

import { prisma } from "@/lib/prisma";
import {
  getShopifyShopDomain,
  shopifyGraphql,
} from "@/lib/shopify";

export type AnalyticsSource = "SHOPIFY_REPORTS" | "GA4";

type AnalyticsRow = {
  productId: string;
  productTitle: string | null;
  productViews: number;
  listViews: number;
  listClicks: number;
  addsToCart: number;
  purchases: number;
  unitsSold: number;
  revenue: number;
};

type ShopifyQlResponse = {
  data?: {
    shopifyqlQuery?: {
      parseErrors: string[];
      tableData?: {
        columns: Array<{
          name: string;
          dataType: string;
          displayName: string;
        }>;
        rows: unknown[];
      } | null;
    } | null;
  };
};

const SHOPIFY_REPORT_QUERY = `
  query CollectionRotationSales($query: String!) {
    shopifyqlQuery(query: $query) {
      parseErrors
      tableData {
        columns {
          name
          dataType
          displayName
        }
        rows
      }
    }
  }
`;

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeProductId(value: unknown) {
  const text = String(value ?? "").trim();
  const gidMatch = text.match(/gid:\/\/shopify\/Product\/(\d+)/i);

  if (gidMatch) {
    return gidMatch[1];
  }

  const shopifyItemMatch = text.match(/^shopify_[A-Z]{2}_(\d+)_\d+$/i);

  if (shopifyItemMatch) {
    return shopifyItemMatch[1];
  }

  return /^\d+$/.test(text) ? text : "";
}

function rowObject(
  row: unknown,
  columns: Array<{ name: string }>
) {
  if (Array.isArray(row)) {
    return Object.fromEntries(
      columns.map((column, index) => [column.name, row[index]])
    );
  }

  return typeof row === "object" && row !== null
    ? (row as Record<string, unknown>)
    : {};
}

export async function fetchShopifyReportMetrics(
  lookbackDays: number,
  periodOffset = 0
  
): Promise<AnalyticsRow[]> {
  // periodOffset 0 = the window ending now. periodOffset 1 = the
  // equal-length window immediately before that one (used to compute sales
  // momentum by comparing recent vs. prior activity).
  const windowEndedAt = new Date(
    Date.now() - periodOffset * lookbackDays * 86_400_000
  );
  const windowStartedAt = new Date(
    windowEndedAt.getTime() - lookbackDays * 86_400_000
  );
  const query = [
    "FROM sales",
    "SHOW net_items_sold, orders, net_sales",
    "GROUP BY product_id, product_title",
    `SINCE ${windowStartedAt.toISOString().slice(0, 10)}`,
    `UNTIL ${windowEndedAt.toISOString().slice(0, 10)}`,
    "ORDER BY net_sales DESC",
    "LIMIT 1000",
  ].join(" ");
  const response = await shopifyGraphql<ShopifyQlResponse>(
    SHOPIFY_REPORT_QUERY,
    { query }
  );
  const result = response.data?.shopifyqlQuery;

  if (!result) {
    throw new Error("Shopify did not return report data.");
  }

  if (result.parseErrors.length > 0) {
    throw new Error(
      `ShopifyQL could not parse the sales report: ${result.parseErrors.join(
        "; "
      )}`
    );
  }

  const table = result.tableData;

  if (!table) {
    return [];
  }

  return table.rows
    .map((row) => rowObject(row, table.columns))
    .map((row) => ({
      productId: normalizeProductId(row.product_id),
      productTitle: String(row.product_title ?? "").trim() || null,
      productViews: 0,
      listViews: 0,
      listClicks: 0,
      addsToCart: 0,
      purchases: Math.max(0, Math.round(numberValue(row.orders))),
      unitsSold: Math.max(0, Math.round(numberValue(row.net_items_sold))),
      revenue: Math.max(0, numberValue(row.net_sales)),
    }))
    .filter((row) => row.productId);
}

function base64Url(value: string | Buffer) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function getGoogleAccessToken() {
  const email = process.env.GA4_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GA4_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(
    /\\n/g,
    "\n"
  );

  if (!email || !privateKey) {
    throw new Error(
      "GA4_SERVICE_ACCOUNT_EMAIL and GA4_SERVICE_ACCOUNT_PRIVATE_KEY are required."
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(
    JSON.stringify({
      iss: email,
      scope: "https://www.googleapis.com/auth/analytics.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const unsignedToken = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedToken);
  signer.end();
  const assertion = `${unsignedToken}.${base64Url(
    signer.sign(privateKey)
  )}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = (await response.json()) as {
    access_token?: string;
    error_description?: string;
  };

  if (!response.ok || !data.access_token) {
    throw new Error(
      data.error_description || "Google did not issue an analytics token."
    );
  }

  return data.access_token;
}

export async function fetchGa4Metrics(
  lookbackDays: number
): Promise<AnalyticsRow[]> {
  const propertyId = process.env.GA4_PROPERTY_ID?.replace(
    /^properties\//,
    ""
  );

  if (!propertyId) {
    throw new Error("GA4_PROPERTY_ID is required.");
  }

  const accessToken = await getGoogleAccessToken();
  const response = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dateRanges: [{ startDate: `${lookbackDays}daysAgo`, endDate: "yesterday" }],
        dimensions: [{ name: "itemId" }, { name: "itemName" }],
        metrics: [
          { name: "itemViewEvents" },
          { name: "itemsViewedInList" },
          { name: "itemListClickEvents" },
          { name: "itemsAddedToCart" },
          { name: "itemsPurchased" },
          { name: "itemRevenue" },
        ],
        limit: "100000",
      }),
    }
  );
  const data = (await response.json()) as {
    rows?: Array<{
      dimensionValues?: Array<{ value?: string }>;
      metricValues?: Array<{ value?: string }>;
    }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(data.error?.message || "GA4 report request failed.");
  }

  return (data.rows ?? [])
    .map((row) => {
      const dimensions = row.dimensionValues ?? [];
      const metrics = row.metricValues ?? [];

      return {
        productId: normalizeProductId(dimensions[0]?.value),
        productTitle: dimensions[1]?.value || null,
        productViews: Math.round(numberValue(metrics[0]?.value)),
        listViews: Math.round(numberValue(metrics[1]?.value)),
        listClicks: Math.round(numberValue(metrics[2]?.value)),
        addsToCart: Math.round(numberValue(metrics[3]?.value)),
        purchases: Math.round(numberValue(metrics[4]?.value)),
        unitsSold: Math.round(numberValue(metrics[4]?.value)),
        revenue: numberValue(metrics[5]?.value),
      };
    })
    .filter((row) => row.productId);
}

function aggregateAnalyticsRows(rows: AnalyticsRow[]): AnalyticsRow[] {
  const byProductId = new Map<string, AnalyticsRow>();

  for (const row of rows) {
    const existing = byProductId.get(row.productId);

    if (!existing) {
      byProductId.set(row.productId, { ...row });
      continue;
    }

    // Different tracking sources (or a Shopify integration change mid-window)
    // can report the same product under more than one item ID string ‑ e.g.
    // a bare numeric ID from one tag and "shopify_US_<productId>_<variantId>"
    // from another. normalizeProductId() collapses both to the same product
    // ID, so once that happens here we combine their metrics instead of
    // letting the second row silently overwrite the first at upsert time.
    existing.productTitle = existing.productTitle ?? row.productTitle;
    existing.productViews += row.productViews;
    existing.listViews += row.listViews;
    existing.listClicks += row.listClicks;
    existing.addsToCart += row.addsToCart;
    existing.purchases += row.purchases;
    existing.unitsSold += row.unitsSold;
    existing.revenue += row.revenue;
  }

  return [...byProductId.values()];
}

export function getAnalyticsAvailability() {
  return {
    shopifyReports: true,
    ga4: Boolean(
      process.env.GA4_PROPERTY_ID &&
        process.env.GA4_SERVICE_ACCOUNT_EMAIL &&
        process.env.GA4_SERVICE_ACCOUNT_PRIVATE_KEY
    ),
  };
}

export async function syncCollectionAnalytics(
  source: AnalyticsSource,
  lookbackDays: number,
  periodOffset = 0
) {
  const shop = getShopifyShopDomain();
  const normalizedLookback = Math.min(
    90,
    Math.max(7, Math.round(lookbackDays))
  );
  const sync = await prisma.collectionAnalyticsSync.create({
    data: { shop, source, lookbackDays: normalizedLookback },
  });

  try {
    // The prior-period window (used for sales momentum) only exists as a
    // Shopify Reports concept right now - GA4 metrics aren't windowed this
    // way, and momentum doesn't depend on GA4 anyway.
    const rawRows =
      source === "GA4"
        ? await fetchGa4Metrics(normalizedLookback)
        : await fetchShopifyReportMetrics(normalizedLookback, periodOffset);
    const rows = aggregateAnalyticsRows(rawRows);
    const windowEndedAt = new Date(
      Date.now() - periodOffset * normalizedLookback * 86_400_000
    );
    const windowStartedAt = new Date(
      windowEndedAt.getTime() - normalizedLookback * 86_400_000
    );

    await prisma.$transaction(
      rows.map((row) =>
        prisma.collectionProductAnalytics.upsert({
          where: {
            shop_productId_source_lookbackDays_periodOffset: {
              shop,
              productId: row.productId,
              source,
              lookbackDays: normalizedLookback,
              periodOffset,
            },
          },
          create: {
            shop,
            source,
            lookbackDays: normalizedLookback,
            periodOffset,
            ...row,
            windowStartedAt,
            windowEndedAt,
          },
          update: {
            ...row,
            windowStartedAt,
            windowEndedAt,
            syncedAt: new Date(),
          },
        })
      )
    );

    await prisma.collectionAnalyticsSync.update({
      where: { id: sync.id },
      data: {
        status: "Completed",
        rowCount: rows.length,
        matchedCount: rows.length,
        completedAt: new Date(),
      },
    });

    return {
      source: periodOffset > 0 ? `${source} (prior period)` : source,
      lookbackDays: normalizedLookback,
      rowCount: rows.length,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Analytics sync failed.";

    await prisma.collectionAnalyticsSync.update({
      where: { id: sync.id },
      data: { status: "Failed", errorMessage: message, completedAt: new Date() },
    });

    throw error;
  }
}

// Refreshes analytics for every collection that's actually enabled for
// automatic rotation, right before the scheduled cycle shuffles them - so
// every shuffle works from data that's at most a few minutes old rather than
// whatever happened to be synced last (which, before this existed, could
// silently be hours or days stale if nobody remembered to click "Refresh
// analytics" and COLLECTION_ROTATION_ANALYTICS_AUTO_SYNC wasn't set).
//
// This intentionally does NOT skip based on how recently data was synced -
// the whole point is "as accurate as possible right before this specific
// shuffle," and re-running a ShopifyQL report per enabled lookback window
// every few hours is cheap. It also syncs each DISTINCT analyticsLookbackDays
// value actually configured across enabled collections (14/30/60/90), rather
// than one hardcoded global window - previously, a collection configured for
// e.g. a 90-day lookback would never get its own analytics populated by the
// scheduled sync (which only ever synced one fixed window), silently leaving
// it scoring against empty data until someone manually opened that
// collection's Strategy panel and clicked Refresh.
export async function syncAnalyticsForEnabledRotations() {
  // Kept as an explicit opt-OUT (not opt-in) escape hatch - e.g. for staging
  // environments that shouldn't hit Shopify's API automatically. Auto-sync
  // now happens by default, since depending on someone remembering to flip
  // this to "true" was exactly the gap this replaces.
  if (
    process.env.COLLECTION_ROTATION_ANALYTICS_AUTO_SYNC?.trim().toLowerCase() ===
    "false"
  ) {
    return { skipped: true, reason: "disabled via env var", results: [] };
  }

  const shop = getShopifyShopDomain();
  const enabledRotations = await prisma.collectionRotation.findMany({
    where: { shop, isEnabled: true },
    select: { analyticsLookbackDays: true },
  });

  if (enabledRotations.length === 0) {
    return { skipped: true, reason: "no enabled collections", results: [] };
  }

  const lookbackDaysList = [
    ...new Set(
      enabledRotations.map((rotation) =>
        Math.min(90, Math.max(7, Math.round(rotation.analyticsLookbackDays)))
      )
    ),
  ];
  const availability = getAnalyticsAvailability();
  const sources: AnalyticsSource[] = [
    "SHOPIFY_REPORTS",
    ...(availability.ga4 ? (["GA4"] as AnalyticsSource[]) : []),
  ];
  const results: Array<Record<string, unknown>> = [];

  for (const lookbackDays of lookbackDaysList) {
    for (const source of sources) {
      try {
        // syncCollectionAnalytics already returns its own lookbackDays (the
        // normalized value), so nothing extra needs to be added here.
        results.push(await syncCollectionAnalytics(source, lookbackDays));

        // Sales momentum (recent vs. prior period) only needs Shopify
        // Reports data, and only the current-period sync above needs to
        // have succeeded for the prior-period one to be worth attempting.
        if (source === "SHOPIFY_REPORTS") {
          try {
            results.push(
              await syncCollectionAnalytics(source, lookbackDays, 1)
            );
          } catch (priorError) {
            results.push({
              source: `${source}_PRIOR_PERIOD`,
              lookbackDays,
              error:
                priorError instanceof Error
                  ? priorError.message
                  : "Prior-period sync failed",
            });
          }
        }
      } catch (error) {
        results.push({
          source,
          lookbackDays,
          error: error instanceof Error ? error.message : "Sync failed",
        });
      }
    }
  }

  return { skipped: false, results };
}
