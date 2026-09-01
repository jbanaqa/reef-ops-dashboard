import fs from "node:fs/promises";
import path from "node:path";
import { applyCommerceToPayload, normalizeLegacyCommerce } from "../lib/species-commerce";

async function main() {
  const sourcePath = path.resolve(process.argv[2] || "data/species-library.json");
  const parsed = JSON.parse(await fs.readFile(sourcePath, "utf8")) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Species seed file must contain an array.");
  const normalized = parsed.map((card) => {
    const commerce = normalizeLegacyCommerce(card);
    if (commerce.mode === "DIRECT" && !commerce.productHandle) throw new Error(`${(card as { id?: string }).id}: direct card is missing a product handle.`);
    if (commerce.mode === "SEARCH" && !commerce.searchQuery) throw new Error(`${(card as { id?: string }).id}: search card is missing a query.`);
    return applyCommerceToPayload(card, commerce);
  });
  await fs.writeFile(sourcePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  const counts = normalized.reduce<Record<string, number>>((result, card) => { const mode = normalizeLegacyCommerce(card).mode; result[mode] = (result[mode] || 0) + 1; return result; }, {});
  console.log(JSON.stringify({ sourcePath, cards: normalized.length, counts }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
