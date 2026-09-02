import OpenAI from "openai";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "./prisma";
import { assertSpeciesLibraryShop, validateSpeciesCardDraft } from "./species-library";
import { normalizeGeneratedSpeciesDraft } from "./species-draft-normalization";

const CARD_SCHEMA = {
  type: "object",
  additionalProperties: true,
  required: ["id", "commonName", "scientificName", "group", "img", "careLevel", "reefSafe", "description", "fullDesc", "habitat", "careNotes", "compatibility", "distribution", "taxonomy", "funFact", "waterParams", "para2", "shopType", "shopUrl"],
  properties: {
    id: { type: "string" }, commonName: { type: "string" }, scientificName: { type: "string" },
    group: { type: "string", enum: ["green", "red", "blue", "brown", "purple", "seagrass", "fish", "cuc", "coral"] },
    img: { type: "string" }, careLevel: { type: "string", enum: ["beginner", "intermediate", "advanced", "expert"] },
    reefSafe: { anyOf: [{ type: "boolean" }, { type: "string", enum: ["caution"] }] },
    lighting: { type: "string" }, flow: { type: "string" }, growthRate: { type: "string" },
    roles: { type: "array", items: { type: "string" } }, tankRole: { type: "array", items: { type: "string" } },
    propagation: { type: "string" }, cucType: { type: "string", enum: ["conch", "crab", "other", "shrimp", "snail", "star", "urchin"] },
    minTankSize: { type: "number" }, dwelling: { type: "string", enum: ["sand", "rock", "both"] },
    diet: { type: "array", items: { type: "string" } }, cleanupCrew: { type: "boolean" }, coralType: { type: "string" },
    description: { type: "string" }, fullDesc: { type: "string" }, habitat: { type: "string" },
    careNotes: { type: "string" }, compatibility: { type: "string" }, distribution: { type: "string" },
    taxonomy: {
      type: "object", additionalProperties: true,
      required: ["kingdom", "phylum", "class", "order", "family", "genus"],
      properties: {
        kingdom: { type: "string" }, phylum: { type: "string" }, class: { type: "string" },
        order: { type: "string" }, family: { type: "string" }, genus: { type: "string" },
      },
    }, funFact: { type: "string" },
    waterParams: { type: "object", additionalProperties: true }, para2: { type: "string" },
    shopType: { type: "string", enum: ["unavailable"] }, shopUrl: { type: "string", enum: ["#"] },
  },
} as const;

const GROUP_REQUIREMENTS = {
  algae: "For green, red, blue, brown, purple, or seagrass include lighting, flow, growthRate, roles, tankRole, and propagation.",
  cuc: "For cuc include cucType, numeric minTankSize in gallons, dwelling as sand/rock/both, diet as an array, tankRole as an array, and cleanupCrew as a boolean. Anemones and other non-fish invertebrates use cuc; use cucType other when no narrower established value applies.",
  coral: "For coral include coralType, lighting, flow, and tankRole.", fish: "Fish have no additional group-required fields.",
};

const GENERATION_RULES = [
  "The card represents a reusable biological and husbandry unit, never a size, pack, sale label, inventory state, or cosmetic SKU.",
  "Collapse cosmetic color forms only when evidence supports the same taxon and husbandry; keep genuinely different species and established trade identities, including distinct clownfish types, separate.",
  "Never infer a species from color or marketing language. Use genus-level identification when the source does not support greater certainty.",
  "Use only established library values: careLevel beginner/intermediate/advanced/expert; reefSafe true/false/caution.",
  "For CUC, diet and tankRole are arrays, minTankSize is a number, dwelling is sand/rock/both, and cucType uses the supplied enum.",
  "Use group cuc for marine invertebrates including anemones; use cucType other when no narrower value applies and cleanupCrew false for display-only invertebrates.",
  "Do not include fields belonging to another group. Put detailed light and flow guidance in waterParams for CUC cards; fish propagation describes captive breeding rather than fragging.",
  "Use conservative qualified language where evidence is limited. Never invent taxonomy, distribution, reproduction, compatibility, maximum size, or universal thresholds.",
  "When a supported temperature range is known, waterParams.temp must use a practical numeric Fahrenheit range rather than vague wording such as stable reef temperatures.",
  "Descriptions must be evergreen and factual, without sales language, stock status, specimen guarantees, Markdown, or references to the listing.",
  "Set img to an empty string, shopType to unavailable, and shopUrl to #. Never generate Markdown links or decide commerce behavior; those are separate human-review stages.",
];

