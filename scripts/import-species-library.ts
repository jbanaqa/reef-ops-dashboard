import fs from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "../app/generated/prisma/client";
import { prisma } from "../lib/prisma";
import {
  assertSpeciesLibraryShop,
  SPECIES_SCHEMA_VERSION,
  type SpeciesCardPayload,
  validateSpeciesCard,
} from "../lib/species-library";

async function main() {
  const shop = assertSpeciesLibraryShop();
  const sourcePath = path.resolve(process.argv[2] || "data/species-library.json");
  const parsed = JSON.parse(await fs.readFile(sourcePath, "utf8")) as unknown;

  if (!Array.isArray(parsed)) throw new Error("Species seed file must contain an array.");

  const duplicateKeys = parsed
    .map((card) => String((card as Record<string, unknown>)?.id || ""))
    .filter((key, index, keys) => key && keys.indexOf(key) !== index);
  if (duplicateKeys.length) throw new Error(`Duplicate species ids: ${[...new Set(duplicateKeys)].join(", ")}`);

  let imported = 0;
  let warningCards = 0;
  let warningCount = 0;

  for (const rawCard of parsed) {
    const card = rawCard as SpeciesCardPayload;
    if (!card.id || !card.commonName || !card.scientificName || !card.group) {
      throw new Error("Every imported card needs id, commonName, scientificName, and group.");
    }

    const validation = validateSpeciesCard(card);
    const status = validation.valid ? "APPROVED" : "APPROVED_WITH_LEGACY_WARNINGS";
    if (!validation.valid) {
      warningCards += 1;
      warningCount += validation.errors.length;
      console.warn(`${card.id}: ${validation.errors.join("; ")}`);
    }

    const payload = card as Prisma.InputJsonValue;
    const stored = await prisma.speciesLibraryCard.upsert({
      where: { shop_speciesKey: { shop, speciesKey: card.id } },
      create: {
        shop, speciesKey: card.id, group: card.group,
        commonName: card.commonName, scientificName: card.scientificName,
        schemaVersion: SPECIES_SCHEMA_VERSION, payload, status,
      },
      update: {
        group: card.group, commonName: card.commonName,
        scientificName: card.scientificName,
        schemaVersion: SPECIES_SCHEMA_VERSION, payload, status,
      },
      select: { id: true },
    });

    await prisma.speciesCardVersion.upsert({
      where: { cardId_version: { cardId: stored.id, version: 1 } },
      create: { cardId: stored.id, version: 1, payload, imageUrl: card.img, source: "IMPORTED" },
      update: { payload, imageUrl: card.img },
    });
    imported += 1;
  }

  console.log(JSON.stringify({ shop, sourcePath, imported, warningCards, warningCount }, null, 2));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
