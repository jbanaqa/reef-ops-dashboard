<!-- Historical findings, before the September 9 remediation. See our-klaviyo.md for current behavior and remaining staging requirements. -->

# Our Klaviyo implementation review — September 9, 2026

**Assessment:** Keep this in setup/testing until the P1 findings below are addressed. The foundation is useful, but the current implementation is not ready to replace customer-facing Klaviyo flows.

The user confirmed that this is still in setup/testing. This review covered the current local marketing code, API routes, storefront script, Shopify custom pixel, flow and campaign editors, schema/migrations, import converter, scheduled runners, authentication boundary, and existing order-webhook integration. No production configuration, database, storefront, or provider was accessed or changed. Implementation files were not changed; this report is the only artifact added.

## Evidence and limits

- TypeScript compiler diagnostics: **0 errors**, using the installed compiler and project tsconfig, with no emit.
- All **10 existing marketing test cases passed** through an in-memory TypeScript/module harness. This executed their assertions; it was not the npm test runner.
- Additional isolated reproductions exercised the actual implementation with fake database/provider dependencies. Confirmed: inbox confirmation bypass; stale editor state; incorrect node mapping; blocked SMS starving email across successive worker runs; customer tag erasure; a post-purchase cart reminder; missing HTML coupon; omitted product cards; unsafe branch acceptance; raw name interpolation into HTML; ingestion while its deployment gate is false.
- These checks do not validate PostgreSQL locking, migration deployment, real webhook delivery, inbox appearance, browser integration, or provider acceptance. The normal shell runner could not start due to a Windows access-control/helper error, followed by OS error 1392. Read-only inspection and isolated checks used the available Node runtime instead. No production build or PostgreSQL integration suite was run.
- Shopify's documented removal of tags from ordinary customer payloads was checked against its official changelog. Its current webhook examples confirm the dedicated tag and consent payload shapes.

P1 means a launch blocker because it can affect consent, recipients, flow behavior, delivery, or existing order processing. P2 means an important functional or hardening fix.

## Findings

### 1. P1 — Email ownership confirmation can be bypassed

**Locations:** [storefront route](../app/api/marketing/storefront/route.ts), lines 36–47; [confirmation route](../app/api/marketing/confirm/route.ts), lines 7–17.

The signup handler creates a session value, uses it as the secret in the email confirmation URL, and also returns it to the browser. The confirmation endpoint accepts that same value with no independent proof of mailbox access. A caller can submit someone else's address, read the session from the response, and POST the confirmation URL immediately.

**Reproduction:** Signup returned HTTP 200. Posting its returned session to the confirmation handler also returned 200, recorded SUBSCRIBED with source storefront-confirmed-v1, and enrolled welcome, without sending or reading an email.

**Fix:** Separate the browser session from a cryptographically independent confirmation secret. Deliver the secret only through email; store its hash, bind it to the intended profile/address and expiry, and consume it atomically. Add a negative test proving the public session cannot confirm an address. A recorded checkbox submission is not evidence that the caller owns the email address.

### 2. P1 — Selecting a different flow can overwrite it with the previous flow

**Locations:** [FlowEditor](../app/our-klaviyo/FlowEditor.tsx), lines 16–19; [dashboard](../app/our-klaviyo/MarketingDashboard.tsx), line 60.

FlowEditor initializes flow and enabled state only on mount. The dashboard changes its resource prop without keying or resetting the editor. Selecting another workflow while the editor remains open preserves the old flow data and enabled flag, while the save callback uses the newly selected resource key.

**Reproduction:** Open an enabled welcome flow, then select a disabled B2B flow. Save submits the welcome subject and enabled=true under the B2B resource.

**Fix:** Bind editor state to a stable resource ID/key, remount or reset deliberately when selection changes, and handle unsaved changes explicitly. Refresh the selected resource after a successful save.

### 3. P1 — Clicking a node edits the wrong message, and delay edits can do nothing

**Locations:** [FlowEditor](../app/our-klaviyo/FlowEditor.tsx), lines 20–27 and 52; [FlowMap](../app/our-klaviyo/FlowMap.tsx), lines 4–13.

FlowEditor and FlowMap each construct separate node objects. The editor uses nodes.indexOf(clickedNode), which returns -1 for an object created by FlowMap. Its slice/count logic therefore chooses the wrong target. Wait controls also read from step even though step is assigned only for message targets, making the displayed delay zero.

