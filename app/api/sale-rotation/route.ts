import { NextRequest, NextResponse } from "next/server";

import { getSaleRotationStatus, updateSaleSettings } from "@/lib/sale-rotation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, ...(await getSaleRotationStatus()) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not load sale rotation." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    return NextResponse.json({ ok: true, settings: await updateSaleSettings(await request.json()) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not save sale rotation settings." }, { status: 400 });
  }
}
