import { NextRequest, NextResponse } from "next/server";
import { searchSaleCatalog } from "@/lib/sale-rotation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    return NextResponse.json({ ok: true, products: await searchSaleCatalog(request.nextUrl.searchParams.get("q") ?? "") });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not search Shopify." }, { status: 500 });
  }
}
