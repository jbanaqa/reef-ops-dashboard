# Reef Ops / Our Klaviyo — account-switch handoff

### Campaign product feeds — September 22, 2026

Campaign Sale product grids now support named dynamic Shopify feeds as well as manual products. New campaign drafts reproduce the three supplied Klaviyo selections: `anniversarysalesale` matches any of A50/A55/A60/A65, selects six products in random order; `newnewdiscount` matches any of AW50/AW55/AW60/AW65, selects the newest twelve; `newnew1` selects the newest twelve eligible products across all categories. Tag matching is case-insensitive and OR-based. `DONT DISCOUNT`, A70/AW70, and ASALE are not included because they were absent from the actual feed-selection summaries the user chose as the source of truth.

The shared editor shows the feed definition, slot count, and a refreshable Shopify preview. Feed previews do not replace the saved rule. At campaign delivery preparation, Reef Ops queries active Online Store products, rejects products without an available variant, resolves every dynamic grid, and stores a durable campaign-level snapshot before recipient messages are sent. Random selection is deterministic per campaign so every recipient and every 500-profile expansion page receives the same products; refreshing a draft preview uses a new seed. Shopify failures leave the campaign scheduled for retry and record the feed error rather than sending an empty grid. Existing manual campaign grids continue to work.

Follow-up: the first preset's display name is now **Sale product feed** because the promotion name changes regularly; its stable key and A50/A55/A60/A65 behavior remain compatible with saved drafts. Product preview now queries each configured Shopify feed directly instead of scanning the entire catalog, and the production-credential smoke check returned 6/12/12 products. The editor also handles non-JSON upstream failures with a readable retry message. All campaign Layout groups—including the visual preset, header links, banner, email sections, individual grids, and design controls—start collapsed to reduce scrolling.

Campaign structure was then corrected against the complete received-email screenshots: sale feed (6), new-discount feed (12), green full-width SHOP NOW button, newest-products feed (12), editable Shop app banner, editable purple Shop Pay banner, then the existing black social/unsubscribe footer. Generic full-width banner blocks support text, highlighted text, destination, colors, border, and an optional highlight pill. Drafts that still contain the untouched four-section scaffold are upgraded in the editor using their existing grids/button; sent campaigns are not rewritten.

Each dynamic campaign product grid now has its own editable product count (1–40) and order. Orders include random, newest, oldest, recent best sellers, recent most viewed, price low/high, and product name A–Z/Z–A. Best-selling and most-viewed use Reef Ops' recorded three-day commerce activity. The same saved count and order drive editor previews, test sends, and scheduled delivery; changing either clears a stale preview until it is refreshed.

Campaign Design now exposes logo width directly (180–560 px). On mobile, each campaign product occupies its own row while its image retains the chosen default/per-product pixel width; the mobile stylesheet no longer expands that image to nearly the full screen. Desktop keeps the two-column grid. The same product image width is visible in desktop/mobile preview, test messages, and delivery; existing per-product width overrides still take precedence over the grid default.

The universal Footer tab now accepts optional Instagram and Facebook icon uploads in addition to their destination links. Custom square icons render at 32 px across campaign, flow, and template footers and become shared branding defaults for future emails. With no custom image, the existing built-in symbol remains. Uploaded data images are converted to inline email attachments during delivery for client compatibility.

Footer copyright is now universal and editable. Every layout, including Campaign Sale and the B2B-style 24-hour notice, uses the same copyright text and visibility controls. The default supports dynamic `{{ year }}` and `{{ organization }}` placeholders; staff can change the line or hide it per email. Campaign Sale also honors the shared footer heading and footer artwork fields instead of silently omitting them.

The email-copy audit now exposes layout-generated customer wording through the universal editor. Headings, preview text, message HTML, CTA labels, coupon headings/terms/expiration wording and fallback, welcome-banner greeting/message, welcome social-card labels/handles/messages, footer copy, and unsubscribe-link text are editable. Campaign navigation, banners, grids, product fields, and buttons remain editable in Layout. First-name personalization works in subjects, preview text, headings, and message copy using `{{ first_name|default:"Aloha" }}`. The untouched 24-hour notice heading is upgraded to that token at editor and delivery validation time, while a staff-customized heading is preserved. Its “Your order is shipping out tomorrow at 8AM PST!” sentence is the first editable paragraph in Message. Missing product artwork now falls back to the editable product title rather than injecting an inaccessible “Product image” phrase.