**Reproduction:** Clicking abandoned-cart Email #1 selects steps[1], displaying Email #2. Clicking its first wait selects index 3, displays zero, and saving a new delay leaves both configured steps unchanged.

**Fix:** Give nodes stable IDs and explicit targets, or use the index already supplied by FlowMap. Map every displayed control to its actual stored timing field. Low-stock SMS currently maps to smsContent even though its sender reads steps; that needs an explicit target too.

### 4. P1 — The displayed flow logic is not the executed flow logic

**Locations:** [FlowMap](../app/our-klaviyo/FlowMap.tsx), lines 6–10; [enrollment](../lib/marketing/flows.ts), lines 17–42; [worker](../lib/marketing/worker.ts), lines 39–47; [defaults](../lib/marketing/rules.ts), lines 54–59.

The welcome diagram shows purchase conditions, four messages, and a 5 PM wait. Enrollment actually queues three default messages at signup, +1 day, and +3 days, with no welcome purchase conditions or local-time scheduling. The abandoned-cart diagram promises a checkout-age check that is never evaluated. Its SMS and order-branch timing are hardcoded independently of the visible editor.

This lets an operator review and enable a journey whose actual behavior differs materially from the diagram. Delayed or backlogged checkout events can also send stale reminders.

**Fix:** Use one validated flow definition to drive the diagram, editor, and executor. Implement the desired conditions and timing, or remove unsupported claims from the interface. Confirm the original welcome/abandonment requirements before implementing parity.

### 5. P1 — Customers who purchased still receive an abandoned-cart reminder

**Locations:** [worker](../lib/marketing/worker.ts), lines 43–47; [order ingestion](../lib/marketing/ingest.ts), line 139; [seeded copy](../lib/marketing/store.ts), lines 47 and 53.

ORDER_PLACED branch messages are deliberately excluded from purchase cancellation. A recorded purchase selects the yes branch, whose default copy says the customer's order is not complete. This contradicts the general purchase-cancellation safeguard described in the implementation notes.

**Reproduction:** A message triggered September 7 with a recorded September 8 purchase was sent with subject Another Soft Push and body Your order is not complete yet.

**Fix:** End cart recovery after purchase, or define an explicitly intended post-purchase branch with suitable copy. Also retain checkout-specific context for the no branch: the branch currently uses saved generic content rather than the triggering checkout recovery URL.

### 6. P1 — Deferred SMS can stop the entire email queue

**Location:** [worker](../lib/marketing/worker.ts), lines 28 and 48–54.

Every run selects the first 50 due messages across channels. SMS with an unavailable gateway, missing timezone, or quiet-hour restriction is left PENDING with its old dueAt. Those same rows win the next run's selection again. Fifty such messages prevent later eligible email, including confirmation emails, from being inspected.

**Reproduction:** With 50 pending SMS rows and an eligible email behind them, two successive worker runs each inspected 50 and sent zero; the email was never selected.

**Fix:** Separate channel queues or move deferred work to a future eligible dueAt. Route missing prerequisites into an actionable blocked state and avoid starvation. Use recipient-local next-send time for quiet hours. Apply cancellation before deferral when consent or flow state already disqualifies a message.

### 7. P1 — Ordinary Shopify customer updates erase B2B and other tags

**Location:** [ingestion](../lib/marketing/ingest.ts), lines 111–125.

An omitted tags field becomes an empty list and overwrites the profile's tags on customers/update. Modern Shopify customer payloads omit this field; dedicated tag events now carry changes. A normal later customer update can therefore remove B2B audience membership and cancel pending campaign sends at the membership recheck.

**Reproduction:** A profile with b2b and vip received a customer update containing identity and updated_at but no tags. The generated profile update was tags: [].

**Fix:** Preserve tags when the field is absent; only replace them from an authoritative explicit snapshot. Keep hydration/tag-event ordering consistent, and retry failed tag hydration instead of acknowledging a partial update and hoping another event arrives.

