# Align only the campaign audience

The user requested direct alignment of **2025 Mailable Subscribers** only. The command reads Klaviyo segment `Rr5yRa` and its members, never the global profile directory or email-event history:

```
npm run marketing:align-mailable
npm run marketing:align-mailable -- --apply
```

Default behavior is a read-only preview. Apply requires saved customer sending to be paused, no uncertain/in-progress deliveries, a complete fresh source response, marketability evidence for every member, and all target contacts to exist locally. An incomplete read, duplicate address, unrelated pagination link, missing contact, or verification failure leaves the existing audience unchanged. It imports no new profiles and does not send anything.

The existing `mailable` resource key is preserved, so campaigns selecting this audience continue to select it. Membership is an explicitly labeled **point-in-time Klaviyo segment snapshot**, not a claim that the historical-open import finished or an ongoing Klaviyo subscription. New source members and removals require another scoped alignment. Local opt-outs and suppressions apply immediately after alignment as usual.

Only current source members receive a small `properties.klaviyoMailable` proof. Previous properties, subscription records, open timestamps, lists, tags, names, Shopify identity, flows, templates, other audiences and sending controls are preserved. Contacts outside the source snapshot are not updated. No artificial open timestamp is created. Klaviyo marketability is separate from explicit subscription: this audience can include source-confirmed marketable `NEVER_SUBSCRIBED` contacts without changing their recorded consent or granting eligibility to other audiences or flows. SMS never gains this email eligibility.

The source snapshot, dashboard total, audience directory, campaign audience counts, scheduling and worker use the same scoped eligibility. Local unsubscribes, blocks, missing proof and unknown consent states fail closed. Snapshot-time campaigns still recheck opt-outs and source proof; send-time campaigns additionally recheck membership/exclusions. Ordinary audience rules and flow consent requirements are unchanged. Broad history/profile imports are neither started nor resumed by this operation.

Publish the compatible app and worker before applying the new resource format. An alignment audit records the source digest, timestamp, counts and previous audience definition. Full email artwork is not stored per contact.

Verification: 110 marketing tests, TypeScript, targeted ESLint and production build pass, including actual isolated-database campaign delivery for source-confirmed non-subscribers, blocked contacts, frozen recipients, untouched unrelated profiles/consent/resources, unsafe pagination and failed reads.

## Shopify consent cross-check

The user subsequently requested keeping only source members whose exact email matches one Shopify customer with `defaultEmailAddress.marketingState = SUBSCRIBED`. The review reads only current source members using quoted email searches, checks pagination and exact returned addresses, and excludes NOT_SUBSCRIBED, UNSUBSCRIBED, missing/unknown and ambiguous matches. A failed API read aborts the review rather than treating a transport error as absence of consent. It does not change Shopify, delete customers, import profiles, alter channel-consent records, or start broad backfills.

Reviewed source eligibility is stored in the existing small membership proof, together with the Shopify state, customer ID, consent-update timestamp, check timestamp and an email hash. `canReceiveMarketing` is false for excluded members. Local opt-outs and suppressions remain independent and sticky. The audience displays its Shopify review timestamp. This is a dated consent cross-check, not a continuous Shopify consent scan.

A later `marketing:align-mailable` keeps each member's Shopify review and its exclusions, including the review label. A fresh Shopify review is required to reconsider those exclusions; a Klaviyo membership refresh alone cannot re-enable them. Pending snapshot-time campaigns also enforce revoked source eligibility even if the local profile still says SUBSCRIBED. Other audiences and flow consent requirements are unchanged.

The private, targeted read/apply scripts and reports are kept outside Git in `C:/Users/GuestUser/.codex/artifacts/reef-shopify-consent-2026-10-15/`. Check `SEGMENT_CONSENT_REVIEW` resources and `SEGMENT_CONSENT_REVIEWED` audit events for the applied run and counts. Sending must remain paused during review/application. Verification now includes 111 passing marketing tests, including persistence across Klaviyo refresh and actual frozen-campaign rejection without changing ordinary campaign eligibility or subscription records.

## Maintained master audience — October 15, 2026

The user subsequently chose **2025 Mailable Subscribers** as the ongoing master marketing audience. The existing aligned/reviewed seed remains intact; no additional historical profiles or opens are imported. `scripts/activate-master-audience.ts` previews by default and applies with `--apply` after compatible app and worker deploy. Activation requires paused flows and no active campaign or uncertain send. It stores `masterMarketing.startedAt` alongside the original `klaviyoSegment` metadata and verifies the exact eligible profile IDs remain unchanged. The live preview contained 9,820 eligible members, including the separately authorized restoration of the user's test address. `MASTER_AUDIENCE_ACTIVATED` records the actual applied count and previous definition.

Future accepted first-party email subscriptions (`shopify`, popup single opt-in, confirmed double opt-in, and confirmed voluntary resubscription) join automatically when their consent timestamp is at or after activation. Historical imports, old Shopify snapshots, pending confirmation, missing consent and ignored/sticky suppressions do not join. New memberships use one small per-profile marker plus an idempotent audit event. Existing seed proofs and consent records are not duplicated or rewritten. Popup timezone updates preserve that new marker. Confirmation emails are exempt from the membership restriction so people can establish consent before joining. Repeated signup/resubscription never resets a previous Welcome run.

Audience queries, campaign previews/tests, worker expansion and frozen-recipient checks all recognize the original seed or a new master membership, and still enforce current consent/suppression. Every campaign audience is intersected with the master audience. Customer marketing flows retain channel consent checks and now also require master membership before delivery, with an additional check immediately before the provider request. Staff low-stock alerts remain separate. The four customer flows and staff flow remain disabled until the user explicitly enables them. Pausing Welcome currently also hides the signup popup; this change does not decouple that gate or enable the popup.

The original Klaviyo snapshot-replacement tool refuses to overwrite an activated master audience. The audience UI labels it **MASTER MARKETING AUDIENCE** and distinguishes the initial source/review dates from automatic future additions. Subscriptions that have been suppressed still require confirmed resubscription or an explicitly reviewed correction; changing the audience does not silently override opt-outs.

Verification: 114 marketing tests, TypeScript, changed-file ESLint and production build pass. Integration coverage preserves reviewed seed membership and excluded contacts, admits Shopify/popup consent before Welcome enrollment, preserves timezone and signup idempotency, blocks historical imports and out-of-audience campaign/flow recipients, restores confirmed resubscriptions without restarting Welcome, and immediately excludes unsubscribes.
