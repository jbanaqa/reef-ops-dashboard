# Reef Ops / Our Klaviyo — account-switch handoff

**Snapshot date: September 10, 2026 (America/Los_Angeles).**  
**Application code baseline: `2769e48` on `main`, pushed to `origin/main`.**  
This document was written immediately afterward to continue the work from another Codex account. It is a working-context handoff, not a claim that every flow is live or fully accepted.

## 1. Start here in the new account

Open the same local project:
`C:\Users\GuestUser\Documents\GitHub\reef-ops-dashboard`

Read, in this order:
1. This document.
2. Root `AGENTS.md`.
3. Relevant sections of `docs/our-klaviyo.md`.
4. Actual implementation and tests for the next requested change.

Run `git status --short` and `git log -8 --oneline` before editing. Read current saved flow settings before proposing live actions; the runtime snapshot below is based on prior user reports, not a fresh production database audit.

**Leave the untracked `reef-ops-checkout-protection/` folder untouched.** It is unrelated work, present throughout recent changes. Do not stage, delete, move, reset, or overwrite it.

### Ready-to-paste starting prompt

> Read docs/REEF-OPS-HANDOFF.md and AGENTS.md thoroughly, then inspect the current repository state. Continue our Our Klaviyo work using the handoff as prior context. Preserve the shared email architecture, user-friendly flow diagrams, saved copy/artwork, and existing safety controls. Low-stock work, SMS enhancements, and exact email appearance are paused. Abandoned Cart remains a controlled test, not an approved full customer cutover. Tell me what is implemented, what is verified, and what remains before making further changes. Do not enable unrestricted sending or send real messages merely to resume this task.

### What switching accounts does and does not preserve

- The local repository and files are on this computer and remain accessible under the same Windows user. The code is also pushed to GitHub.
- A new task can read this document, checked-in docs, source, tests, and preserved reference screenshots.
- The original chat transcript, tool state, browser sessions, account plugins, connected-service permissions, and Codex settings are not guaranteed to transfer.
- Reauthenticate services if needed. Do not copy account authentication tokens into the repository.
- On another computer, clone the repository and separately restore authorized local/deployment configuration. No secrets are included in this handoff.
- Do not assume a shared conversation link is an executable task migration or that the other account has a particular usage allocation.

## 2. User intent and working preferences

The user is rebuilding selected Klaviyo workflows inside the Corals Anonymous Reef Ops dashboard, under **Our Klaviyo**. The goal is familiar, intuitive operation with closely matching behavior, not a new backend for every email.

Persist these preferences across iterations:
- Use the B2B welcome flow's clean, vertical, clickable schematic as the common flow-editor pattern. Avoid large forms with numbered bubble sections as the main flow screen.
- Clicking a step opens focused settings. Dialogs should be centered, keyboard accessible, and usable on narrow screens; the old top-left modal was explicitly disliked.
- Every email uses a consistent rich editor and desktop/mobile preview. Templates and allowed controls can differ by flow/block, but the content model, rendering, validation, and delivery must be shared.
- Preserve saved subjects, copy, custom HTML, logos, uploaded artwork, footer fields, browser drafts, and reviewed configuration. Deployments must not reset content.
- Recreate original Klaviyo appearance as closely as practical. Exact artwork/layout refinement is deferred; the user said the received first cart email looks good.
- Staff should see useful customer state: flow participation, last sent step, upcoming step, skipped/stopped reasons, failures, and uncertainty.
- Avoid unnecessary jargon, raw JSON editors, repeated permission questions, and redundant infrastructure.
- The user dislikes multi-day manual test cycles. Prefer meaningful automated verification with accelerated test timestamps; explain what those tests establish and what still needs a live check.
- Act on requested reversible implementation work. Recent development was committed and pushed to main. Do not interpret this as blanket permission to send to customers, change subscriptions, remove test restrictions, or cut over live flows.
- No subagents were used or requested for the latest work.

## 3. Project and environment

