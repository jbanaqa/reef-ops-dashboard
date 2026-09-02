const CARE_LEVELS = new Set(["beginner", "intermediate", "advanced", "expert"]);
const CUC_TYPES = new Set(["conch", "crab", "other", "shrimp", "snail", "star", "urchin"]);
const DWELLINGS = new Set(["sand", "rock", "both"]);
const ALGAE_ONLY_FIELDS = ["lighting", "flow", "growthRate", "roles", "propagation"];

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function titleCase(value: string) {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function stringArray(value: unknown) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean).map(titleCase);
  const text = String(value || "").trim();
  return text ? [titleCase(text)] : [];
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

  // Apply the same identity normalization to every product. Biological scope
  // and husbandry content come from the generation/audit pipeline, not a SKU-specific template.
  draft.id = String(draft.id || productTitle).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

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
