import { NextRequest, NextResponse } from "next/server";

import { getSaleRotationStatus, updateSaleSettings } from "@/lib/sale-rotation";
import { isDashboardMutationAuthorized, isDashboardRequestAuthorized } from "@/lib/dashboard-request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isDashboardRequestAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await getSaleRotationStatus()) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not load sale rotation." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  if (!isDashboardMutationAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, settings: await updateSaleSettings(await request.json()) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not save sale rotation settings." }, { status: 400 });
  }
}