### Campaign sale email builder — September 22, 2026

New campaign drafts now start with a reusable, email-safe sale layout based on the customer-received Corals Anonymous campaigns: shared logo, up to five header links, a linked full-width banner, ordered product-grid and full-width CTA sections, and the existing shared footer. Each product independently stores its image URL, title, destination, sale and compare-at prices, button label, field visibility, and image width. Global controls cover safe font stacks, alignment, spacing, backgrounds, price/button colors, sizes, and rounding. Sections and products can be added, removed, and reordered; desktop grids stack on narrow email clients. Saved templates, campaign duplication, preview, test send, delivery, and plain-text fallback all use the same validated content model. Existing generic campaigns remain readable and are not silently converted.

Campaign cards now include **View email** for read-only inspection of drafts, scheduled, sending, sent, cancelled, and failed campaigns. New sends still use the existing campaign consent, audience, suppression, Smart Sending, scheduling, attribution, and provider safeguards. Verification: 82 marketing tests, TypeScript, targeted ESLint, and the isolated campaign browser suite pass. Browser screenshots were reviewed at desktop, a 375px email preview, and a 390px editor viewport. No real email was sent and no production build was run.

Follow-up: the shared editor now separates an email's visual `layout` from its behavioral `template`. Every flow, campaign, reusable template, and low-stock email opens the same Layout tab and can select Standard, B2B Wholesale, Cart Recovery, Welcome Offer, Welcome Social, or Campaign Sale presentation. Switching presentation does not change the saved trigger, delay, audience, coupon behavior, checkout link, or dynamic products. Campaign Sale presentation renders required flow copy, personal coupon, CTA, and dynamic product feed before optional manual campaign sections. Restoring the original layout removes only the visual override. Coverage verifies a B2B flow switching to Campaign Sale while retaining its B2B template, Welcome coupon content in Campaign Sale, and cart products in Welcome presentation. Verification now passes 84 marketing tests, TypeScript, targeted ESLint, both real-browser editor suites, and narrow layouts.

### Consent precedence and verified-history repair — September 21, 2026

Confirmed the user's email consent was overwritten by `klaviyo:api` NEVER_SUBSCRIBED despite accepted Shopify and storefront signup evidence. `consent()` now treats NEVER_SUBSCRIBED as absence of evidence: it cannot overwrite an existing decision. Explicit subscription can replace an absence snapshot even when the snapshot has a later timestamp. Ignored updates preserve the current source, reason, and timestamp; genuine opt-outs/suppressions remain sticky. Undated imported absence uses an unknown-date sentinel rather than import time, shown as Date not provided in the profile. Profiles now identify Klaviyo as the consent source; ignored activity explains the reason.

Migration `20260922010000_repair_imported_consent` restores only unsuppressed EMAIL rows currently marked NEVER_SUBSCRIBED from Klaviyo with an accepted prior Shopify/storefront signup event and no recorded opt-out/bounce/complaint/suppression evidence. It preserves the original source/date and writes CONSENT_RECONCILED audit events; it neither creates enrollments nor revives cancelled messages. Production read-only preflight found 22 candidates. Current pending messages on restored profiles become eligible for normal checks. All 80 marketing tests, TypeScript, and targeted lint pass. Shopify webhooks remain queued/retried through the existing worker; this does not promise instantaneous synchronization or clear existing suppressions when Shopify says subscribed.

### Profile drawer readability — September 21, 2026

Follow-up after user visual feedback: the profile drawer now uses a gray canvas, white section panels, teal active-flow headers, blue message-history headers and scheduled rows, green sent rows, amber failed/uncertain rows, and neutral cancelled rows. Status text remains visible so color is supplemental. Selected filters use a solid blue background. Overview sections have tinted header bands. Desktop and 320px screenshots reviewed; browser suite, TypeScript and targeted lint passed. Presentation only.

