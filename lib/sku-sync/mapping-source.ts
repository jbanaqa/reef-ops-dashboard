export type CloudflareMapping = {
  id: string;
  name: string;
  category: string | null;
  active: boolean;
  variantAId: string;
  variantBId: string;
};

export const DEFAULT_SKU_SYNC_MAPPINGS_URL =
  "https://shopify-inventory-sync.jadenbanawa.workers.dev/admin/mappings";

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_MAPPINGS = 20_000;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Accept the source's numeric IDs without passing them through lossy Number conversions. */
export function normalizeProductVariantId(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected a Shopify product variant ID.");
  const digits = value.trim().replace(/^gid:\/\/shopify\/ProductVariant\//, "");
  if (!/^[1-9]\d*$/.test(digits)) throw new Error("Invalid Shopify product variant ID.");
  return `gid://shopify/ProductVariant/${digits}`;
}

function mappingId(value: unknown): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) return value;
  throw new Error("Mapping ID must be a positive integer.");
}

/** A bad row invalidates the entire snapshot; never silently remove a saved pair. */
export function parseCloudflareMappings(value: unknown): CloudflareMapping[] {
  if (!record(value) || !Array.isArray(value.mappings))
    throw new Error("Mapping source did not return a mappings array.");
  if (value.mappings.length > MAX_MAPPINGS) throw new Error("Mapping source returned too many mappings.");
  const ids = new Set<string>();
  return value.mappings.map((item: unknown, index: number) => {
    try {
      if (!record(item)) throw new Error("Expected a mapping object.");
      const id = mappingId(item.id);
      if (ids.has(id)) throw new Error("Duplicate mapping ID.");
      ids.add(id);
      if (typeof item.name !== "string" || !item.name.trim() || item.name.length > 500)
        throw new Error("Mapping name is missing or invalid.");
      if (item.category !== null && (typeof item.category !== "string" || item.category.length > 100))
        throw new Error("Mapping category must be text or null.");
      if (item.active !== true && item.active !== false && item.active !== 1 && item.active !== 0)
        throw new Error("Mapping active flag must be boolean or 0/1.");
      return {
        id,
        name: item.name.trim(),
        category: item.category as string | null,
        active: item.active === true || item.active === 1,
        variantAId: normalizeProductVariantId(item.store_a_variant_id),
        variantBId: normalizeProductVariantId(item.store_b_variant_id),
      };
    } catch (error) {
      throw new Error(`Invalid mapping at row ${index + 1}: ${error instanceof Error ? error.message : "Invalid row."}`);
    }
  });
}

export function getSkuSyncMappingsUrl(configured = process.env.SKU_SYNC_MAPPINGS_URL): string {
  let url: URL;
  try {
    url = new URL(configured?.trim() || DEFAULT_SKU_SYNC_MAPPINGS_URL);
  } catch {
    throw new Error("SKU_SYNC_MAPPINGS_URL must be a valid HTTPS URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw new Error("SKU_SYNC_MAPPINGS_URL must use HTTPS without embedded credentials or a fragment.");
  return url.toString();
}

export async function fetchCloudflareMappings(options: {
  fetch?: typeof fetch;
  url?: string;
  signal?: AbortSignal;
} = {}): Promise<CloudflareMapping[]> {
  const url = getSkuSyncMappingsUrl(options.url);
  const timeout = AbortSignal.timeout(20_000);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  signal.throwIfAborted();
  // Do not follow a redirect to a different host or accidentally downgrade HTTPS.
  const response = await (options.fetch || fetch)(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    redirect: "error",
    signal,
  });
  if (!response.ok) throw new Error(`Mapping source returned HTTP ${response.status}. No mappings were imported.`);
  const type = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (type !== "application/json" && !type?.endsWith("+json"))
    throw new Error("Mapping source did not return JSON. No mappings were imported.");
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES)
    throw new Error("Mapping source response is too large.");
  // Bound streamed responses too: Content-Length is optional and not authoritative.
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Mapping source returned an empty response.");
  const decoder = new TextDecoder();
  let text = "", bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Mapping source response is too large.");
      }
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { throw new Error("Mapping source returned malformed JSON. No mappings were imported."); }
  return parseCloudflareMappings(parsed);
}
