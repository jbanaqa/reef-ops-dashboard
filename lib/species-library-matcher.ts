import type { SpeciesProductSnapshot } from "./macroalgae-shopify";

export type MatchableSpeciesCard = {
  id: string;
  speciesKey: string;
  commonName: string;
  scientificName: string;
  payload: unknown;
};

export type SpeciesMatch = {
  cardId: string;
  speciesKey: string;
  confidence: number;
  method: "SHOP_HANDLE" | "SCIENTIFIC_NAME" | "COMMON_NAME" | "TOKEN_OVERLAP";
  reasons: string[];
};

const STOP_WORDS = new Set(["and", "the", "of", "for", "pack", "sale", "special", "deal", "small", "medium", "large", "xl"]);

function normalize(value: string) {
  return value.toLowerCase().replace(/<[^>]*>/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

function tokens(value: string) {
  return new Set(normalize(value).split(" ").filter((token) => token.length > 2 && !STOP_WORDS.has(token)));
}

function payloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function shopHandle(payload: unknown) {
  const url = String(payloadRecord(payload).shopUrl || "");
  const match = url.match(/\/products\/([^/?#]+)/i);
  return match?.[1]?.toLowerCase() || null;
}

export function matchProductToSpecies(product: SpeciesProductSnapshot, cards: MatchableSpeciesCard[]): SpeciesMatch | null {
  const title = normalize(product.title);
  const searchable = normalize(`${product.title} ${product.productType} ${product.tags.join(" ")} ${product.descriptionHtml}`);
  const productTokens = tokens(`${product.title} ${product.productType} ${product.tags.join(" ")}`);
  let best: SpeciesMatch | null = null;

  for (const card of cards) {
    const reasons: string[] = [];
    let confidence = 0;
    let method: SpeciesMatch["method"] = "TOKEN_OVERLAP";
    const handle = shopHandle(card.payload);
    const common = normalize(card.commonName);
    const scientific = normalize(card.scientificName.replace(/\bsp\.?\b/gi, ""));

    if (handle && handle === product.handle.toLowerCase()) {
      confidence = 1;
      method = "SHOP_HANDLE";
      reasons.push("Existing card shop URL uses this exact product handle.");
    } else if (scientific.length > 4 && searchable.includes(scientific)) {
      confidence = 0.96;
      method = "SCIENTIFIC_NAME";
      reasons.push("Scientific name appears in the product data.");
    } else if (common.length > 3 && (title === common || title.includes(common) || common.includes(title))) {
      confidence = title === common ? 0.94 : 0.88;
      method = "COMMON_NAME";
      reasons.push("Product title and card common name closely agree.");
    } else {
      const cardTokens = tokens(`${card.commonName} ${card.scientificName}`);
      const overlap = [...cardTokens].filter((token) => productTokens.has(token)).length;
      const ratio = cardTokens.size ? overlap / cardTokens.size : 0;
      if (overlap >= 2 && ratio >= 0.5) {
        confidence = Math.min(0.82, 0.58 + ratio * 0.24);
        reasons.push(`${overlap} meaningful name tokens overlap.`);
      }
    }

    if (confidence >= 0.58 && (!best || confidence > best.confidence)) {
      best = { cardId: card.id, speciesKey: card.speciesKey, confidence, method, reasons };
    }
  }
  return best;
}
