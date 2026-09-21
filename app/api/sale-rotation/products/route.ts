import { NextRequest, NextResponse } from "next/server";
import { importSaleProducts, listSaleProducts } from "@/lib/sale-rotation";
import { isDashboardMutationAuthorized, isDashboardRequestAuthorized } from "@/lib/dashboard-request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isDashboardRequestAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  try { return NextResponse.json({ ok: true, products: await listSaleProducts() }); }
  catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not load products." }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  if (!isDashboardMutationAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  try {
    const body = await request.json();
    return NextResponse.json({ ok: true, products: await importSaleProducts(body.items) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not import products." }, { status: 400 });
  }
}
