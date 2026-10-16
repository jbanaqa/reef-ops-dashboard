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
