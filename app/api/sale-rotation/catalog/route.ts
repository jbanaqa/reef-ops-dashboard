import { NextRequest, NextResponse } from "next/server";
import { searchSaleCatalog } from "@/lib/sale-rotation";
import { isDashboardRequestAuthorized } from "@/lib/dashboard-request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isDashboardRequestAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, products: await searchSaleCatalog(request.nextUrl.searchParams.get("q") ?? "") });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not search Shopify." }, { status: 500 });
  }
}
