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

function applyTubeAnemoneProfile(draft: Record<string, unknown>) {
  return Object.assign(draft, {
    id: "tube-anemone",
    commonName: "Tube Anemone",
    scientificName: "Cerianthus sp.",
    group: "cuc",
    careLevel: "intermediate",
    reefSafe: "caution",
    cucType: "other",
    minTankSize: 30,
    dwelling: "sand",
    diet: ["Meaty Marine Foods", "Mysis Shrimp", "Finely Chopped Seafood"],
    tankRole: ["Display"],
    cleanupCrew: false,
    description: "A tube-dwelling anemone that extends a crown of long tentacles from a protective tube buried in soft substrate. Color and tentacle appearance vary among trade specimens, but those cosmetic differences do not change the card's husbandry scope.",
    fullDesc: "Cerianthus species are non-photosynthetic, tube-dwelling anthozoans kept for their long, flowing tentacles and distinctive burrowing behavior. They anchor in soft substrate inside a protective tube, extend when settled, and retract rapidly when disturbed. Aquarium-trade specimens are often identified only to genus and may vary considerably in color and pattern, so this card uses conservative genus-level guidance rather than assigning color forms separate biological identities.",
    habitat: "Marine soft-bottom habitats where the animal can establish its protective tube in sand, mud, or other fine substrate.",
    careNotes: "Provide a mature, stable aquarium with a deep fine sandbed, low to moderate indirect flow, and regular target feeding of small meaty marine foods. Keep the animal away from pump intakes and leave clearance from neighboring corals and sessile invertebrates.",
    compatibility: "Best kept with peaceful tankmates that will not dig aggressively or repeatedly disturb the substrate. Provide clearance from corals and sessile invertebrates that could contact the tentacles.",
    distribution: "Cerianthus species occur in marine soft-bottom habitats in multiple ocean regions; the exact origin and species identity of aquarium-trade specimens are often unspecified.",
    taxonomy: {
      kingdom: "Animalia", phylum: "Cnidaria", class: "Anthozoa",
      order: "Ceriantharia", family: "Cerianthidae", genus: "Cerianthus",
    },
    funFact: "Tube anemones can retract rapidly into a protective tube built within the substrate, giving them a very different anchoring strategy from rock-attached sea anemones.",
    waterParams: {
      lighting: "Not photosynthetically required; low to moderate display lighting is appropriate.",
      flow: "Low to moderate indirect flow; avoid strong direct jets.",
      temp: "72–80°F",
      salinity: "1.023–1.026",
      notes: "Provide stable conditions, a deep sandbed, regular target feeding, and sufficient clearance from neighboring livestock.",
    },
    para2: "Treat Tube Anemones as sandbed invertebrates that need space, stability, and routine feeding. They are unsuitable for bare-bottom systems and should not be placed where their tentacles can contact neighboring corals or where strong pump outflow can disturb the animal or substrate. A newly introduced specimen may take time to establish its tube and preferred position.",
  });
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
    applyTubeAnemoneProfile(draft);
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
