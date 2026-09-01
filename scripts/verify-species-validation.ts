import assert from "node:assert/strict";
import { validateSpeciesCard, validateSpeciesCardDraft } from "../lib/species-library";

const cucDraft = {
  id: "peach-tube-anemone", commonName: "Peach Tube Anemone", scientificName: "Cerianthus sp.",
  group: "cuc", img: "", careLevel: "intermediate", reefSafe: "caution",
  description: "Draft", fullDesc: "Draft", habitat: "Sand", careNotes: "Draft",
  compatibility: "Draft", distribution: "Draft", funFact: "Draft", para2: "Draft",
  taxonomy: { kingdom: "Animalia", phylum: "Cnidaria", class: "Anthozoa", order: "Spirularia", family: "Cerianthidae", genus: "Cerianthus" },
  waterParams: { temp: "72–78°F" }, shopType: "unavailable", shopUrl: "#",
  cucType: "Tube anemone", minTankSize: 30, dwelling: "Deep sand bed", diet: "Planktonic foods", tankRole: ["Display"],
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

console.log("Species draft/final validation verification passed.");