Overview now summarizes active flows, upcoming messages, and messages needing review, with a direct link to Messages. Full flow history no longer crowds out consent, lists/tags, and profile dates. Messages keeps the next step visible on active runs, collapses run details and previous runs, uses compact status filters, and places existing test-send/cancel controls behind each message's **Message actions** disclosure. Historical run reasons remain available when expanded. Typography, secondary text contrast, and narrow-screen stacking were refined using NN/g progressive-disclosure and scanning guidance. No delivery, consent, or enrollment behavior changed. TypeScript, targeted ESLint, and the isolated Audiences browser suite pass, including disclosure behavior, existing test actions, focus restoration, and 320/390px layouts. No live messages were sent.

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
- Identified, trusted Shopify checkouts enroll once per active checkout attempt. Different checkout tokens can re-enter immediately. If Shopify reuses the same token, activity within three days updates the active attempt without restarting it; activity after more than three days creates a new attempt while preserving the completed attempt in history.
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
- KLAVIYO_PRIVATE_API_KEY scopes events:read, metrics:read, profiles:read, and lists:read for both history and audience migration tools.
- Checkout Started/Added to Cart: 90 days.
- Viewed Product/Ordered Product: 3 days.
- Received Email: 2 days.
- Read-only toward Klaviyo; no enrollment, profile creation, consent mutation or send.
- Deduplicated IDs, restricted API pagination origin, incremental refresh overlap.
- Imported email receipts count toward 16-hour Smart Sending.
- It is a snapshot, not continuous Klaviyo synchronization.
- Refresh after drafting original Klaviyo flow and before cutover.
- User-reported 29,598 processed and 2,197 ignored are not counts of successfully enrolled customers or sent emails.

### Audience backfill

- Settings → Advanced now has a staff-started, resumable Klaviyo audience backfill.
- It requires `KLAVIYO_PRIVATE_API_KEY` with `profiles:read` and `lists:read`.
- It imports profile identity, explicit email/SMS consent evidence, global suppressions, timezone, Klaviyo list membership, and an explicit Shopify Tags profile property when Klaviyo supplies one.
- For email profiles, Shopify's existing phone remains authoritative; Klaviyo phone identity is used for phone-only profiles. This avoids rejecting valid email consent because Klaviyo retained an older phone number.
- It does not infer consent from list membership or `can_receive_*`. List-specific suppression removes only that imported list membership.
- The UI shows profile/list progress, suppressions, skipped identities, and a bounded list of row conflicts. It can pause after the current API page and resume from durable state.
- It does not enroll historical Welcome or B2B flows, send messages, or alter Klaviyo. Shopify webhooks remain authoritative for later tag and consent changes.

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
- Analytics uses configurable Klaviyo-style email last touch with five-day open/click defaults and send-date cohorts. Resend does not label bot clicks or Apple MPP opens, so Klaviyo's optional exclusion settings cannot be reproduced; gross revenue is grouped by currency and remains before refunds.

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

## 20. Welcome series implementation — September 13, 2026

The user approved replacing the Klaviyo popup with the Reef Ops popup, single opt-in, and no SMS step. They deliberately chose an automatic sequence instead of the screenshots' Manual message. The screenshots' “zero orders in the last one week” was a lookback condition, **not** a seven-day wait; the new explicit seven-day gap is intentional.

