import { createHash } from "node:crypto";
import { prisma } from "../prisma";
import { createSkuSyncService, type SkuSyncView } from "./service";
import { fetchCloudflareMappings, getSkuSyncMappingsUrl } from "./mapping-source";
import { fetchVariantSnapshots, getSkuSyncConfigurationError, updateVariantSku } from "./shopify";

export function skuSyncSetupError() {
  const error = getSkuSyncConfigurationError();
  if (error) return error;
  try { getSkuSyncMappingsUrl(); } catch { return "SKU Sync mapping source must be a valid HTTPS URL."; }
  return null;
}

export function unavailableSkuSyncView(error: string): SkuSyncView {
  return { configured: false, error, busy: false, checkedAt: null, lastAutomaticCheckAt: null, mappings: [] };
}

export function getSkuSyncService() {
  // Changing either store/source establishes new baselines, not another tenant's saved SKUs.
  const namespace = createHash("sha256").update(JSON.stringify([
    process.env.SHOPIFY_SHOP_DOMAIN?.toLowerCase().trim(),
    process.env.SPECIES_LIBRARY_SHOP_DOMAIN?.toLowerCase().trim(), getSkuSyncMappingsUrl(),
  ])).digest("hex").slice(0, 24);
  return createSkuSyncService({ db: prisma, namespace, fetchMappings: fetchCloudflareMappings,
    shopify: { fetchVariantSnapshots, updateVariantSku } });
}
