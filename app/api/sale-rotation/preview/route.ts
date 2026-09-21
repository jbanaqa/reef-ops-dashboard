import { NextRequest, NextResponse } from "next/server";
import { buildSaleRotationPreview } from "@/lib/sale-rotation";
import { isDashboardRequestAuthorized } from "@/lib/dashboard-request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isDashboardRequestAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  try { return NextResponse.json({ ok: true, preview: await buildSaleRotationPreview() }); }
  catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not build preview." }, { status: 500 }); }
}