Implemented in the working tree, with no production configuration changes or customer sends:
- Welcome email immediately after a new signup joins `Mailable Subscribers`.
- Reminder on day 3; final reminder on day 10. Both require no order since this Welcome enrollment, consent, and a successfully sent initial welcome.
- One unique `WELCOME10-` Shopify code per profile, reused by all three offer messages. 10% of the entire order, no minimum, no combinations, one redemption. This is an order-wide discount, as in the supplied coupon configuration; shipping-product exclusions in cart recommendations do not change discount eligibility.
- Coupon activates during the initial email's preparation and expires 14 × 24 hours later. Deadlines persist before the Shopify call and never extend on a lost response/retry. Email copy shows the actual expiry date, not a hardcoded “seven days.” Preparation precedes provider acceptance, so a delayed retry can shorten the remaining offer lifetime.
- Initial successful delivery anchors later scheduled messages to the persisted offer activation. A late initial send does not make the day-3 reminder immediately due.
- Social email on/after day 15 at 17:00 recipient-local time; default fallback America/Los_Angeles. A purchase skips discount reminders but does not cancel social. If that day's clock time has passed, it waits for the next occurrence. Timezone is captured by the popup and DST is handled.
- No re-entry, including legacy welcome message history and repeated form submissions. A durable WELCOME_RUN also prevents re-entry after history cleanup. Imports do not enroll. Existing Mailable Subscribers are not replayed by installation or deployment.
- The initial Welcome email is an expected response to signup and is exempt from ordinary 16-hour spacing. Later Welcome emails use local/provider-acceptance history and imported Klaviyo receipts; a recent email postpones them until the window ends. In-progress/uncertain delivery reservations remain hard holds. If the first email fails, coupon reminders are skipped; if it is UNKNOWN/PENDING, later steps wait.
- Live purchase checks combine the locally recorded last order with a Shopify order query anchored to the Welcome enrollment timestamp. Older purchases do not block this sequence; any purchase after enrollment skips later discount reminders. Failures defer the reminder.
- Test-email restriction in Welcome settings snapshots the test audience in each run. Removing/changing the restriction cannot convert existing test runs into unrestricted runs. Review/enable are cleared in the editor when changing the test audience.
- Existing saved copy/artwork survives the versioned draft upgrade, field by field. New steps use the supplied Klaviyo copy/layout where visible. Every email still uses EmailDesigner, Content/render(), and the shared worker/provider. Shared branding continues to apply. Hero uploads now use the same inline attachment handling as logos/footers.
- Map uses clear day labels and clickable email nodes. Clicking a schedule/condition opens Welcome settings with day-based schedule, expiry, timezone, and test audience. Profile activity/progress labels describe welcome enrollment and step names.

Files: `welcome-config.ts`, `welcome.ts`, shared `discounts.ts` (also used by cart), `WelcomeSettings.tsx`, plus the existing enrollment/worker/storefront/editor/rendering modules. No database schema migration is needed. New installations seed the versioned default; existing stored flows are upgraded as a review-required browser draft when opened, not silently overwritten.

Verification: 65 marketing tests pass, including real Prisma writes against disposable PGlite with mocked Shopify/Resend and an accelerated 120+ day clock covering multiple isolated profiles. Cases include schedule boundaries, coupon reuse and lost responses, old purchases, expired offers, lookup failures, suppressed recipients, UNKNOWN delivery, delayed initial delivery, pausing during preparation, frozen retries, repeated signups, test-audience changes, single-opt-in popup completion, and DST. TypeScript, changed-source ESLint, and production build pass. The flow browser suite passes desktop and 390/320px layouts, all four previews, and schedule persistence. Its two old `Saved to flow` assertions were updated to the shared editor's existing `Email saved` label.

Still needed before real cutover:
1. Deploy the reviewed code, then save the upgraded Welcome flow with the intended test audience and review status.
2. Test a fresh subscriber through the Reef Ops popup and redeem a real welcome code. These tests did not contact live Shopify or Resend.
3. Get the original Klaviyo hero image files/URLs or exported HTML for exact fish artwork. Current presets use aqua text banners and HTML social cards; no original artwork was available in the connected browser session. Existing uploaded branding is preserved.
4. Replace/disable the Klaviyo popup and equivalent Klaviyo welcome flow in a coordinated cutover. The storefront theme has not been changed. Keep the Reef Ops popup off for general visitors while the flow is restricted to a test address; otherwise other signups would subscribe without receiving the test-restricted welcome offer.
5. Retain the earlier migration, consent, footer-address, and sending-readiness requirements before unrestricted activation. Do not interpret the user's implementation request as permission to send marketing to the existing list.

### Welcome diagram correction — September 13, 2026

The Welcome implementation was committed and pushed as `240e90b`. The user then requested a functional branching diagram instead of the linear timeline. Welcome displays separate purchase decisions before each reminder, with a No-order email path and an Ordered-since-enrollment skip path. Both rejoin before the next scheduled check and ultimately the social email. The diagram matches the worker's send-time checks. Email nodes open their own editors; wait, decision, skip and offer-rule nodes open Welcome settings. Coupon expiration is shown separately as an offer rule rather than an execution step. The browser suite verifies branch placement, decision settings, all four email editors, saved schedule changes, and 320/390px layouts.

