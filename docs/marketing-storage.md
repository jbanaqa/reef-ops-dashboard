# Marketing storage and recovery

Campaign email artwork and copy are stored in immutable, shop-scoped `CAMPAIGN_CONTENT` resources, addressed by a canonical SHA-256 digest. Each recipient's `MarketingMessage.content` contains a small reference. PostgreSQL JSONB key ordering does not affect the digest. Content is resolved and checked before delivery; missing or damaged snapshots fail closed. Drafts and the editor retain their existing content format. Historical inline messages remain supported and are compacted on delivery without changing sending eligibility.

This covers send-time expansion, schedule-time audience snapshots, one-contact campaign runs, and retries. A recipient retains their own token, profile, schedule, status, provider ID, and attribution links. Shared snapshots do not follow later draft/template edits. Snapshot resources must not be removed while any messages reference them; rolling back to workers that do not understand references is unsafe.

## Review before maintenance

Run against the intended environment using its existing configuration:

```
npm run marketing:storage
npm run marketing:storage -- --campaigns --limit=100
npm run marketing:storage -- --inbox --limit=100
```

The first command reports table/index/TOAST sizes and approximate row counts. The others are read-only previews. `serializedBytes` and `uniqueSnapshotBytes` describe JSON size, not physical disk savings: PostgreSQL compression, indexes, WAL, and dead tuples affect actual usage. Use the returned `nextCursor` with `--after=CURSOR` to continue a bounded scan.

## Apply only after review

First deploy reference-aware code to **both the dashboard and scheduled worker**, and pause sending in Our Klaviyo Settings. Resolve SENDING/UNKNOWN deliveries. After reviewing the preview, add `--apply` to the selected command. Neither command runs automatically or sends email.

Campaign compaction replaces duplicated content with immutable references; it deletes no message or customer history. Inbox compaction reduces only raw bodies of DONE Shopify events processed over 30 days ago to a checksum/size marker. It permanently removes those old raw bodies; their webhook keys, topics, timestamps and delivery diagnostics remain. Failed, pending, processing, and recent webhook bodies are retained. Consent records, suppression records, MarketingEvent history, orders and attribution are untouched. Each applied operation records an audit event.

Reducing row content makes table space reusable after PostgreSQL vacuuming; it does not necessarily shrink the filesystem immediately. Never delete PostgreSQL data/WAL files. An entirely full database may need temporary additional capacity or provider-assisted recovery before SQL maintenance can run. `VACUUM FULL` needs extra disk and exclusive locks and must not be used as an automatic recovery step.

## October 15 incident

PostgreSQL reported disk exhaustion while inserting campaign MarketingMessage rows after overdue campaigns resumed expansion. The database then failed recovery due to insufficient space. The exact table/WAL breakdown cannot be measured until it accepts connections again. Do not claim that subscriber counts alone explain the volume, or that a code deployment alone reclaims existing disk usage. Production compaction requires a reviewed report and a healthy database; no production data was compacted while implementing this change.

The storefront popup changes from commit `288ac26` remain prepared in Shopify draft theme `188341125346` (Copy of Minimog 2). The main theme `187823915234` was not replaced. Database recovery and successful app/worker deployment remain prerequisites to publishing that draft and verifying the live popup.
