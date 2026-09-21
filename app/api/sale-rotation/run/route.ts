import { NextRequest, NextResponse } from "next/server";
import { runSaleRotation } from "@/lib/sale-rotation";
import { isDashboardMutationAuthorized } from "@/lib/dashboard-request-auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isDashboardMutationAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  try { return NextResponse.json({ ok: true, ...(await runSaleRotation("Manual")) }); }
  catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Sale rotation failed." }, { status: 500 }); }
}