function balancedExamples(cards: { group: string; payload: Prisma.JsonValue }[]) {
  const counts = new Map<string, number>();
  return cards.filter((card) => {
    const count = counts.get(card.group) || 0;
    if (count >= 3) return false;
    counts.set(card.group, count + 1);
    return true;
  }).map((card) => card.payload);
}

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
    const approvedCards = await prisma.speciesLibraryCard.findMany({
      where: { shop, status: { startsWith: "APPROVED" } },
      orderBy: [{ group: "asc" }, { updatedAt: "desc" }],
      select: { group: true, payload: true },
    });
    const examples = balancedExamples(approvedCards);
    const openai = new OpenAI({ apiKey });
    const response = await openai.responses.create({
      model,
      store: false,
      instructions: `Create a factual marine Species Library proposal for mandatory human review. First decide reusable biological scope, then write the complete card. Match approved-card field semantics and restrained tone. Return JSON only. ${Object.values(GROUP_REQUIREMENTS).join(" ")} ${GENERATION_RULES.join(" ")}`,
      input: JSON.stringify({
        product: {
          title: item.productTitle, handle: item.productHandle,
          descriptionHtml: item.productDescription,
          imageUrls: item.productImageUrls,
        },
        approvedExamplesByGroup: examples,
        groupRequirements: GROUP_REQUIREMENTS,
        generationRules: GENERATION_RULES,
      }),
      text: { format: { type: "json_schema", name: "species_card_draft", strict: false, schema: CARD_SCHEMA } },
    });
    if (!response.output_text) throw new Error("Initial generation returned no JSON.");
    const initialDraft = normalizeGeneratedSpeciesDraft(JSON.parse(response.output_text) as unknown, item.productTitle);
    const auditResponse = await openai.responses.create({
      model,
      store: false,
      instructions: `Act as the final quality gate for a marine Species Library draft. Correct the JSON rather than describing problems. Verify biological scope, taxonomic certainty, group-specific fields and types, established enums, husbandry plausibility, internal consistency, neutral commerce, and evergreen wording. Remove cross-group and promotional fields. Preserve uncertainty instead of inventing facts. Return complete corrected JSON only. ${Object.values(GROUP_REQUIREMENTS).join(" ")} ${GENERATION_RULES.join(" ")}`,
      input: JSON.stringify({
        product: { title: item.productTitle, handle: item.productHandle, descriptionHtml: item.productDescription },
        draftToAudit: initialDraft,
        approvedExamplesByGroup: examples,
      }),
      text: { format: { type: "json_schema", name: "audited_species_card_draft", strict: false, schema: CARD_SCHEMA } },
    });
    if (!auditResponse.output_text) throw new Error("Draft audit returned no JSON.");
    const draft = normalizeGeneratedSpeciesDraft(JSON.parse(auditResponse.output_text) as unknown, item.productTitle);
    const validation = validateSpeciesCardDraft(draft);
    const validationMessage = validation.valid ? null : `Generated draft needs review: ${validation.errors.join("; ")}`;
    await prisma.speciesReviewItem.update({
      where: { id: item.id }, data: {
        draftPayload: draft as Prisma.InputJsonValue,
        textStatus: validation.valid ? "READY" : "FAILED",
        imageStatus: "PLACEHOLDER", lastError: validationMessage,
      },
    });
    return { reviewItemId: item.id, model, responseIds: [response.id, auditResponse.id], draft, warnings: validation.errors };
  } catch (error) {
    await prisma.speciesReviewItem.update({ where: { id: item.id }, data: { textStatus: "FAILED", lastError: error instanceof Error ? error.message : "Text generation failed." } });
    throw error;
  }
}
