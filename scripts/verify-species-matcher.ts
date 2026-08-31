import assert from "node:assert/strict";
import { matchProductToSpecies, type MatchableSpeciesCard } from "../lib/species-library-matcher";
import type { SpeciesProductSnapshot } from "../lib/macroalgae-shopify";

const cards: MatchableSpeciesCard[] = [
  { id: "1", speciesKey: "chaeto", commonName: "Chaeto", scientificName: "Chaetomorpha sp.", payload: { shopUrl: "https://www.macroalgaefarms.com/products/chaeto-spaghetti-algae-chaetomorpha" } },
  { id: "2", speciesKey: "haddoni-carpet", commonName: "Haddoni Carpet Anemone", scientificName: "Stichodactyla haddoni", payload: { shopUrl: "#" } },
  { id: "3", speciesKey: "tube-anemone", commonName: "Tube Anemone", scientificName: "Cerianthus sp.", payload: { shopUrl: "#" } },
];

function product(overrides: Partial<SpeciesProductSnapshot>): SpeciesProductSnapshot {
  return { id: "gid://shopify/Product/1", title: "", handle: "", status: "ACTIVE", descriptionHtml: "", productType: "", vendor: "", tags: [], updatedAt: new Date().toISOString(), imageUrls: [], ...overrides };
}

const handleMatch = matchProductToSpecies(product({ title: "Chaeto Starter", handle: "chaeto-spaghetti-algae-chaetomorpha" }), cards);
assert.equal(handleMatch?.speciesKey, "chaeto");
assert.equal(handleMatch?.confidence, 1);

const scientificMatch = matchProductToSpecies(product({ title: "Red Carpet Anemone", handle: "red-carpet", descriptionHtml: "<p>Stichodactyla haddoni specimen</p>" }), cards);
assert.equal(scientificMatch?.speciesKey, "haddoni-carpet");
assert.equal(scientificMatch?.method, "SCIENTIFIC_NAME");

const sharedCard = matchProductToSpecies(product({ title: "Purple Tube Anemone", handle: "purple-tube-anemone" }), cards);
assert.equal(sharedCard?.speciesKey, "tube-anemone");

const noMatch = matchProductToSpecies(product({ title: "Aquarium Feeding Tongs", handle: "feeding-tongs" }), cards);
assert.equal(noMatch, null);

console.log("Species matcher verification passed.");