| Item | Value |
| --- | --- |
| Repository | reef-ops-dashboard |
| Local directory | C:\Users\GuestUser\Documents\GitHub\reef-ops-dashboard |
| Remote | https://github.com/jbanaqa/reef-ops-dashboard.git |
| Branch | main |
| Deployed app | https://reef-ops-dashboard-production.up.railway.app/ |
| Storefront | https://coralsanonymous.com |
| Shopify shop | corals-anonymous.myshopify.com |
| Framework | Next.js 16.3.4 App Router, React 19.2.4 |
| Database layer | Prisma 7.8, PostgreSQL adapter |
| Email adapter | Resend |
| SMS | Gateway contract exists; carrier/provider rollout not verified |
| User timezone | America/Los_Angeles |

Root AGENTS.md warns that this Next version has breaking changes. **Read the relevant guide in `node_modules/next/dist/docs/` before writing framework code.** Documentation filenames use `.md`, not `.mdx`; for example:
`node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md`.

### Terminal fallback that worked in this session

PowerShell exec previously failed with Windows OS error 1392. Do not assume the repository is damaged. Node REPL filesystem and child-process APIs worked reliably.

Discover a tool named like `mcp__node_repl__js`. In its persistent JavaScript session:
```js
var fs = await import("node:fs/promises");
var cp = await import("node:child_process");
var root = nodeRepl.cwd;
var nodeBin = "C:/Program Files/nodejs/node.exe";
nodeRepl.write(cp.spawnSync("git", ["status", "--short"], {
  cwd: root, encoding: "utf8", windowsHide: true
}).stdout);
```
Use `fs.readFile`/`fs.writeFile` and structured argument arrays. For long tests/builds, spawn a process and collect stdout/stderr into a persistent object, then poll it. Do not interpolate secrets into command strings. Use hidden Windows processes.

## 4. Current live-testing snapshot — verify before acting

These are user-observed results and previously saved settings, not an assertion that the deployment has not changed since:

- Abandoned Cart was configured as an **enabled, reviewed, account-restricted email test** for `jadenbanawa@gmail.com`.
- Global sending and Shopify ingestion were enabled sufficiently for that controlled test to work. Check current settings rather than changing them blindly.
- The user confirmed Shopify checkout-started and checkout-updated events appeared in the profile.
- The user confirmed the Shopify custom pixel eventually worked after CORS fixes.
- Klaviyo history import screenshot: **29,598 events processed; 2,197 ignored** because product, customer, or date data was incomplete. Those ignored records have not been individually audited.
- Product preview returned four available products. Shipping Protection was initially included; it is now excluded. Shipping Box is now excluded too.
- The user successfully received the first actual cart email using the profile's early-send control and liked its appearance.
- The user tried the discount follow-up immediately afterward. It was **CANCELLED/skipped** with “Skipped: recently received email (16 hours).” This is expected Smart Sending behavior.
- That cancelled message will not automatically retry when 16 hours pass. Do not tell the user it is merely delayed.
- The skipped follow-up did **not** prove real coupon creation/redemption.
- The user planned to let a natural scheduled test run over the following days. Its outcome has not yet been reported.
- Do not assume the equivalent Klaviyo flow has been drafted. Before unrestricted Reef Ops rollout, inspect/coordinate the old flow to avoid duplicate sends.
- Low-stock work was explicitly paused because the user did not have access to the staff recipient's phone/email for testing.

## 5. Implemented changes and commits

| Commit | Change |
| --- | --- |
| ac4c199 | Initial versioned abandoned-cart implementation |
| 42c0427 | History imports, recommendations, scheduling edits, reporting |
| cc65b39 | Initial Shopify sandbox pixel CORS correction |
| 87972aa | Decoupled null-origin pixel ingestion from signup-origin configuration |
| 09e2060 | Excluded Shipping Protection recommendations |
| 75e11a3 | Account-restricted abandoned-cart email test mode |
| 68b58f0 | Per-message “Send this step now” for eligible restricted test messages |
| aeffced | Shared campaign/template/flow email editing and per-email address visibility |
| 2769e48 | Audience flow progress and Shipping Box recommendation exclusion |

