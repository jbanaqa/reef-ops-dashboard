const CARE_LEVELS = new Set(["beginner", "intermediate", "advanced", "expert"]);
const CUC_TYPES = new Set(["conch", "crab", "other", "shrimp", "snail", "star", "urchin"]);
const DWELLINGS = new Set(["sand", "rock", "both"]);
const ALGAE_ONLY_FIELDS = ["lighting", "flow", "growthRate", "roles", "propagation"];

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringArray(value: unknown) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  const text = String(value || "").trim();
  return text ? [text] : [];
}

function numericTankSize(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = String(value || "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : value;
}

function normalizedDwelling(value: unknown) {
  const text = String(value || "").trim().toLowerCase();
  if (DWELLINGS.has(text)) return text;
  const sand = /sand|substrate|burrow/.test(text);
  const rock = /rock|reef|crevice/.test(text);
  return sand && rock ? "both" : sand ? "sand" : rock ? "rock" : text;
}

export function normalizeGeneratedSpeciesDraft(value: unknown, productTitle: string) {
  const source = record(value);
  if (!source) return value;
  const draft: Record<string, unknown> = { ...source };

  // Card identity describes a reusable biological/husbandry unit, not a color SKU.
  if (/\btube[- ]anemone\b/i.test(productTitle)) {
    draft.id = "tube-anemone";
    draft.commonName = "Tube Anemone";
    draft.scientificName = "Cerianthus sp.";
    draft.group = "cuc";
    draft.cucType = "other";
    draft.dwelling = "sand";
    draft.cleanupCrew = false;
  }

  const careLevel = String(draft.careLevel || "").trim().toLowerCase();
  draft.careLevel = careLevel === "moderate" ? "intermediate" : careLevel;
  if (!CARE_LEVELS.has(String(draft.careLevel))) draft.careLevel = careLevel;

  // Images and commerce are independent approval stages and must never be invented by text generation.
  draft.img = "";
  draft.shopType = "unavailable";
  draft.shopUrl = "#";
  delete draft.commerce;
  delete draft.shopItems;
  delete draft.shopAlso;

  if (draft.group === "cuc") {
    const cucType = String(draft.cucType || "").trim().toLowerCase();
    draft.cucType = CUC_TYPES.has(cucType) ? cucType : "other";
    draft.minTankSize = numericTankSize(draft.minTankSize);
    draft.dwelling = normalizedDwelling(draft.dwelling);
    draft.diet = stringArray(draft.diet);
    draft.tankRole = stringArray(draft.tankRole);
    for (const field of ALGAE_ONLY_FIELDS) delete draft[field];
    delete draft.coralType;
  } else if (draft.group === "coral") {
    delete draft.cucType; delete draft.minTankSize; delete draft.dwelling; delete draft.diet; delete draft.cleanupCrew;
    delete draft.growthRate; delete draft.roles; delete draft.propagation;
  } else if (["green", "red", "blue", "brown", "purple", "seagrass"].includes(String(draft.group))) {
    delete draft.cucType; delete draft.minTankSize; delete draft.dwelling; delete draft.diet; delete draft.cleanupCrew; delete draft.coralType;
  }

  return draft;
}
