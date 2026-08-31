import { NextResponse } from "next/server";
import { isDashboardRequestAuthorized } from "@/lib/dashboard-request-auth";
import { generateSpeciesText } from "@/lib/species-text-generation";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isDashboardRequestAuthorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const { id } = await context.params;
    return NextResponse.json({ ok: true, result: await generateSpeciesText(id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Text generation failed." }, { status: 500 });
  }
}
