import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  shuffleCollection,
} from "@/lib/collection-rotation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ShuffleRequestBody = {
  collectionId?: unknown;
  triggerType?: unknown;
};

export async function POST(
  request: NextRequest
) {
  try {
    const body =
      (await request.json()) as ShuffleRequestBody;

    const collectionId =
      typeof body.collectionId === "string"
        ? body.collectionId.trim()
        : "";

    const triggerType =
      body.triggerType === "Batch"
        ? "Batch"
        : "Manual";

    if (!collectionId) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "collectionId is required.",
        },
        {
          status: 400,
        }
      );
    }

    const result =
      await shuffleCollection(
        collectionId,
        triggerType
      );

    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (error) {
    console.error(
      "Collection shuffle failed:",
      error
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Collection shuffle failed.",
      },
      {
        status: 500,
      }
    );
  }
}