Latest application changes were committed and pushed. A successful push is not itself proof that Railway finished deploying; confirm deployment if investigating a stale UI.

## 6. Abandoned Cart: original reference behavior

The user supplied the original configuration screenshots, preserved in `docs/handoff-assets/`.

Sequence:
1. **Checkout Started** trigger. Re-entry allowed.
2. No trigger filters.
3. Profile filter: **Placed Order zero times since starting this flow**.
4. Conditional split: Checkout Started at least once in the last **3 days**. No branch ends.
5. SMS eligibility split: can receive text message marketing.
6. Eligible SMS branch waits **30 minutes**, then sends text #1; no-SMS branch bypasses that delay.
7. Branches merge; wait **3 hours**.
8. Send **Email #1: Soft Push**.
9. Wait **1 day**.
10. Split: Placed Order at least once in the last **2 weeks**.
11. Yes: **Email #2: Another Soft Push**.
12. No: **Email #2: Discount Offer**.
13. End.

Distinguish historical-purchaser branching from cancellation: an order before this checkout can select the reminder branch; an order after checkout stops remaining cart reminders.

Settings:
- Email Smart Sending: skip if emailed within **16 hours**.
- SMS Smart Sending: skip recent campaign or flow texts within **24 hours**.
- SMS quiet hours: **8 p.m.–11 a.m.**
- UTM tracking was off in supplied screenshots.
- Messages were marketing, not marked transactional.
- Actual recovery destinations are `{{ checkout_url }}`; visible/example link was coralsanonymous.com/cart.

Discount:
- Klaviyo coupon definition `Abandon_Cart10`.
- Prefix `AC300-`.
- 10% off entire order, no minimum.
- No product/order/shipping discount combinations.
- Active at send time, expires after one year.
- Implementation uses unique, single-use Shopify codes.

Product feed, verbatim user explanation:
> Show products from All categories. Show products a customer has added to cart. If we run out of products added to cart, show both best-selling and most viewed products over the last 3 days.

Exact feed ranking is not claimed to match Klaviyo's proprietary algorithm.

## 7. Abandoned Cart: actual Reef Ops implementation

### Enrollment, waits, and branches

- `CartConfig` is version 1, with productCount and optional testEmail.
- Identified, trusted Shopify checkouts enroll once per checkout. Different checkouts can re-enter; repeated updates do not duplicate enrollment or restart the clock.
- Anonymous/unidentified observations alone cannot enroll a customer.
- The triggering/recent checkout must be within the three-day window.
- Actual checkout URL and product information are carried in a durable CART_RUN resource.
- Checkout updates refresh items/link; empty checkout updates cancel pending reminders.
- Normal SMS branch is sequential. Restricted email test mode bypasses SMS without changing consent.
- First-email default is 180 minutes on the email-only path. Following wait is 1440 minutes after first sent/skipped terminal step.
- Existing entered waits retain their deadlines. Later waits use the current saved delay when they start.
- Waiting versioned cart messages use updated saved copy when first prepared. Already prepared retry content stays frozen.
- The final branch is selected at send preparation using recent order history. A queued generic follow-up is not proof that a discount branch has already been selected.
- Local purchase state and authoritative Shopify order lookup are checked. Lookup failures defer sending.
- Purchases after checkout cancel remaining reminders.
- Terminal failure/skipping can advance a subsequent wait. UNKNOWN delivery holds the sequence for reconciliation.

### Recommendations