Source: [Shopify customer webhook payload changes](https://shopify.dev/changelog/new-customer-s-webhook-and-changes-to-existing-customer-s-webhooks-payload). [Current webhook payload examples](https://shopify.dev/docs/api/webhooks/latest).

### 8. P1 — A marketing identity error can block existing inventory order processing

**Location:** [orders-create route](../app/api/webhooks/shopify/orders-create/route.ts), lines 84–92, before inventory claim creation at line 169.

Marketing ingestion is awaited before the existing inventory path. Its identity handling intentionally throws on conflicting identities or changed addresses. Those expected reconciliation cases therefore return HTTP 500 before any new inventory claims are recorded. Retrying cannot fix a persistent identity conflict. The marketing settings table is also queried even when deployment ingestion is disabled.

**Fix:** Give marketing a durable retry/dead-letter inbox independent of inventory processing. Preserve event recovery without making existing inventory work depend on successful marketing identity reconciliation. Add an integration test that an identity conflict still allows exactly one set of inventory claims.

### 9. P1 — The Shopify ingestion switch does not cover the marketing webhook endpoint

**Locations:** [marketing webhook](../app/api/marketing/webhooks/route.ts), lines 10–30; compare [orders-create gate](../app/api/webhooks/shopify/orders-create/route.ts), lines 86–90.

The dedicated marketing endpoint invokes ingestion without consulting either the deployment gate or database operational control. Disabling ingestion stops orders through the original route, but customer/tag/checkout events continue processing and enrolling flows through the dedicated endpoint. Sending can remain enabled, leaving checkout recovery active without fresh purchase cancellations.

**Reproduction:** With MARKETING_INGEST_ENABLED=false, the marketing webhook handler still invoked ingestion and returned 200. Signature verification was stubbed as successful to isolate gate behavior.

**Fix:** Centralize operational gating across Shopify entry points, define whether disabled events are durably retained, and prevent recovery sends if order ingestion is unhealthy. Do not disable provider unsubscribe/suppression handling with this switch.

### 10. P1 — HTML editing and the actual message body drift apart

**Locations:** [FlowEditor](../app/our-klaviyo/FlowEditor.tsx), line 48; [welcome coupon](../lib/marketing/flows.ts), lines 24–28; [rendering](../lib/marketing/rules.ts), lines 43 and 51; [delivery](../lib/marketing/delivery.ts), lines 12 and 27.

The flow editor changes bodyHtml, while SMS and email plain text use body. The welcome coupon is appended only to body, but HTML rendering prefers bodyHtml. Editing a welcome email in the provided HTML editor therefore removes its coupon from the main HTML version. Editing SMS through the same UI does not change the text the gateway receives. Campaign drafts inherited from HTML templates have a similar risk because their visible Message editor changes body only.

**Reproduction:** A welcome content object contained the expected coupon in body, but render() omitted it when bodyHtml was present.

**Fix:** Establish one canonical email document and generate its plain-text equivalent. Inject the coupon into both outputs with an explicit placeholder. Give SMS a plain-text editor that writes the actual sending field.

### 11. P2 — Public traffic can push all configuration out of the dashboard

**Location:** [marketing GET](../app/api/marketing/route.ts), line 104.

The resource query returns only the latest 200 records and excludes only STOCK. RATE and SIGNUP rows share the table and continuously receive recent timestamps. Enough public traffic can fill the result with transient rows, hiding every FLOW, SEGMENT, and TEMPLATE. The dashboard can then incorrectly show Create defaults even though flows still exist and the worker continues sending.

**Fix:** Query an explicit allowlist of UI resource kinds, with independent pagination where needed. Store/routinely expire transient records separately. The absence of retention is documented; hiding active configuration due to the shared cap is an additional functional defect.

### 12. P2 — Order-branch content bypasses server validation

**Location:** [save-resource](../app/api/marketing/route.ts), lines 174–180.

The endpoint validates steps and smsContent but persists orderBranch unchanged. The worker later sends branch content directly. Malformed branches can also throw during branch selection before the send error handler, aborting the run.

**Reproduction:** An enabled flow with a javascript: branch URL and a script element in its branch HTML was accepted with HTTP 200 and stored unchanged.

**Fix:** Validate both branch objects, subjects, and content using the same schema as other messages. Validate the entire flow shape, including allowed keys, channel-specific fields, thresholds and recipient lists, before save and before activation. This is an authenticated configuration boundary, not an unauthenticated dashboard takeover finding.

### 13. P2 — Customer names can inject markup after HTML sanitization

**Location:** [B2B rendering](../lib/marketing/rules.ts), lines 40–44.

The custom-HTML path replaces the first-name placeholder with a raw profile-name token after sanitization. Shopify/imported names are external data. A compact markup token can therefore become an actual element in the outbound email.

**Reproduction:** A synthetic name containing an image element appeared as raw markup in render() output. This shows HTML injection; the dashboard preview is sandboxed and email clients may apply additional filtering, so it is not evidence of script execution in either environment.

**Fix:** Escape personalization values in their output context and use a replacer callback for substitutions. Keep all customer fields separate from trusted template markup.

### 14. P2 — Product cards are accepted and edited but never rendered

**Locations:** [campaign editor](../app/our-klaviyo/MarketingDashboard.tsx), line 50; [content validation](../lib/marketing/rules.ts), line 31; [render](../lib/marketing/rules.ts), lines 37–51.

The editor and validator support products, but neither HTML template emits them. The plain-text email omits them as well.

**Reproduction:** One product remained in normalized content while its unique title was absent from the rendered message.

**Fix:** Render product cards in HTML and a text equivalent, or remove the unsupported control until implemented. Add a test that verifies saved product content appears in delivery output.

### 15. P2 — The optional SMS step cannot be resumed after leaving the popup

**Location:** [storefront script](../public/reef-marketing.js), lines 11 and 21.

The script permanently sets reef-marketing-submitted after requesting email confirmation. On a later visit it returns immediately. Although a session is stored, it is never loaded to resume the optional SMS step. A person who leaves the page to confirm email and returns cannot reopen that step through the installed script, despite the confirmation page instructing them to return for SMS.

**Fix:** Track pending confirmation, confirmed email, and completed/dismissed SMS as separate states. Resume the correct step on return and provide a visible retry path. Existing subscribers currently receive a misleading confirmation message even though no confirmation resource/email is created; handle that case without revealing subscription status publicly.

## Operational improvements before a cutover

1. **Size the worker for the real audience.** At one run every five minutes and 50 messages per run, the ideal maximum is 600 sends/hour before retries, deferrals and provider latency. A 10,000-person campaign takes at least 16 hours 40 minutes and competes with welcome/confirmation traffic. Add explicit priority/fairness, provider-aware concurrency and measurable queue-age targets. Campaign expansion itself is fully scanned before delivery rather than bounded per run.
2. **Add integration tests, not more helper-only tests.** Cover real PostgreSQL concurrent claims, suppression versus claim ordering, duplicate webhooks, out-of-order events, purchase cancellation, crash recovery, importer conflicts, and migration application on a database that already has the first marketing migration. Add browser tests for the three editor defects and signup/confirmation journey.
3. **Expose delivery health.** Alert on oldest pending message age, UNKNOWN/FAILED counts, webhook failures and last successful worker completion. UNKNOWN reconciliation is documented but there is no complete operator workflow. Persist enough provider/message correlation to recover safely; do not blindly requeue unknown outcomes.
4. **Clarify control semantics.** Global settings are loaded once per worker run; disabling sends does not stop its remaining batch. Pausing a flow cancels its due jobs rather than deferring them. Decide and explain the intended behavior, and recheck critical controls before claiming later messages. Freeze and persist the actual selected branch content so message history reflects what was sent.
5. **Validate storefront and delivery behavior in staging.** Test the custom pixel's actual sandbox Origin against the strict origin allowlist, coupon application and first-order limits, the confirmation journey on another device, real inbox rendering, provider webhooks and one-click unsubscribe. Uploaded images currently use data URLs; consider hosted assets or provider-supported CID attachments and test inbox compatibility. [Resend inline attachment support](https://resend.com/docs/dashboard/emails/attachments).
6. **Treat SMS as its own unfinished integration.** The gateway contract is documented, but carrier/provider setup is external. Email confirmation does not prove ownership of a supplied phone number. Decide how phone verification and consent evidence will be enforced with the actual gateway before enabling SMS.
7. **Reconcile migration and metrics deliberately.** Preserve untouched exports; import suppressions first; normalize Shopify IDs consistently across exports and webhooks; compare counts and sample consent histories. The current aggregate event counts and gross, capped attribution are useful diagnostics but do not establish reporting parity with Klaviyo. The spreadsheet converter maps field names and basic values; date formatting and source-specific consent statuses still need explicit preparation.

## What is worth keeping

The schema has unique identities, event keys and message keys. Consent is channel-specific with sticky suppressions and event history. Identity conflicts fail rather than silently transferring consent. Critical profile/consent paths use serializable transactions with retries. Provider requests have stable idempotency keys, and uncertain delivery is not blindly retried. Dashboard APIs explicitly check authentication despite the proxy excluding API paths. Unsubscribe uses POST rather than mutating on link previews. Imports are row-atomic and do not enroll historical welcome flows. Documentation is unusually clear about what has not been staged or delivered.

These are useful foundations. The immediate priority is to make the public confirmation proof, flow editor, actual flow execution, and reliable event/queue processing agree before customer-facing use.