### Signup preview setup — September 14, 2026

User created Shopify theme `162826256610` (Copy of Sunrise) and authorized popup installation in that unpublished copy. Added the following before `</body>` in its `layout/theme.liquid` through Shopify's code editor. User completed Shopify's additional verification; File Saved appeared, and the external script tag was verified in the rendered draft preview. Existing theme had 26 errors/34 warnings before this edit; afterward 26 errors/35 warnings (external asset). Live theme was not edited or published. Klaviyo popup remains present in the copy as well as live.

```liquid
{% comment %}Reef Ops popup test: unpublished theme only.{% endcomment %}
{% if theme.id == 162826256610 and theme.role != "main" %}
<script defer src="https://reef-ops-dashboard-production.up.railway.app/reef-marketing.js" data-endpoint="https://reef-ops-dashboard-production.up.railway.app/api/marketing/storefront" data-known-customer="{% if customer %}true{% else %}false{% endif %}"></script>
{% endif %}
```

Configured Railway service variables `MARKETING_STOREFRONT_ORIGIN=https://coralsanonymous.com` and `MARKETING_FORM_ENABLED=true`, triggering deployment `52287762-87a9-4d19-b4b0-a23f0996f2f9`; also saved global operations.formEnabled=true via the existing API, preserving all other preferences. Original storefrontOrigin was empty, explaining Origin denied. Verify deployment success before testing. Preview opened via Shopify editor on `https://coralsanonymous.com/` with Draft/Copy of Sunrise preview bar, matching the configured origin (the editor iframe itself uses myshopify.com and will not match). Do not use a shopifypreview.com share URL without verifying origin compatibility.

At initial setup inspection, the saved Welcome flow was disabled and unreviewed with testEmail `jadenbanawa@gmail.com`; that profile had no Welcome history. The user later reviewed and enabled the restricted flow, submitted the draft Reef Ops popup, and the profile entered `Mailable Subscribers`. Four Welcome messages were scheduled and the initial email was accepted by the provider after the user ran **Process events now**. The remaining messages retained their day 3, day 10, and day 15 schedules. This validated the popup-to-consent-to-enrollment-to-delivery path without publishing the copied theme.

Deployment 52287762-87a9-4d19-b4b0-a23f0996f2f9 succeeded. Storefront config POST from https://coralsanonymous.com returned HTTP 200 with singleOptIn=true and couponDays=14, confirming the origin and form deployment gates. The external asset must remain publicly accessible.

### Shared profile message controls — September 14, 2026

The Audiences profile **Messages** tab now uses one message-action model for restricted test flows. `lib/marketing/message-test.ts` replaces the cart-only module and owns action discovery, early-send validation, cancellation, cleanup, delivery readiness, and audit recording. Cart and Welcome provide only their flow-specific eligibility checks. The UI calls the same `send-test-message-now`, `cancel-test-message`, and `clear-unsent-test-messages` actions for either flow; old cart action names remain API aliases for compatibility.

Welcome settings now offer the same optional 16-hour suppression bypass as cart when a specific test address is set. Early sends bypass only the selected message's schedule. The worker still checks flow status, test audience, consent/suppression, prior-step state, purchase state, coupon validity, unresolved Shopify events, and provider readiness. Welcome reminders cannot be accelerated before the offer email is sent, and the cleanup action preserves the Welcome one-entry record.

Verification passed: TypeScript, changed-source ESLint, Audiences browser coverage at desktop/390/320 widths, and all 65 marketing tests. The integration suite accelerates two consecutive Welcome emails, verifies suppression bypass, cancellation, cleanup, and preservation of the one-entry record. A production build attempt was stopped after Turbopack reported a corrupt local `.next` cache; it was not rerun because the build process was destabilizing the user's PC. Ignored `.next-corrupt-*` cache backups remain local and must not be committed.

### Welcome purchase-window correction — September 14, 2026