- Current checkout items and identified cart history from the last 90 days first.
- Remaining slots alternate recorded best sellers and most viewed products from the last 3 days.
- Four products by default; editable upper bound **12**, lower bound 0.
- Remove duplicates, unpublished/inactive/out-of-stock products.
- Exclude titles matching Shipping Protection or Shipping Box/Shipping Boxes (including space/hyphen separators).
- Backfill from later eligible candidates; do not let excluded products consume the count.
- This is an email recommendation filter. It does **not** remove necessary shipping products from the actual Shopify checkout.
- Query Shopify for current availability, prices, URLs, and images.
- Historical ranking uses keyset pagination and a bounded query deadline rather than silently truncating at 10,000 events.
- Shopify availability requests batch candidates in groups of 100.
- Native/imported popularity cutoffs avoid overlap after a completed history snapshot.
- If insufficient eligible products exist, render fewer; do not invent unrelated static replacements.
- Preview customer products and real sends use the same selection logic.

### Coupon preparation and delivery

- Generate a random code per message, save it before remote creation, then create/lookup a Shopify basic discount.
- Prefix AC300-, 10% all items, one use, no combinations, expiry one calendar year.
- Retry lookup reuses the same code after a lost response.
- Do not send if product/coupon/order preparation fails.
- Provider idempotency and frozen prepared content prevent routine duplicate sends.
- Editor “Send test” uses sample products and a **non-redeemable preview coupon**.
- Real coupon redemption is still unverified by the user's live test.

## 8. Three different testing controls — do not confuse them

| Control | What it does | What it does not prove |
| --- | --- | --- |
| Email editor → Send test | Sends current preview to an allowlisted internal address | Enrollment, real branch selection, actual coupon redemption, natural schedule |
| Profile → Messages → Send this step now | Advances only one eligible restricted cart message's wait and runs its real send checks | It does not bypass Smart Sending, consent, purchases, or uncertain-delivery controls |
| Scheduled worker / Run delivery now | Processes eligible due messages through normal checks | A manual invocation alone does not prove the automatic scheduler will run later |

Early-send requirements:
- Staff-authenticated request.
- Correct profile/message relationship and shop.
- Current saved restricted test email must match both profile and run.
- Versioned cart EMAIL, PENDING, never attempted, first/final stage.
- Flow enabled and reviewed; global sending/ingestion/migration/email setup ready.
- Shopify inbox drained.
- Final button remains disabled until first step has sent or been cancelled/skipped.
- Only selected dueAt/CART_WAIT changes; audit event CART_TEST_SEND_REQUESTED is recorded.
- `runMarketing(messageId)` limits execution to that message, not other customers/campaigns/stock checks.
- Completed/attempted/wrong-profile/non-test messages cannot be resent this way.
- A first email followed immediately by early-send final can be skipped under the **16-hour rule**. This is expected.
- Do not delete send history, spoof production timestamps, or clear suppression to make a manual test pass.
- A future explicitly requested accelerated live test feature would need clear internal-only isolation; it has not been implemented.

## 9. Shared email infrastructure and address preference

Already shared backend:
- `Content`, `content()`, sanitization and `render()` in rules.ts.
- `emailBody()` in delivery.ts produces HTML/plain text and inline artwork attachments.
- Delivery worker/provider adapter shared across flows/campaigns.
- Layout values: standard, b2b-wholesale, cart-recovery.
- Flow logic supplies products, personalization, checkout URL and coupon, not a separate email backend.

Current UI:
- Flow emails, campaign drafts, and reusable templates use `EmailDesigner`.
- Rich copy/HTML editing, shared responsive `EmailPreview`, subject/preview, CTA, applicable artwork, footer, and test controls.
- Campaign/template product-card editing is in the shared designer.
- Templates have a read-only preview subject; campaigns own actual subject.
- Contextual back label: flow, campaign, templates.
- Low-stock uses the same designer with simplified token copy. Shared footer settings persist in optional StockConfig.emailContent; old configurations still load.

