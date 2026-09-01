import { NextResponse } from "next/server";
import { isDashboardRequestAuthorized } from "@/lib/dashboard-request-auth";
import { publishSpeciesLibrary, SpeciesPublicationError } from "@/lib/species-publication";

function reviewerFrom(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  return Buffer.from(authorization.replace(/^Basic\s+/i, ""), "base64").toString("utf8").split(":")[0] || "dashboard-user";
}

export async function POST(request: Request) {
  if (!isDashboardRequestAuthorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const body = await request.json() as { confirmation?: string };
    if (body.confirmation !== "PUBLISH_SPECIES_LIBRARY") return NextResponse.json({ error: "Explicit publication confirmation is required." }, { status: 400 });
    return NextResponse.json({ ok: true, result: await publishSpeciesLibrary(reviewerFrom(request)) });
  } catch (error) {
    const status = error instanceof SpeciesPublicationError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Publication failed.", details: error instanceof SpeciesPublicationError ? error.details : undefined }, { status });
  }
}
