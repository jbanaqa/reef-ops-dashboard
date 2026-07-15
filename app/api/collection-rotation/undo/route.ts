import {
  NextRequest,
  NextResponse,
} from "next/server";
import {
  undoLastCollectionShuffle,
} from "@/lib/collection-rotation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UndoRequestBody = {
  collectionId?: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const body =
      (await request.json()) as UndoRequestBody;

    const collectionId =
      typeof body.collectionId === "string"
        ? body.collectionId.trim()
        : "";

    if (!collectionId) {
      return NextResponse.json(
        {
          ok: false,
          error: "collectionId is required.",
        },
        {
          status: 400,
        }
      );
    }

    const result =
      await undoLastCollectionShuffle(collectionId);

    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (error) {
    console.error(
      "Collection shuffle undo failed:",
      error
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Collection shuffle undo failed.",
      },
      {
        status: 500,
      }
    );
  }
}