**User-requested address setting:**
- Footer → **Show business address in this email**.
- Shared boolean `showPostalAddress`.
- Defaults false for new and old content without an explicit true.
- Applies to HTML and plain text.
- Organization name and unsubscribe remain.
- Configured business address is not erased; readiness still requires it.
- UI warns to turn it on before customer marketing sends.
- The user was told a valid postal address is required for commercial marketing (qualifying PO box/private mailbox can be used); they accepted this.
- Current implementation does not separately enforce visibility at live send time. Do not claim it does. Restore visibility before unrestricted marketing rollout.
- Scope is Our Klaviyo-generated emails, not every unrelated email system in the repository.

## 10. Audience profile flow progress

Added in 2769e48 under profile **Overview** and **Messages**:
- Flow display name and entry timestamp.
- Sent/pending/skipped/failed counts.
- Last sent step and subject/time.
- Next step and current due timestamp.
- Pending follow-up says reminder/discount is chosen at send time.
- Waiting, awaiting send checks, sending, flow paused, delivery needs review, stopped after purchase, finished with errors/skips, scheduled steps completed.
- Recorded errors/cancellation reasons visible.
- Global sending-off note for active jobs.
- Sent means provider accepted, not inbox arrival/read confirmation.

Implementation:
- Pure projection `lib/marketing/flow-progress.ts`.
- Groups versioned cart checkouts separately, including re-entry.
- Other flow messages are grouped by flow key; not a general per-enrollment engine for every possible future flow.
- contactDetails combines latest 100 messages with up to 500 active flow messages, deduplicates, labels limited history.
- Counts can omit older completed steps when history is capped.
- This shows recorded jobs, not every hypothetical eligibility state before any message exists.
- It is read-only and does not change enrollment or scheduling.
- Existing raw message history and events remain available.

## 11. Low Stock / T5: explicitly paused

Original architecture:
- Shopify Flow trigger: product variant inventory quantity changed.
- Condition: product in T5 Tank collection 488202338530 AND inventory < 5.
- Shopify Flow itself sent the internal email.
- Then it used Klaviyo Track an Event named Low Stock Alert for Russell's SMS.

Recipient already configured in existing code:
- russellvinson7@gmail.com
- +1 (657) 345-0924
- America/Los_Angeles, explicitly confirmed by user.

User's desired future architecture:
- Keep **Shopify Flow sending the internal email**.
- Send the event to Reef Ops instead of Klaviyo for subsequent handling.
- This was discussed because of Gmail Promotions concerns.
- **Do not claim that Shopify-Flow-email/Reef-event integration is completed.** Current stock module has its own polling/shared delivery path.

Current stock logic:
- Poll selected collection's tracked variants.
- First observation establishes baseline; no alert for all already-low stock.
- One alert per observed crossing below threshold.
- Re-arm after observed recovery to 5+.
- Recovery cancels unsent alerts.
- Preview uses draft config without queuing; saved check can queue, regular worker can later deliver.
- Staff email does not subscribe recipient to marketing; suppressions still respected.
- SMS needs gateway and explicit staff permission confirmation.
- Polling can miss a drop/recovery entirely between checks.
- Resume only when user chooses and staff testing is available. Preserve shared UI improvements meanwhile.

## 12. B2B and other flows

- B2B welcome is the established UI/design reference and was previously developed/tested.
- One welcome per profile on trusted Shopify b2b tag entry; imports do not enroll.
- Current email consent and b2b tag are rechecked before send.
- Late consent can resume an existing eligible enrollment; repeated events should not duplicate sends.
- Do not reset its copy/artwork or change live enablement while working on cart.
- Welcome series and delivery upsell have infrastructure/scaffolds but are not fully audited replicas of their original Klaviyo flows.
- Delivery upsell needs a trusted expected-delivery source.
- General marketing SMS and exact visual matching are deferred.
- Do not claim all five listed flows have reached the same acceptance level.

## 13. Shopify pixel, events, and imports

### Pixel issue already fixed

Failure seen: browser preflight from Origin null was rejected, first with a mismatched storefront origin and then a missing allow-origin header.

