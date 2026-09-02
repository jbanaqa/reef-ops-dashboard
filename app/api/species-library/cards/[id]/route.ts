import { NextResponse } from "next/server";
import { isDashboardRequestAuthorized } from "@/lib/dashboard-request-auth";
import { getApprovedSpeciesCard, SpeciesCardEditorError, updateApprovedSpeciesCard } from "@/lib/species-card-editor";

function reviewerFrom(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  return Buffer.from(authorization.replace(/^Basic\s+/i, ""), "base64").toString("utf8").split(":")[0] || "dashboard-user";
}

function failure(error: unknown) {
  const status = error instanceof SpeciesCardEditorError ? error.status : 500;
  return NextResponse.json({
    error: error instanceof Error ? error.message : "Species card operation failed.",
    details: error instanceof SpeciesCardEditorError ? error.details : undefined,
  }, { status });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isDashboardRequestAuthorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const { id } = await context.params;
    return NextResponse.json({ ok: true, card: await getApprovedSpeciesCard(id) });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isDashboardRequestAuthorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const { id } = await context.params;
    const body = await request.json() as { payload?: unknown; confirmation?: string };
    if (body.confirmation !== "SAVE_NEW_CARD_VERSION") return NextResponse.json({ error: "Explicit save confirmation is required." }, { status: 400 });
    return NextResponse.json({ ok: true, result: await updateApprovedSpeciesCard(id, body.payload, reviewerFrom(request)) });
  } catch (error) { return failure(error); }
}
