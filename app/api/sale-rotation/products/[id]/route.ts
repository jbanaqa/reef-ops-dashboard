import { NextRequest, NextResponse } from "next/server";
import { updateSaleProduct } from "@/lib/sale-rotation";
import { isDashboardMutationAuthorized } from "@/lib/dashboard-request-auth";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isDashboardMutationAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  try {
    const { id } = await context.params;
    return NextResponse.json({ ok: true, product: await updateSaleProduct(id, await request.json()) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not update product." }, { status: 400 });
  }
}