The user chose a flow-relative condition instead of copying Klaviyo's rolling seven-day lookback or retaining Reef Ops' original lifetime-order check. Before the day-3 and day-10 discount reminders, Reef Ops now asks whether the subscriber placed an order at or after `WELCOME_RUN.enteredAt`. Local `lastOrderAt` is compared to that timestamp, and Shopify is queried with the same `created_at` lower bound before the claim and immediately before delivery. Orders before enrollment do not block the sequence; orders after enrollment skip discount reminders; the day-15 social email remains independent. The map and Welcome settings state this rule directly. Integration coverage includes both an order after enrollment and an older local/Shopify order. TypeScript, ESLint, all 65 marketing tests, and the flow browser suite pass. No production build was run because of the known local Turbopack cache instability.

### Audience Messages readability — September 14, 2026

The profile Messages tab was reorganized for accounts with extensive test history. Active flows appear first with compact sent/upcoming counts and clear Last sent/Next panels. Completed runs are collapsed under **Previous flow runs** and show a compact summary when opened. Message history defaults to upcoming messages and provides count filters for Upcoming, Sent, Not sent, Needs review, and All, plus a flow filter when multiple workflows are present. Individual messages use compact rows instead of separate tall cards. Testing explanation and bulk cleanup moved into a collapsed **Testing tools** section; per-message send/cancel controls remain on eligible rows. Status semantics are available in a collapsed help section. The non-Overview identity block is also condensed. No delivery, eligibility, cleanup, or flow-progress behavior changed. TypeScript, changed-source ESLint, and the Audiences browser suite pass, including completed-flow disclosure, status filtering, test controls, and 320/390px overflow checks. No production build was run because of the known local Turbopack cache instability.

### Reef Ops popup visual match — September 14, 2026

The Reef Ops signup popup was restyled from the generic single-panel dialog to match the live Klaviyo popup: a narrow two-panel desktop modal, the original clownfish/coral artwork, centered offer hierarchy, orange Continue button, dimmed backdrop, and circular close control. The artwork was copied into `public/welcome-popup-art.png`, and the script resolves it relative to its own public URL so the storefront does not depend on Klaviyo's CDN. At 520px and below, the artwork stacks above the form; shorter desktop viewports tighten the vertical rhythm and retain dialog scrolling. The explicit required email-consent checkbox remains, with email-only language; Klaviyo's SMS disclosure was deliberately not copied because Reef Ops currently uses single opt-in email and SMS is paused.

No enrollment or delivery behavior changed. The 10-second appearance delay, seven-day dismissal interval, known-customer/submitted suppression, outside/Escape dismissal, timezone capture, test restrictions, consent API call, and Welcome enrollment remain intact. Verification passed with `node --check`, the six editor/signup tests, TypeScript, ESLint, and a new real-browser popup check at 1280, 390, and 320 pixels. No production build was run because of the known local Turbopack issue. The copied Shopify theme will not show this redesign until the new public asset and script deploy; the live Klaviyo popup remains unchanged.

### Confirmed email resubscription — September 14, 2026

The popup can now safely restore email consent after a clearly voluntary opt-out. Reef Ops matches the submitted address to its consent record. Only `UNSUBSCRIBED` records with no suppression reason and a source of `unsubscribe-link` or `shopify` qualify. Reef Ops sends a purpose-specific ownership confirmation while keeping the profile suppressed. The confirmation handler rechecks the current suppression before clearing it, records `FORM_EMAIL_RESUBSCRIBED` and a fresh consent event, restores `Mailable Subscribers`, preserves the submitted timezone, and then invokes normal Welcome enrollment. Existing Welcome run/message history still prevents a second Welcome offer.

Provider bounces and complaints, staff suppressions, generic/ambiguous imports, and all other suppression reasons remain sticky and receive no resubscription message. The public popup response is identical for eligible resubscriptions, blocked addresses, and ordinary single-opt-in submissions, and it does not return a resumable session in those completed responses; this prevents subscription-state enumeration. The worker permits a suppressed address to receive only an unexpired resubscription confirmation whose saved purpose and current consent still pass the same predicate. No database migration was needed because consent source/reason fields already existed. All 65 marketing tests, TypeScript, targeted ESLint, script parsing, and responsive popup browser checks pass. No production build was run because of the known local Turbopack issue.

### 24-hour delivery upsell — September 14, 2026

