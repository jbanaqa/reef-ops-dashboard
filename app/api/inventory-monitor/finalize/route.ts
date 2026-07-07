import { NextResponse } from "next/server";
import { finalizeReadyInventoryWindows } from "@/lib/finalize-inventory-windows";

export async function POST() {
  try {
    const result = await finalizeReadyInventoryWindows();

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error("Finalize inventory windows error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to finalize inventory movement windows.",
      },
      { status: 500 }
    );
  }
}