import OpenAI from "openai";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "./prisma";
import { assertSpeciesLibraryShop, validateSpeciesCard } from "./species-library";

const CARD_SCHEMA = {
  type: "object",
  additionalProperties: true,
  required: ["id", "commonName", "scientificName", "group", "img", "careLevel", "reefSafe", "description", "fullDesc", "habitat", "careNotes", "compatibility", "distribution", "taxonomy", "funFact", "waterParams", "para2", "shopType", "shopUrl"],
  properties: {
    id: { type: "string" }, commonName: { type: "string" }, scientificName: { type: "string" },
    group: { type: "string", enum: ["green", "red", "blue", "brown", "purple", "seagrass", "fish", "cuc", "coral"] },
    img: { type: "string" }, careLevel: { type: "string" }, reefSafe: { type: "string" },
    description: { type: "string" }, fullDesc: { type: "string" }, habitat: { type: "string" },
    careNotes: { type: "string" }, compatibility: { type: "string" }, distribution: { type: "string" },
    taxonomy: { type: "object", additionalProperties: true }, funFact: { type: "string" },
    waterParams: { type: "object", additionalProperties: true }, para2: { type: "string" },
    shopType: { type: "string" }, shopUrl: { type: "string" },
  },
} as const;

export async function generateSpeciesText(reviewItemId: string) {
  const shop = assertSpeciesLibraryShop();
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.SPECIES_TEXT_MODEL;
  if (!apiKey || !model) throw new Error("OPENAI_API_KEY and SPECIES_TEXT_MODEL must be configured.");
  const item = await prisma.speciesReviewItem.findFirst({ where: { id: reviewItemId, shop } });
  if (!item) throw new Error("Review item not found.");
  if (item.kind !== "CREATE_CARD" || item.status !== "AWAITING_REVIEW") throw new Error("Only pending new-card proposals can generate text.");

  await prisma.speciesReviewItem.update({ where: { id: item.id }, data: { textStatus: "RUNNING", lastError: null, attemptCount: { increment: 1 } } });
  try {
    const examples = await prisma.speciesLibraryCard.findMany({ where: { shop, status: { startsWith: "APPROVED" } }, orderBy: { updatedAt: "desc" }, take: 3, select: { payload: true } });
    const openai = new OpenAI({ apiKey });
    const response = await openai.responses.create({
      model,
      store: false,
      instructions: "Create a factual marine species-library card proposal. Match the supplied approved-card structure and tone. Never invent certainty: use conservative wording when the product data is insufficient. Return JSON only. The img field must remain an empty placeholder. This is a draft for human review, never a publishing instruction.",
      input: JSON.stringify({
        product: {
          title: item.productTitle, handle: item.productHandle,
          descriptionHtml: item.productDescription,
          imageUrls: item.productImageUrls,
        },
        approvedStyleExamples: examples.map((example) => example.payload),
      }),
      text: { format: { type: "json_schema", name: "species_card_draft", strict: false, schema: CARD_SCHEMA } },
    });
    const draft = JSON.parse(response.output_text) as unknown;
    const validation = validateSpeciesCard(draft);
    if (!validation.valid) throw new Error(`Generated card failed validation: ${validation.errors.join("; ")}`);
    await prisma.speciesReviewItem.update({
      where: { id: item.id }, data: { draftPayload: draft as Prisma.InputJsonValue, textStatus: "READY", lastError: null },
    });
    return { reviewItemId: item.id, model, responseId: response.id, draft };
  } catch (error) {
    await prisma.speciesReviewItem.update({ where: { id: item.id }, data: { textStatus: "FAILED", lastError: error instanceof Error ? error.message : "Text generation failed." } });
    throw error;
  }
}
