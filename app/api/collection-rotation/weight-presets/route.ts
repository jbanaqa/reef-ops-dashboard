import { NextRequest, NextResponse } from "next/server";

import { normalizeWeights } from "@/lib/collection-rotation-scoring";
import { prisma } from "@/lib/prisma";
import { getShopifyShopDomain } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_NAME_LENGTH = 60;

function serializePreset(preset: {
  id: string;
  name: string;
  performanceWeight: number;
  exposureWeight: number;
  freshnessWeight: number;
  explorationWeight: number;
  updatedAt: Date;
}) {
  return {
    id: preset.id,
    name: preset.name,
    performanceWeight: preset.performanceWeight,
    exposureWeight: preset.exposureWeight,
    freshnessWeight: preset.freshnessWeight,
    explorationWeight: preset.explorationWeight,
    updatedAt: preset.updatedAt.toISOString(),
  };
}

// Saved custom weight orientations are shop-wide, not per-collection - a
// single list backs both the per-collection Strategy panel (apply a saved
// orientation to whichever collection you're tuning) and the bulk assignment
// bar (apply the same saved orientation to many collections at once).
export async function GET() {
  try {
    const shop = getShopifyShopDomain();
    const presets = await prisma.rotationWeightPreset.findMany({
      where: { shop },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({
      ok: true,
      presets: presets.map(serializePreset),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not load saved weight presets.",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";

    if (!name) {
      return NextResponse.json(
        { ok: false, error: "Give this orientation a name." },
        { status: 400 }
      );
    }

    if (name.length > MAX_NAME_LENGTH) {
      return NextResponse.json(
        {
          ok: false,
          error: `Preset names must be ${MAX_NAME_LENGTH} characters or fewer.`,
        },
        { status: 400 }
      );
    }

    // Reuses the same 0-100-per-field, sums-to-100 validation the
    // single-collection Strategy panel already relies on, so a saved preset
    // can never itself be an invalid weight split.
    const weights = normalizeWeights({
      performance: Number(body.performanceWeight),
      exposure: Number(body.exposureWeight),
      freshness: Number(body.freshnessWeight),
      exploration: Number(body.explorationWeight),
    });

    const shop = getShopifyShopDomain();
    // Saving again under an existing name overwrites that preset's weights
    // (see the @@unique([shop, name]) note on the model) rather than erroring
    // or creating a duplicate - lets someone re-tune and re-save under the
    // same label.
    const preset = await prisma.rotationWeightPreset.upsert({
      where: { shop_name: { shop, name } },
      create: {
        shop,
        name,
        performanceWeight: weights.performance,
        exposureWeight: weights.exposure,
        freshnessWeight: weights.freshness,
        explorationWeight: weights.exploration,
      },
      update: {
        performanceWeight: weights.performance,
        exposureWeight: weights.exposure,
        freshnessWeight: weights.freshness,
        explorationWeight: weights.exploration,
      },
    });

    return NextResponse.json({ ok: true, preset: serializePreset(preset) });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not save this weight preset.",
      },
      { status: 400 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id")?.trim() ?? "";

    if (!id) {
      return NextResponse.json(
        { ok: false, error: "id is required." },
        { status: 400 }
      );
    }

    const shop = getShopifyShopDomain();
    // Scoped by shop as well as id (rather than a bare delete-by-id) so one
    // shop's session can never delete another shop's saved preset.
    const { count } = await prisma.rotationWeightPreset.deleteMany({
      where: { id, shop },
    });

    if (count === 0) {
      return NextResponse.json(
        { ok: false, error: "That preset no longer exists." },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not delete this weight preset.",
      },
      { status: 400 }
    );
  }
}
