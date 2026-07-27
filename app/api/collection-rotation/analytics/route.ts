import { NextRequest, NextResponse } from "next/server";

import {
  getAnalyticsAvailability,
  syncCollectionAnalytics,
  type AnalyticsSource,
} from "@/lib/collection-rotation-analytics";
import { prisma } from "@/lib/prisma";
import { getShopifyShopDomain } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const shop = getShopifyShopDomain();
    const syncs = await prisma.collectionAnalyticsSync.findMany({
      where: { shop },
      orderBy: { startedAt: "desc" },
      take: 12,
    });

    return NextResponse.json({
      ok: true,
      availability: getAnalyticsAvailability(),
      syncs: syncs.map((sync) => ({
        ...sync,
        startedAt: sync.startedAt.toISOString(),
        completedAt: sync.completedAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not load analytics status.",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      sources?: unknown;
      lookbackDays?: unknown;
    };
    const requested = Array.isArray(body.sources)
      ? body.sources.map((source) => String(source).toUpperCase())
      : ["SHOPIFY_REPORTS"];
    const allowed = new Set<AnalyticsSource>(["SHOPIFY_REPORTS", "GA4"]);
    const sources = requested.filter(
      (source): source is AnalyticsSource =>
        allowed.has(source as AnalyticsSource)
    );

    if (sources.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Choose at least one analytics source." },
        { status: 400 }
      );
    }

    const lookbackDays = Math.min(
      90,
      Math.max(7, Math.round(Number(body.lookbackDays) || 30))
    );
    const results = [];

    for (const source of sources) {
      results.push(await syncCollectionAnalytics(source, lookbackDays));
    }

    return NextResponse.json({ ok: true, results });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Analytics sync failed.",
      },
      { status: 500 }
    );
  }
}
