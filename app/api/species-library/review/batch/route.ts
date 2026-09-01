import { NextResponse } from "next/server";
import { isDashboardRequestAuthorized } from "@/lib/dashboard-request-auth";
import { approveHighConfidenceLinks, SpeciesReviewError } from "@/lib/species-review";

function reviewerFrom(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  return Buffer.from(authorization.replace(/^Basic\s+/i, ""), "base64").toString("utf8").split(":")[0] || "dashboard-user";
}

export async function POST(request: Request) {
  if (!isDashboardRequestAuthorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const body = await request.json() as { itemIds?: unknown; confirmation?: string };
    if (body.confirmation !== "APPROVE_HIGH_CONFIDENCE_LINKS") return NextResponse.json({ error: "Explicit batch confirmation is required." }, { status: 400 });
    if (!Array.isArray(body.itemIds) || !body.itemIds.every((id) => typeof id === "string")) return NextResponse.json({ error: "itemIds must be an array of IDs." }, { status: 400 });
    const result = await approveHighConfidenceLinks(body.itemIds, reviewerFrom(request));
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const status = error instanceof SpeciesReviewError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Batch approval failed." }, { status });
  }
}
