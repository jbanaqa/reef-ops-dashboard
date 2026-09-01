import crypto from "crypto";

export const SPECIES_SCHEMA_VERSION = 1;

export const SPECIES_GROUPS = [
  "green", "red", "blue", "brown", "purple", "seagrass",
  "fish", "cuc", "coral",
] as const;

export type SpeciesGroup = (typeof SPECIES_GROUPS)[number];
export type SpeciesCardPayload = Record<string, unknown> & {
  id: string;
  commonName: string;
  scientificName: string;
  group: SpeciesGroup;
  img: string;
  careLevel: string;
  reefSafe: string;
  description: string;
  fullDesc: string;
  habitat: string;
  careNotes: string;
  compatibility: string;
  distribution: string;
  taxonomy: Record<string, unknown>;
  funFact: string;
  waterParams: Record<string, unknown>;
  para2: string;
  shopType: string;
  shopUrl: string;
};

const CORE_FIELDS = [
  "id", "commonName", "scientificName", "group", "img", "careLevel",
  "reefSafe", "description", "fullDesc", "habitat", "careNotes",
  "compatibility", "distribution", "taxonomy", "funFact", "waterParams",
  "para2", "shopType", "shopUrl",
] as const;

const TAXONOMY_FIELDS = ["kingdom", "phylum", "class", "order", "family", "genus"] as const;

const GROUP_FIELDS: Record<SpeciesGroup, readonly string[]> = {
  green: ["lighting", "flow", "growthRate", "roles", "tankRole", "propagation"],
  red: ["lighting", "flow", "growthRate", "roles", "tankRole", "propagation"],
  blue: ["lighting", "flow", "growthRate", "roles", "tankRole", "propagation"],
  brown: ["lighting", "flow", "growthRate", "roles", "tankRole", "propagation"],
  purple: ["lighting", "flow", "growthRate", "roles", "tankRole", "propagation"],
  seagrass: ["lighting", "flow", "growthRate", "roles", "tankRole", "propagation"],
  fish: [],
  cuc: ["cucType", "minTankSize", "dwelling", "diet", "tankRole"],
  coral: ["coralType", "lighting", "flow", "tankRole"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasValue(value: unknown) {
  return value !== undefined && value !== null && value !== "";
}

export function validateSpeciesCard(payload: unknown) {
  const errors: string[] = [];
  if (!isRecord(payload)) return { valid: false, errors: ["Card must be an object."] };

  for (const field of CORE_FIELDS) {
    if (!hasValue(payload[field])) errors.push(`Missing required field: ${field}`);
  }

  const group = payload.group;
  if (typeof group !== "string" || !SPECIES_GROUPS.includes(group as SpeciesGroup)) {
    errors.push(`Unsupported group: ${String(group || "(missing)")}`);
  } else {
    for (const field of GROUP_FIELDS[group as SpeciesGroup]) {
      if (!hasValue(payload[field])) errors.push(`Missing ${group} field: ${field}`);
    }
  }

  if (!isRecord(payload.taxonomy)) {
    errors.push("taxonomy must be an object.");
  } else {
    for (const field of TAXONOMY_FIELDS) {
      if (!hasValue(payload.taxonomy[field])) errors.push(`Missing taxonomy field: ${field}`);
    }
  }

  if (!isRecord(payload.waterParams)) errors.push("waterParams must be an object.");
  return { valid: errors.length === 0, errors };
}

export function normalizeShopDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function getSpeciesLibraryShop() {
  const configured = process.env.SPECIES_LIBRARY_SHOP_DOMAIN;
  if (!configured) throw new Error("Missing SPECIES_LIBRARY_SHOP_DOMAIN.");
  const shop = normalizeShopDomain(configured);
  if (!shop.includes("macroalgaefarms")) {
    throw new Error("Species Library is restricted to the Macroalgae Farms deployment.");
  }
  return shop;
}

export function assertSpeciesLibraryShop(candidate?: string | null) {
  const configured = getSpeciesLibraryShop();
  if (candidate && normalizeShopDomain(candidate) !== configured) {
    throw new Error("Species Library shop boundary rejected this operation.");
  }
  return configured;
}

export function createProductFingerprint(input: {
  productId: string;
  title: string;
  handle?: string | null;
  status: string;
  description?: string | null;
  imageUrls?: string[];
  updatedAt: string | Date;
}) {
  return crypto.createHash("sha256").update(JSON.stringify({
    productId: input.productId,
    title: input.title,
    handle: input.handle || null,
    status: input.status,
    description: input.description || null,
    imageUrls: input.imageUrls || [],
    updatedAt: new Date(input.updatedAt).toISOString(),
  })).digest("hex");
}

export const SPECIES_WORKFLOW = {
  primary: ["QUEUED", "MATCHING", "AWAITING_REVIEW", "APPROVED", "PUBLISHED", "REJECTED", "FAILED"],
  text: ["NOT_STARTED", "RUNNING", "READY", "FAILED"],
  image: ["NOT_STARTED", "RUNNING", "PLACEHOLDER", "READY", "FAILED"],
  publication: ["NOT_STARTED", "READY", "PUBLISHED", "FAILED"],
} as const;
