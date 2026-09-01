import { NextResponse } from "next/server";
import { isDashboardRequestAuthorized } from "@/lib/dashboard-request-auth";
import { COMMERCE_MODES, reviewSpeciesCommerce, type SpeciesCommerceMode } from "@/lib/species-commerce";

function reviewerFrom(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  return Buffer.from(authorization.replace(/^Basic\s+/i, ""), "base64").toString("utf8").split(":")[0] || "dashboard-user";
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isDashboardRequestAuthorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const { id } = await context.params;
    const body = await request.json() as { mode?: string; productHandle?: string | null; searchQuery?: string | null };
    if (!body.mode || !COMMERCE_MODES.includes(body.mode as SpeciesCommerceMode)) return NextResponse.json({ error: "Invalid commerce mode." }, { status: 400 });
    const card = await reviewSpeciesCommerce(id, { mode: body.mode as SpeciesCommerceMode, productHandle: body.productHandle, searchQuery: body.searchQuery }, reviewerFrom(request));
    return NextResponse.json({ ok: true, card });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Commerce review failed." }, { status: 400 });
  }
}