The supplied Klaviyo flow is triggered by `Delivery_Date_ISO_NEW`, re-entry is allowed, and a chain of `delivery_date_iso is in the next N days` splits/waits ultimately sends the same UpSell email as the delivery date approaches. Shopify Flow creates that event from an Order created trigger when an order tag begins with a month name; its Liquid removes `Shipping`, `Shiping`, or `Ship` variants and formats the result as a date. The user confirmed that Triom merges add-on orders and refunds the extra shipping/box fee. The CTA is `https://coralsanonymous.com/collections/new-arrivals`.

Reef Ops replaces the repeated threshold chain with a direct schedule. The existing `orders/create` marketing ingestion parses month-date tags plus the three prefixed variants and schedules one email at 08:00 America/Los_Angeles two calendar days before the delivery date. Each Shopify order can enroll once; historical imports, test orders, malformed dates, past deadlines, and orders without a recognized tag do not schedule a message. Delivery upsell uses normal consent, flow pause, ingestion, unresolved-event, provider, and idempotency checks. Because it is deadline-sensitive, ordinary recent-email spacing does not postpone it; in-progress or uncertain email delivery still holds it. Its settings include days before, send hour, timezone, and a one-address test restriction. Existing saved scaffold content is upgraded only as an unreviewed editor draft, preserving customized copy/artwork; it cannot be enabled until saved and reviewed.

The default email mirrors the supplied Klaviyo content and uses the shared email designer: `Last Chance to Add Corals Before We Pack Your Box`, the 24-hour add-on message, the Triom refund note, orange `Grab More Corals Now!` CTA, shared logo/footer branding, and the New Arrivals destination. No financial or Triom behavior is changed by Reef Ops.

### Configurable popup dismissal pause — September 14, 2026

The Forms tab now has a saved **Pause for 7 days after a visitor closes the popup** checkbox. It defaults on for existing and new installations. Turning it off stores `popupDismissalDays: 0`; the storefront still records a close for activity reporting but ignores the stored dismissal on later page loads. Closing hides the current dialog, and the popup can appear again after the eligible visitor loads another page and the normal ten-second delay passes. Submitted-browser suppression, Shopify known-customer suppression, pending signup sessions, form enablement, consent, and all Welcome behavior are unchanged. The public config response supplies the setting to `reef-marketing.js`, with a safe seven-day fallback for older or malformed responses. Browser coverage verifies both enabled and disabled dismissal behavior at desktop and narrow widths.

### Configurable popup appearance delay — September 14, 2026

The Forms tab also stores **Time before popup appears** as `popupDelaySeconds`, accepting whole seconds from 0 through 300 and defaulting safely to 10. The storefront loads its public configuration, waits for that saved interval, then rechecks dismissal eligibility before rendering the popup. Pending signup sessions still resume without a delay. Browser coverage verifies that the public script uses the configured millisecond interval.

### Intent-aware message spacing — September 14, 2026

The old 16-hour Smart Sending behavior permanently cancelled a cart or Welcome email when another marketing email had recently been accepted. Reef Ops now distinguishes intent. The initial Welcome email, manually triggered B2B welcome, and deadline-sensitive delivery upsell ignore ordinary recent-sent spacing. Cart emails and later Welcome emails are postponed to one second after the latest local or imported email's 16-hour window, then repeat consent, purchase, coupon, flow, and provider checks. Marketing texts use the same deferral model with their existing 24-hour window. Messages in `SENDING` or `UNKNOWN` remain hard holds for every one of these flows. Test-only rapid-send controls remain available for restricted cart and Welcome test accounts; the redundant delivery bypass was removed because delivery notices are always exempt.

### Campaign audiences and delivery controls — September 21, 2026

Campaigns now distinguish Klaviyo-imported lists from Reef Ops dynamic segments. Imported list resources retain their `klaviyo-list-*` keys and exact profile membership; native segments continue to recalculate from their saved rules. The Audiences screen labels both types accurately and prevents list membership rules from being edited as if they were a segment. Campaigns can include multiple lists/segments with OR semantics and exclude multiple lists/segments. Current email consent, suppression, and address checks always apply after those selections.

