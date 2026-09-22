-- Restore only explicit, accepted email consent erased by a Klaviyo absence snapshot.
-- No suppression, opt-out history, or unknown-consent profile can be upgraded.
WITH evidence AS (
  SELECT DISTINCT ON (c.id) c.id, c."profileId", p.shop,
    c.source AS "oldSource", c."occurredAt" AS "oldAt",
    e.id AS "evidenceId", e.payload->>'source' AS source, e."occurredAt"
  FROM "MarketingConsent" c
  JOIN "MarketingProfile" p ON p.id = c."profileId"
  JOIN "MarketingEvent" e ON e."profileId" = p.id AND e.shop = p.shop
  WHERE c.channel = 'EMAIL' AND c.status = 'NEVER_SUBSCRIBED'
    AND NOT c.suppressed AND c.reason IS NULL AND c.source LIKE 'klaviyo%'
    AND e.type = 'CONSENT' AND e.payload->>'channel' = 'EMAIL'
    AND e.payload->>'status' = 'SUBSCRIBED' AND e.payload->>'ignored' = 'false'
    AND e.payload->>'source' IN ('shopify', 'storefront-single-opt-in-v1')
    AND e."occurredAt" <= c."occurredAt" AND e."occurredAt" <= CURRENT_TIMESTAMP
    AND NOT EXISTS (
      SELECT 1 FROM "MarketingEvent" blocked
      WHERE blocked."profileId" = p.id AND blocked.shop = p.shop
        AND ((blocked.type = 'CONSENT' AND blocked.payload->>'channel' = 'EMAIL'
          AND (blocked.payload->>'status' = 'UNSUBSCRIBED' OR COALESCE(blocked.payload->>'reason', '') <> ''))
          OR blocked.type IN ('UNSUBSCRIBED', 'BOUNCED', 'COMPLAINED'))
    )
  ORDER BY c.id, e."occurredAt" DESC, e.id DESC
), repaired AS (
  UPDATE "MarketingConsent" c SET status = 'SUBSCRIBED', source = e.source,
    "occurredAt" = e."occurredAt"
  FROM evidence e WHERE c.id = e.id
  RETURNING c.id
)
INSERT INTO "MarketingEvent" (id, shop, key, type, "profileId", payload, "occurredAt", "createdAt")
SELECT 'consent-repair-' || md5(e.id), e.shop, 'consent-repair-v1:' || e.id,
  'CONSENT_RECONCILED', e."profileId",
  jsonb_build_object('channel', 'EMAIL', 'status', 'SUBSCRIBED', 'evidenceId', e."evidenceId",
    'source', e.source, 'previousSource', e."oldSource", 'previousOccurredAt', e."oldAt",
    'reason', 'Restored recorded subscription overwritten by imported absence of consent'),
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM evidence e JOIN repaired r ON r.id = e.id
ON CONFLICT (shop, key) DO NOTHING;