Current endpoint:
- `/api/marketing/storefront`.
- Literal Origin null supports only anonymous PRODUCT_VIEWED, ADDED_TO_CART, CHECKOUT_STARTED event actions.
- Reflect allowed origin for preflight/POST; never trust null as identity.
- Signup, SMS consent, sessions, and configuration remain restricted to configured real storefront origin.
- Null-origin event support does not depend on MARKETING_STOREFRONT_ORIGIN being set.
- Rate limiting, size limits, event validation/deduplication and ingest switch remain.
- User confirmed the pixel worked after server fixes.
- Do not “fix” this by allowing arbitrary origins/actions or claiming anonymous events establish customer consent.

Pixel source: `shopify/reef-marketing-custom-pixel.js`. Download control fills in public deployment URL. Respect customer privacy settings. A failed product-view connection is not automatically caused by unfinished Klaviyo import.

### History import

- `cart-history.ts`, staff-triggered batches, durable progress/lease, pause/resume.
- KLAVIYO_PRIVATE_API_KEY scopes events:read, metrics:read, profiles:read.
- Checkout Started/Added to Cart: 90 days.
- Viewed Product/Ordered Product: 3 days.
- Received Email: 2 days.
- Read-only toward Klaviyo; no enrollment, profile creation, consent mutation or send.
- Deduplicated IDs, restricted API pagination origin, incremental refresh overlap.
- Imported email receipts count toward 16-hour Smart Sending.
- It is a snapshot, not continuous Klaviyo synchronization.
- Refresh after drafting original Klaviyo flow and before cutover.
- User-reported 29,598 processed and 2,197 ignored are not counts of successfully enrolled customers or sent emails.

## 14. Sending, data, and safety constraints

- Marketing API staff actions require dashboard authorization.
- Per-channel consent and sticky suppression; imports cannot silently clear suppression.
- Reliable order/consent ingestion before sends: unresolved webhook inbox can hold sends.
- Both deployment env gates and saved operational switches matter.
- Flow enable/review and recipient/test restrictions are rechecked.
- Provider UNKNOWN means delivery could have occurred. Never automatically retry or requeue without reconciliation.
- Pausing flows normally defers pending jobs; suppression/campaign cancellation cancels jobs.
- Account-restricted cart test blocks other recipients and previously queued ordinary runs.
- Removing/changing testEmail clears review/enable in the draft; saves are required to apply.
- Queued test runs cannot become normal production runs when test restriction disappears.
- Test restriction is cart-specific, not a global restriction on every campaign/flow.
- Never expose unsubscribe tokens, raw provider payloads, secrets, or large embedded artwork in contact summaries.
- General marketing reporting is not exact Klaviyo attribution: last click within 5 days, otherwise open within 1 day; gross order value grouped by currency; privacy-proxy opens can inflate counts.

## 15. Source map

