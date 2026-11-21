import { isSkuSyncAuthorized } from "@/lib/sku-sync/auth";
import { getSkuSyncService, skuSyncSetupError, unavailableSkuSyncView } from "@/lib/sku-sync/runtime";
import { SkuSyncConflictError, type SkuSyncChoice } from "@/lib/sku-sync/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
function inaccessible() {
  return json({ error: "This request could not be authorized for SKU Sync." }, 403);
}

export async function GET(request: Request) {
  if (!isSkuSyncAuthorized(request)) return inaccessible();
  const setup = skuSyncSetupError();
  if (setup) return json(unavailableSkuSyncView(setup));
  try { return json(await getSkuSyncService().refresh()); }
  catch { return json({ error: "SKU Sync could not load. Check the database migration and service logs, then try again." }, 503); }
}

export async function POST(request: Request) {
  if (!isSkuSyncAuthorized(request, true)) return inaccessible();
  if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") return json({ error: "Send a JSON request." }, 415);
  const setup = skuSyncSetupError();
  if (setup) return json({ error: setup }, 503);
  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > 24_000) return json({ error: "Request is too large." }, 413);
    body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid object.");
  } catch { return json({ error: "Invalid JSON request." }, 400); }
  const fields = ["mappingId", "expectedSkuA", "expectedSkuB", "expectedVariantAId", "expectedVariantBId"];
  if (!fields.every(key => typeof body[key] === "string" && body[key].length <= 4096) || !body.mappingId ||
    (body.source !== "A" && body.source !== "B")) return json({ error: "Choose an existing mapping and the current SKU from one store." }, 400);
  try { return json(await getSkuSyncService().resolve(body as unknown as SkuSyncChoice)); }
  catch (error) {
    if (error instanceof SkuSyncConflictError) return json({ error: error.message }, error.status);
    return json({ error: "SKU Sync could not confirm the update. Refresh before trying again." }, 503);
  }
}
