import { NextResponse } from "next/server";
import { runSaleRotation } from "@/lib/sale-rotation";

export const runtime = "nodejs";

export async function POST() {
  try { return NextResponse.json({ ok: true, ...(await runSaleRotation("Manual")) }); }
  catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Sale rotation failed." }, { status: 500 }); }
}