| File / area | Responsibility |
| --- | --- |
| app/our-klaviyo/MarketingDashboard.tsx | Navigation, campaigns/templates, shared designer integration |
| app/our-klaviyo/FlowsWorkspace.tsx | Flow directory |
| app/our-klaviyo/FlowEditor.tsx | Draft flow settings and step editing |
| app/our-klaviyo/FlowMap.tsx | Clickable schematic |
| app/our-klaviyo/FlowDialog.tsx | Shared native flow dialog |
| app/our-klaviyo/EmailDesigner.tsx | Shared email editor |
| app/our-klaviyo/EmailPreview.tsx | Responsive iframe preview |
| app/our-klaviyo/RichEmailCopy.tsx | Visual/HTML copy editing |
| app/our-klaviyo/flow-drafts.ts | IndexedDB draft persistence |
| app/our-klaviyo/LowStockEditor.tsx | Stock settings adapter |
| app/our-klaviyo/CartTools.tsx | Product preview, connection checks, history import |
| app/our-klaviyo/AudienceWorkspace.tsx | Directory, profile overview/messages/activity |
| app/our-klaviyo/SettingsWorkspace.tsx | Operational controls and connection tools |
| lib/marketing/rules.ts | Shared content, normalization, rendering, settings |
| lib/marketing/delivery.ts | Provider adapter, HTML/text/attachments, readiness |
| lib/marketing/store.ts | DB helpers, shop scope, identity, consent, events |
| lib/marketing/ingest.ts and inbox.ts | Trusted events and durable webhook processing |
| lib/marketing/flows.ts and flow-config.ts | Enrollment and validated flow config |
| lib/marketing/cart-config.ts | Versioned cart config/presets/test isolation |
| lib/marketing/cart.ts | Cart runs, waits, products, coupons, order checks |
| lib/marketing/cart-test.ts | Selected test-step early delivery |
| lib/marketing/cart-history.ts | Klaviyo import |
| lib/marketing/cart-feed.ts | Historical recommendation signals |
| lib/marketing/cart-report.ts | Flow reporting |
| lib/marketing/worker.ts | Due-message claims, checks, preparation, delivery |
| lib/marketing/audiences.ts | Profile/directory API projection |
| lib/marketing/flow-progress.ts | Staff flow-progress summaries |
| lib/marketing/stock-config.ts and stock.ts | Stock config/observations/cycles |
| app/api/marketing/route.ts | Authenticated marketing actions/views |
| app/api/marketing/storefront/route.ts | Public restricted storefront ingestion |
| app/api/marketing/webhooks/route.ts | Provider/Shopify callbacks |
| scripts/run-marketing.ts, run-scheduled-jobs.ts | Worker entry points |
| docs/our-klaviyo.md | Detailed historical implementation notes |

## 16. Verification: commands, results, limits

Most recent application verification at 2769e48:
- **59 automated tests passed.**
- TypeScript check passed.
- Changed-file ESLint passed.
- Production build passed.
- Audience browser checks passed at desktop, 390px, 320px; new flow summary visually inspected.
- Previous shared-editor release passed campaign/template browser checks, desktop/mobile saves, rich editor/draft recovery, and production build.
- No real messages were sent by these automated tests.

Commands:
```text
npm run marketing:test
npm run build:check
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js <changed files>
node scripts/audiences.browser.test.cjs
node scripts/marketing.browser.test.cjs
node scripts/flows.browser.test.cjs
node scripts/campaigns.browser.test.cjs
node scripts/settings.browser.test.cjs
```

- `verify-marketing.cjs test` uses disposable DB configuration and PGlite with real Prisma writes, mocked remote calls.
- `verify-marketing.cjs build` uses placeholder DB configuration.
- **Do not run those two commands simultaneously**: both regenerate Prisma.
- Browser scripts use isolated fixtures/mocked requests and local Chrome. MARKETING_TEST_BROWSER can specify an executable.
- Latest audience screenshots were in Windows temp `reef-audiences-dg3OPN`; these diagnostic outputs are not durable project references.

Accelerated cart tests establish:
- Future follow-up remains PENDING when worker runs early.
- Sequential wait deadline calculations and editing semantics.
- No-purchase branch creates intended coupon request.
- Prior-purchase branch chooses reminder without a coupon.
- Purchase after checkout cancels reminders.
- Smart Sending sees local and imported email history.
- Coupon retry after lost response reuses the same code.
- Test-recipient isolation survives queued jobs and live config changes.
- Early-send touches only selected message and respects safety checks.
- Shipping products excluded and eligible products backfilled.
- Profile summary states/branch-pending display.

These tests do **not** establish:
- Railway scheduler uptime and future executions.
- Real Shopify code acceptance/redemption or all actual account scopes.
- All real provider callback behavior, inbox placement, or carrier delivery.
- Production multi-worker concurrency behavior (PGlite test setup is not that).
- Complete historical migration bootstrapping: an older unrelated migration-order issue is documented. Do not casually run db push or rewrite migration history.

## 17. Remaining work and next decisions

