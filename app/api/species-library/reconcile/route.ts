import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { reconcileSpeciesProducts } from "@/lib/species-library-reconciliation";

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
    return NextResponse.json({ ok: true, result: await reconcileSpeciesProducts() });
  } catch (error) {
    console.error("Species reconciliation failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Reconciliation failed." }, { status: 500 });
  }
}
