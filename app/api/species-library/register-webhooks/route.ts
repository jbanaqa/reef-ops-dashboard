import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { registerSpeciesWebhooks } from "@/lib/species-webhook-registration";

function authorized(request: Request) {
  const expected = process.env.SPECIES_LIBRARY_SYNC_SECRET;
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !actual) return false;
  const a = Buffer.from(actual); const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const configuredBaseUrl = process.env.REEF_OPS_PUBLIC_URL;
    if (!configuredBaseUrl) throw new Error("Missing REEF_OPS_PUBLIC_URL.");
    return NextResponse.json({ ok: true, results: await registerSpeciesWebhooks(configuredBaseUrl) });
  } catch (error) {
    console.error("Species webhook registration failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Registration failed." }, { status: 500 });
  }
}
