-- Preserve an audited pre-publication version while normalizing the storefront category.
WITH targets AS (
  SELECT
    card."id",
    jsonb_set(card."payload", '{group}', '"cuc"'::jsonb, true) AS "nextPayload",
    COALESCE((SELECT MAX(version."version") FROM "SpeciesCardVersion" version WHERE version."cardId" = card."id"), 0) + 1 AS "nextVersion"
  FROM "SpeciesLibraryCard" card
  WHERE card."group" = 'invertebrate' OR card."payload"->>'group' = 'invertebrate'
)
INSERT INTO "SpeciesCardVersion" (
  "id", "cardId", "version", "payload", "imageUrl", "source", "createdBy", "createdAt"
)
SELECT
  CONCAT('cuc_', MD5(targets."id")),
  targets."id",
  targets."nextVersion",
  targets."nextPayload",
  targets."nextPayload"->>'img',
  'GROUP_NORMALIZATION',
  'reefops-migration',
  CURRENT_TIMESTAMP
FROM targets;

UPDATE "SpeciesLibraryCard"
SET
  "group" = 'cuc',
  "payload" = jsonb_set("payload", '{group}', '"cuc"'::jsonb, true),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "group" = 'invertebrate' OR "payload"->>'group' = 'invertebrate';
