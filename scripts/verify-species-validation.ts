import assert from "node:assert/strict";
import { validateSpeciesCard, validateSpeciesCardDraft } from "../lib/species-library";
import { normalizeGeneratedSpeciesDraft } from "../lib/species-draft-normalization";

const cucDraft = {
  id: "peach-tube-anemone", commonName: "Peach Tube Anemone", scientificName: "Cerianthus sp.",
  group: "cuc", img: "", careLevel: "intermediate", reefSafe: "caution",
  description: "Draft", fullDesc: "Draft", habitat: "Sand", careNotes: "Draft",
  compatibility: "Draft", distribution: "Draft", funFact: "Draft", para2: "Draft",
  taxonomy: { kingdom: "Animalia", phylum: "Cnidaria", class: "Anthozoa", order: "Spirularia", family: "Cerianthidae", genus: "Cerianthus" },
  waterParams: { temp: "72–78°F" }, shopType: "unavailable", shopUrl: "#",
  cucType: "other", minTankSize: 30, dwelling: "sand", diet: ["Planktonic foods"], tankRole: ["Display"], cleanupCrew: false,
};

const draftResult = validateSpeciesCardDraft(cucDraft);
assert.equal(draftResult.valid, true, draftResult.errors.join("; "));
const finalWithoutImage = validateSpeciesCard(cucDraft);
assert.equal(finalWithoutImage.valid, false);
assert(finalWithoutImage.errors.includes("Missing required field: img"));
const finalWithImage = validateSpeciesCard({ ...cucDraft, img: "https://example.com/peach-tube.jpg" });
assert.equal(finalWithImage.valid, true, finalWithImage.errors.join("; "));

const incomplete = { ...cucDraft } as Record<string, unknown>;
delete incomplete.diet;
const incompleteResult = validateSpeciesCardDraft(incomplete);
assert.equal(incompleteResult.valid, false);
assert(incompleteResult.errors.includes("Missing cuc field: diet"));

const generated = normalizeGeneratedSpeciesDraft({
  ...cucDraft, id: "peach-tube-anemone", commonName: "Peach Tube Anemone", careLevel: "moderate",
  cucType: "tube anemone", minTankSize: "40 gallons", dwelling: "Deep sandbed; four inches",
  diet: "Mysis shrimp", lighting: "low", growthRate: "unknown", coralType: "",
  shopType: "direct", shopUrl: "[https://example.com](https://example.com)",
}, "Peach Tube Anemone") as Record<string, unknown>;
assert.equal(generated.id, "tube-anemone");
assert.equal(generated.commonName, "Tube Anemone");
assert.equal(generated.scientificName, "Cerianthus sp.");
assert.equal(generated.careLevel, "intermediate");
assert.equal(generated.cucType, "other");
assert.equal(generated.minTankSize, 30);
assert.equal(generated.dwelling, "sand");
assert.deepEqual(generated.diet, ["Meaty Marine Foods", "Mysis Shrimp", "Finely Chopped Seafood"]);
assert.deepEqual(generated.tankRole, ["Display"]);
assert.equal(generated.cleanupCrew, false);
assert.deepEqual(generated.waterParams, {
  lighting: "Not photosynthetically required; low to moderate display lighting is appropriate.",
  flow: "Low to moderate indirect flow; avoid strong direct jets.", temp: "72–80°F", salinity: "1.023–1.026",
  notes: "Provide stable conditions, a deep sandbed, regular target feeding, and sufficient clearance from neighboring livestock.",
});
assert.equal(generated.shopType, "unavailable");
assert.equal(generated.shopUrl, "#");
assert.equal(generated.lighting, undefined);
assert.equal(generated.coralType, undefined);
assert.equal(validateSpeciesCardDraft(generated).valid, true);

console.log("Species draft/final validation verification passed.");
