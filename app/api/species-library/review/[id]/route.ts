import { NextResponse } from "next/server";
import { isDashboardRequestAuthorized } from "@/lib/dashboard-request-auth";
import { reviewSpeciesItem, SpeciesReviewError, type ReviewAction } from "@/lib/species-review";

function reviewerFrom(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  return Buffer.from(authorization.replace(/^Basic\s+/i, ""), "base64").toString("utf8").split(":")[0] || "dashboard-user";
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isDashboardRequestAuthorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const { id } = await context.params;
    const body = await request.json() as { action?: string; notes?: string; payload?: unknown; candidateCardId?: string };
    const actions = new Set(["REJECT", "SAVE_DRAFT", "APPROVE_LINK", "APPROVE_CARD", "REASSIGN_LINK"]);
    if (!body.action || !actions.has(body.action)) return NextResponse.json({ error: "Invalid review action." }, { status: 400 });
    const item = await reviewSpeciesItem(id, {
      action: body.action as ReviewAction, notes: body.notes, payload: body.payload,
      candidateCardId: body.candidateCardId,
    }, reviewerFrom(request));
    return NextResponse.json({ ok: true, item });
  } catch (error) {
    const status = error instanceof SpeciesReviewError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Review failed.", details: error instanceof SpeciesReviewError ? error.details : undefined }, { status });
  }
}
