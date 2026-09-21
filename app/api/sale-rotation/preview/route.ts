import { NextResponse } from "next/server";
import { buildSaleRotationPreview } from "@/lib/sale-rotation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { return NextResponse.json({ ok: true, preview: await buildSaleRotationPreview() }); }
  catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not build preview." }, { status: 500 }); }
}
