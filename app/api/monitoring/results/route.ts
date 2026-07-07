import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

type UpdateScanResultsBody = {
  ids?: string[];
  action?: "save" | "ignore";
};

export async function GET() {
  try {
    const results = await prisma.scanResult.findMany({
      where: {
        status: "New",
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Load scan results error:", error);

    return NextResponse.json(
      { error: "Failed to load scan results." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as UpdateScanResultsBody;

    const ids = Array.isArray(body.ids) ? body.ids : [];
    const action = body.action;

    if (ids.length === 0) {
      return NextResponse.json(
        { error: "No scan results selected." },
        { status: 400 }
      );
    }

    if (action !== "save" && action !== "ignore") {
      return NextResponse.json(
        { error: "Action must be either save or ignore." },
        { status: 400 }
      );
    }

    const newStatus = action === "save" ? "Saved" : "Ignored";

    const updated = await prisma.scanResult.updateMany({
      where: {
        id: {
          in: ids,
        },
        status: "New",
      },
      data: {
        status: newStatus,
      },
    });

    const remainingResults = await prisma.scanResult.findMany({
      where: {
        status: "New",
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json({
      updatedCount: updated.count,
      status: newStatus,
      results: remainingResults,
    });
  } catch (error) {
    console.error("Update scan results error:", error);

    return NextResponse.json(
      { error: "Failed to update scan results." },
      { status: 500 }
    );
  }
}