New campaigns default to the `mailable` dynamic segment, 16-hour Smart Sending, and send-time audience calculation. Staff can instead freeze the eligible recipient snapshot while scheduling. Snapshot membership stays fixed, while later unsubscribe/suppression still blocks delivery. Send-time mode resolves the selected resources when expansion starts and rechecks dynamic membership before provider delivery. Missing saved audiences fail closed. Old embedded campaign audience rules remain readable and executable.

Campaigns support scheduled delivery and **Send now**. Smart Sending is a campaign-level switch; when enabled, a recipient with a local or imported email receipt in the previous 16 hours is skipped and reported, matching one-time campaign behavior rather than postponing a dated sale send. In-progress and uncertain messages remain delivery reservations even when Smart Sending is off. Per-campaign results report sent, delivered, opened, clicked, ordered, skipped, failed, needs-review, attributed revenue by currency, and skip/error reasons.

Database migration `20260921143000_campaign_delivery_options` adds `smartSendingHours` and `recipientMode`. Verification: all 73 marketing tests pass, including disposable-Postgres coverage for list/segment inclusion and exclusion, snapshot persistence, Smart Sending, and results. TypeScript, targeted ESLint, the shared campaign/template browser test, and the marketing browser suite pass. No production build was run due the known local Turbopack instability. No live campaign was created or sent during implementation.

The Klaviyo segment named **2025 Mailable Subscribers** was later confirmed to mean: can receive email marketing AND opened an email at least once in the last 365 days. This is the same rule already stored under Reef Ops key `mailable`: campaign eligibility supplies the subscribed/unsuppressed email requirement, while `{ openedDays: 365 }` supplies the engagement window. Migration `20260921190000_rename_2025_mailable_segment` renames that existing segment to the Klaviyo-facing name without duplicating it or changing campaign references.

The original Klaviyo profile/list backfill does not supply historical open timestamps, so the segment count cannot be trusted from that import alone. Settings > Advanced now includes a separate resumable **Import Klaviyo email opens** operation. It finds Klaviyo's `Opened Email` metric, pages through events from the previous 365 days with their included profiles, and advances each matching Reef Ops profile's `lastOpenedAt` without moving it backward. The import is read-only in Klaviyo and updates only profiles already present in Reef Ops. Starting or pausing returns immediately; the existing five-minute Railway scheduled service processes bounded batches and checkpoints every page, so the browser can be closed. The last user-requested pause preserved progress at 107,600 events processed and 94,749 profile-row updates (updates are not a unique-profile count). Verify live status before resuming, and complete the import before using the 2025 Mailable Subscribers segment for a campaign.

### Analytics and pending-flow directory — September 21, 2026

The Analytics tab provides selectable 7/30/90/365-day reporting for automated flows and campaigns. It shows sends, unique delivery/open/click counts, attributed orders, order rate, and gross revenue by currency. A follow-up parity change replaced click-first/open-fallback attribution with Klaviyo-style email last touch: the chronologically newest qualifying open or click wins. Click and open windows are independently saved from Analytics (1–90 days) and default to five days each. The lookback starts at confirmed delivery when present and otherwise at provider-accepted send time. Analytics resolves attribution from recorded history on every report, so changing a window recalculates historical results without rewriting order records. Like Klaviyo flow/campaign reports, date selection is based on message send date and later qualifying engagement/conversions remain with that message. Revenue is before refunds and currencies are not converted.

Resend's signed open/click webhook identifies the message but does not supply Klaviyo-equivalent bot-click or Apple MPP classification. The Analytics UI discloses that those optional exclusion toggles cannot be reproduced with current provider data. SMS is disabled and cross-channel/linear attribution is not implemented. Do not describe this as complete Klaviyo analytics parity beyond the current email last-touch model.

Audiences now has a **Pending flows** view. It lists profiles with `PENDING`, `SENDING`, or `UNKNOWN` flow messages, supports search and flow filtering, groups active work per profile, and shows the next message/due time plus active, paused, or needs-review state. Rows open the existing profile panel. The view is read-only and cannot advance or deliver a flow.

Verification: TypeScript, targeted ESLint, all 77 marketing tests, the Audiences browser suite, and the shared Campaigns/Templates/Analytics browser suite pass. Both browser suites include 320px overflow coverage. No production build was run because of the known local Turbopack instability.
