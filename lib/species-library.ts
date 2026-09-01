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
  cuc: ["cucType", "minTankSize", "dwelling", "diet", "tankRole", "cleanupCrew"],
  coral: ["coralType", "lighting", "flow", "tankRole"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasValue(value: unknown) {
  return value !== undefined && value !== null && value !== "";
}

export function validateSpeciesCard(payload: unknown, options: { requireImage?: boolean } = {}) {
  const requireImage = options.requireImage ?? true;
  const errors: string[] = [];
  if (!isRecord(payload)) return { valid: false, errors: ["Card must be an object."] };

  for (const field of CORE_FIELDS) {
    if (field === "img" && !requireImage) continue;
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

  if (typeof payload.careLevel === "string" && !["beginner", "intermediate", "advanced", "expert"].includes(payload.careLevel)) errors.push("careLevel must be beginner, intermediate, advanced, or expert.");
  if (payload.reefSafe !== true && payload.reefSafe !== false && payload.reefSafe !== "caution") errors.push("reefSafe must be true, false, or caution.");
  if (group === "cuc") {
    if (!["conch", "crab", "other", "shrimp", "snail", "star", "urchin"].includes(String(payload.cucType))) errors.push("cucType is not an established library value.");
    if (typeof payload.minTankSize !== "number" || !Number.isFinite(payload.minTankSize) || payload.minTankSize < 0) errors.push("minTankSize must be a non-negative number of gallons.");
    if (!["sand", "rock", "both"].includes(String(payload.dwelling))) errors.push("dwelling must be sand, rock, or both.");
    if (!Array.isArray(payload.diet) || !payload.diet.length) errors.push("diet must be a non-empty array.");
    if (!Array.isArray(payload.tankRole) || !payload.tankRole.length) errors.push("tankRole must be a non-empty array.");
    if (typeof payload.cleanupCrew !== "boolean") errors.push("cleanupCrew must be true or false.");
  }
  if (payload.shopType !== "unavailable" && payload.shopType !== "direct" && payload.shopType !== "search") errors.push("shopType must be unavailable, direct, or search.");
  if (payload.shopType === "unavailable" && payload.shopUrl !== "#") errors.push("Unavailable cards must use # as shopUrl.");
  if ((payload.shopType === "direct" || payload.shopType === "search") && typeof payload.shopUrl === "string") {
    try { new URL(payload.shopUrl); } catch { errors.push("Active commerce cards must use a plain absolute shopUrl, not Markdown."); }
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

export function validateSpeciesCardDraft(payload: unknown) {
  return validateSpeciesCard(payload, { requireImage: false });
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