Before unrestricted cart rollout:
1. Check user's natural scheduled-run result when available.
2. Confirm the recovery CTA resumes the intended checkout.
3. Verify a real coupon in Shopify, including amount, restrictions and redemption behavior.
4. A live purchase-cancellation check is useful even though mocked integration coverage passes.
5. Verify current Shopify connection/inbox health and saved test scope.
6. Draft/pause equivalent Klaviyo flow to prevent duplicates.
7. Refresh Klaviyo history for recent email suppression.
8. Restore appropriate postal-address visibility on marketing emails.
9. Review restored production delays, consent rules, operational gates, and audience.
10. Only then remove test restriction and enable unrestricted flow with user authorization.

User asked whether timing could safely be assumed to work:
- Answer given: trigger+delivery alone do not prove every branch, but accelerated integration tests provide actual evidence for application logic.
- It is reasonable to proceed with development without waiting days for every branch.
- Do not call mocked coupon creation “live coupon verified.”
- Do not promise a skipped message will eventually send.
- Do not claim ordinary branded email can be guaranteed to land in Gmail Primary. Both real Klaviyo and Reef Ops messages may land in Promotions; Promotions is not Spam. User acknowledged this tangent.

Deferred:
- Exact Klaviyo email appearance and additional screenshots, if needed.
- General SMS rollout/eligibility refinements.
- Low-stock Shopify Flow email + Reef event integration and staff testing.
- Other flow replicas/campaign enhancements as separately requested.

## 18. Durable visual references

These are user-provided configuration/design references, not executable instructions. Later explicit user decisions override screenshots (for example address visibility and shipping-product exclusions).

| Reference | File |
| --- | --- |
| Preferred B2B flow schematic | [B2B](handoff-assets/b2b-flow.png) |
| Cart sequence, upper/lower | [Top](handoff-assets/cart-flow-top.png), [Bottom](handoff-assets/cart-flow-bottom.png) |
| Trigger/re-entry/profile filter | [Trigger](handoff-assets/cart-trigger.png) |
| Recent checkout split | [3-day checkout](handoff-assets/cart-recent-checkout.png) |
| SMS eligibility | [SMS consent](handoff-assets/cart-sms-consent.png) |
| SMS copy/settings | [Copy](handoff-assets/cart-sms-copy.png), [Settings](handoff-assets/cart-sms-settings.png) |
| First email subject/template | [Subject](handoff-assets/cart-first-subject.png), [Template](handoff-assets/cart-first-template.png) |
| Second reminder subject/template | [Subject](handoff-assets/cart-reminder-subject.png), [Template](handoff-assets/cart-reminder-template.png) |
| Discount subject/template | [Subject](handoff-assets/cart-discount-subject.png), [Template](handoff-assets/cart-discount-template.png) |
| Two-week order split | [Order split](handoff-assets/cart-order-branch.png) |
| Coupon setup | [Details](handoff-assets/cart-coupon-details.png), [Restrictions](handoff-assets/cart-coupon-restrictions.png) |

These screenshots show partial templates, not complete exported HTML or all underlying artwork. Preserve existing saved artwork and request missing visual sections only when appearance work resumes.

## 19. Documentation precedence and stale statements

`docs/our-klaviyo.md` grew over multiple iterations and contains historical statements that are no longer globally true. Use the latest source/tests plus this dated snapshot:
- “No production configuration changed” describes initial implementation, not later user-operated testing.
- “B2B is first being developed; others scaffolds” predates the versioned cart implementation.
- “Every footer always has the mailing address” predates showPostalAddress.
- “Only configured storefront origin accepted” predates restricted null-origin pixel support.
- “All queued copy is frozen on enrollment” is not true for unprepared versioned cart copy; retry-prepared content is frozen.
- “V1 does not mint unique coupons” refers to the earlier welcome/static coupon setup, not current cart coupons.
- Generic absolute-from-trigger delay notes do not override versioned cart sequential waits.
- Initial paused-by-default descriptions do not prove current live saved settings are paused.

If source and docs disagree, inspect carefully and document the actual behavior before changing anything. Keep this handoff updated after material changes so the next continuation does not repeat completed work.
