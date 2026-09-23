# Our Klaviyo — implementation and rollout

> Continuation note: Read [the September 10 handoff](REEF-OPS-HANDOFF.md) first. This document includes historical implementation notes; the handoff identifies superseded statements and distinguishes live observations from automated verification.

This is a local V1 implementation, not a completed Klaviyo cutover. No production database, storefront, sender configuration, or Shopify account was changed during implementation. All sends and flows default to disabled.

## Architecture inspected and reused

- Next.js 16.3.4 App Router, React 19.2.4, existing AppShell and shared CSS variables.
- Prisma 7.8 PostgreSQL adapter and the existing `lib/prisma.ts` client. Additive migration only; no existing tables are changed.
- Existing dashboard Basic authentication via `isDashboardRequestAuthorized`; explicit authorization on marketing APIs because the proxy excludes `/api`.
- Existing Shopify domain/helper configuration and order webhook. Order ingestion is gated by `MARKETING_INGEST_ENABLED`. The order route durably enqueues marketing work before inventory deduplication; identity conflicts are handled by the worker and do not block inventory claims.
- Existing Resend account variables and dependency. Marketing sends use a separate adapter with unsubscribe headers, postal address and stable idempotency keys.
- Existing standalone `tsx` scheduled-job pattern. Run `npm run scheduled:all` every five minutes on the deployment scheduler. The worker processes a durable Shopify inbox, uses database claims and bounded batches, and paces email requests.
- Low-stock alerts query tracked Shopify variants in the configured collection. ProductInventoryState remains separate from marketing stock alerts.

## Preserved value and deliberate safeguards

Consent is channel-specific (email, SMS marketing, SMS transactional) with event history. Imports cannot clear suppressions. Older updates cannot roll back newer consent; suppressions win even when received late. Re-subscribing a suppressed address requires a future reviewed reconciliation process; ordinary imports cannot do it.

Identities are unique per shop/email/phone/Shopify ID. Conflicting identities or address changes fail for review rather than transferring consent. Email confirmation uses a separate 256-bit secret, stored hashed and consumed once. Public browser session IDs cannot confirm an address. Confirmed signup links can associate the popup's anonymous events. Anonymous pixel events cannot claim a customer, purchase or consent; matching across devices or the pixel sandbox is not automatic.

Webhook event keys and message keys are unique. Transactions use serializable retry for profile/consent updates. Send claims recheck channel eligibility, audience membership, current B2B tag, reviewed flow state, operational switches, inbox health and recorded purchases. Known rate-limit failures retry with backoff; uncertain network outcomes are marked UNKNOWN. A crashed in-flight send is also UNKNOWN. Never requeue UNKNOWN without checking provider logs; the provider's idempotency window is finite. Provider webhooks that arrive before the message ID is persisted return a retryable failure.

The audited mailable audience is subscribed, unsuppressed email AND an open within 365 days. Historical opens are critical to migrate. Apple/privacy proxy opens remain a limitation, just as with provider open reporting.

Attribution is one email message per order using configurable Klaviyo-style last touch: the newest qualifying open or click wins, with five-day click and open defaults. Browser checkout completion is never counted as an order. Revenue is gross order value, grouped by currency; it does not subtract refunds. Analytics recalculates from recorded history, while the attribution saved on an individual order remains the result known when Shopify delivered that order event. The Overview diagnostic caps its attributed-order aggregation at 10,000 records and labels this when reached.

## Milestones implemented

1. Profiles, identity conflict detection, consent ledger, sticky suppression, historical imports, dynamic audiences and static list memberships.
2. Expandable Our Klaviyo navigation: Overview, Campaigns, Flows, Forms, Audiences, Templates, Analytics, Settings.
3. Campaign drafts, template reuse, subject/preview/hero/body/button/product cards, desktop/mobile HTML preview, allowlisted internal test email, duplication, scheduling, cancellation and send-time eligibility. Flow email editors support sanitized HTML, desktop/mobile email previews and allowlisted test sends from the current editor. SMS uses a separate plain-text field. Product cards are rendered, and uploaded email artwork is sent using inline CID attachments.
4. Five configurable flow definitions. Welcome, abandoned cart, and delivery upsell now have versioned implementations; B2B and low-stock retain their documented behavior. Delivery upsell reads the existing Shopify order delivery-date tag and schedules one message directly instead of reproducing Klaviyo's repeated daily split chain.
5. Storefront script: responsive popup with a Forms-tab appearance delay from 0 to 300 seconds, outside/Escape dismissal, submitted-browser and known-customer suppression, and single-opt-in Welcome enrollment. The delay defaults to 10 seconds. The Forms tab also controls whether a dismissal pauses the popup for seven days or only for the current page. Voluntarily unsubscribed profiles use confirmation-based resubscription; bounces, complaints, and staff suppressions stay blocked.
6. Signed Shopify, Resend and gateway event endpoints; open/click/delivery/bounce/complaint/unsubscribe events; anonymous storefront observations; aggregate analytics.

## September 9 hardening and B2B acceptance path

Apply the new additive migration **20260909190000_marketing_webhook_inbox** before running this worker. Generate the Prisma client during build. Do not edit or replay old migrations against an existing deployment.

1. In staging, create defaults only if needed. Initialization is idempotent and does not rewrite existing flow copy. Reading the dashboard no longer mutates B2B templates.
2. Open B2B Welcoming Email. Review the current subject, sanitized HTML, CTA and artwork. Use its internal test-send control with an allowlisted employee address. Invalid links show validation feedback without crashing the editor.
3. Enable only B2B after reviewing it. With ingestion enabled, add the b2b Shopify tag to a new, email-subscribed test customer. The dedicated tag event hydrates current identity, tags and consent. Missing tags in a later customer update preserve stored tags.
4. Run the scheduler and inspect Settings → Delivery health. The inbox persists failures and retries them with backoff; after ten failed attempts, it requires review/retry. All marketing sends wait while any inbox events remain unresolved to avoid sending against stale consent or purchase state. Identity changes require reconciliation; retrying without resolving the conflict will fail again.
5. Confirm one email arrives and repeat the tag event to verify no second send. Remove the tag before a delayed message is claimed and confirm cancellation. Later consent can resume a previously ineligible enrollment but does not enroll historical B2B imports.

The flow map now comes from the same configuration used for enrollment. Delays are absolute minutes after the trigger. Unsupported welcome purchase branches and 5 PM timing are no longer displayed as implemented. Legacy abandoned-cart yes-branch copy is retained for compatibility but never sent after purchase; the no-purchase offer remains editable. Review other journeys independently before enabling them.

Pausing a flow defers pending messages rather than deleting them. Content is snapshotted on enrollment: editing a flow changes future enrollments, not existing queued messages. Cancelling a campaign or suppressing a channel cancels pending messages. UNKNOWN outcomes still require provider reconciliation and are never automatically requeued.

Each run reserves up to 100 automation emails, 100 campaign emails and 50 SMS candidates, with a three-minute delivery budget. SMS prerequisites/quiet hours defer SMS without blocking email. Campaign expansion is capped at 500 new recipients per campaign for up to five campaigns per run. Email attempts are paced within a worker and 429 responses use backoff/Retry-After. This is not a throughput SLA or a distributed provider rate limiter; use one scheduled worker and measure queue age against real audience size.

The dependency review updated Next.js and its ESLint config to 16.3.4 and patched compatible transitive dependencies. Remaining audit advisories in Prisma tooling need a separately validated upgrade; no forced Prisma downgrade was applied.

Fresh-database testing also found an existing, unrelated historical migration-order issue: the July supplier migration references ReorderMapping before its creation migration sorts into place. The marketing integration suite applies the baseline and marketing dependencies explicitly; it does not claim the entire historical migration chain can bootstrap a blank database. Existing deployments with those migrations applied are unaffected by that test discovery.

## Required configuration

Keep these in the deployment's environment, not source control:

```dotenv
DATABASE_URL=postgresql://...
SHOPIFY_SHOP_DOMAIN=corals-anonymous.myshopify.com
SHOPIFY_CLIENT_ID=...
SHOPIFY_CLIENT_SECRET=...
DASHBOARD_USERNAME=...
DASHBOARD_PASSWORD=...
APP_BASE_URL=https://YOUR-REEF-OPS-HOST
RESEND_API_KEY=...
RESEND_FROM_EMAIL=Corals Anonymous <marketing@YOUR-VERIFIED-DOMAIN>
RESEND_WEBHOOK_SECRET=whsec_...
MARKETING_POSTAL_ADDRESS=YOUR BUSINESS MAILING ADDRESS
MARKETING_TEST_EMAILS=EMPLOYEE_EMAILS_COMMA_SEPARATED
MARKETING_INGEST_ENABLED=false
MARKETING_SEND_ENABLED=false
MARKETING_MIGRATION_CONFIRMED=false
MARKETING_FORM_ENABLED=false
MARKETING_STOREFRONT_ORIGIN=https://coralsanonymous.com
MARKETING_PREVIEW_SHOP_ID=YOUR_NUMERIC_SHOPIFY_STORE_ID
MARKETING_WELCOME_COUPON=YOUR_EXISTING_10_PERCENT_FIRST_ORDER_CODE
```

After the deployment gates above are configured, use **Our Klaviyo → Settings → Operational controls** for routine operation. The send, migration, Shopify-ingestion and signup-form switches are stored in the database and take effect without a redeploy. The worker rechecks controls before each message claim; requests already in flight may finish. Both Shopify event entry points honor ingestion controls. The dedicated marketing endpoint returns 503 while paused so Shopify can retry within its delivery window. The corresponding Railway variables remain hard safety gates: a disabled deployment variable always blocks the matching Reef Ops control. Save the mailing address in the UI. `MARKETING_POSTAL_ADDRESS` is an optional fallback; provider readiness uses the saved address, so it does not need to be duplicated in Railway.

The coupon must already exist in Shopify, with first-order eligibility and limits configured there. V1 references a configured code; it does not mint unique codes. Welcome must be reviewed/enabled before the signup offer can be fulfilled. Do not enable the form before this is ready. Confirmation emails and welcome jobs require the worker and email configuration. Pending browser sessions can resume after visiting the email confirmation link; optional SMS is offered only when its gateway is configured.

Apply the migration to a staging database first using `npm run migrate:deploy`. Start the dashboard, visit Our Klaviyo and choose Create defaults. The production build check uses a placeholder database URL. Automated integration tests separately apply the marketing migrations to a fresh in-memory PostgreSQL engine (PGlite), then exercise real Prisma writes with external requests mocked. No production database is used.

Set up Resend sending domain authentication (SPF/DKIM/DMARC), marketing tracking, complaint handling and sending limits. Connect `/api/marketing/webhooks?source=resend` for email.delivered, email.opened, email.clicked, email.bounced, email.complained and email.failed. All bounce events suppress conservatively. Confirm your provider account supports the intended marketing volume. Test emails can go only to MARKETING_TEST_EMAILS, even while general sending is disabled.

Shopify: preserve the existing orders/create webhook and enable MARKETING_INGEST_ENABLED after migration. In **Our Klaviyo → Settings**, click **Connect Shopify events** once; Reef Ops registers customers/create, customers/update, customer tag added/removed, email/SMS consent updates and checkouts/create plus checkouts/update against `/api/marketing/webhooks?source=shopify`. The existing inventory orders/create route remains the single order subscription and also feeds marketing ingestion. Shopify's newer customer payloads do not include the changed tag list or marketing consent on customers/update, so the dedicated tag and consent topics are required for B2B enrollment and compliant sends. If the button reports a permission error, add the app's webhook and customer read scopes, then retry. Import the initial customer base; webhooks cover subsequent changes. Anonymous checkouts are recorded without enrollment; they do not block the inbox. A later checkouts/update with identity can enroll recovery using the original checkout creation time. Re-run Connect Shopify events after upgrading to add that subscription. Order cancellation checks depend on timely successful ingestion, so validate this before enabling abandoned cart.

Delivery upsell uses the existing `orders/create` ingestion path. It accepts month-date order tags and the existing `Shipping`, `Shiping`, or `Ship`-prefixed variants, then schedules one email at the configured Pacific-time hour two calendar days before delivery by default. Each order can enter once; historical imports and orders without a recognized tag do not enroll. The older signed `/api/marketing/webhooks?source=delivery` endpoint remains compatible for an explicit expected-delivery event, but it is no longer required for the Shopify path.

## SMS adapter contract

V1 defines a gateway interface, not a configured Twilio/carrier integration. Set MARKETING_SMS_GATEWAY_URL, MARKETING_SMS_GATEWAY_KEY and MARKETING_SMS_WEBHOOK_SECRET only after implementing a provider-backed gateway. The worker POSTs `{id,to,channel,text}` with bearer authentication and Idempotency-Key. The gateway must persist idempotency, return `{id}`, handle carrier registration, STOP/HELP, country restrictions and current opt-outs. Its callbacks to `?source=sms` use the HMAC headers above and `{id,messageId,type,occurredAt}`. Supported types include DELIVERED, CLICKED, FAILED, UNSUBSCRIBED and SMS_RECEIVED. Map STOP to UNSUBSCRIBED. The gateway must suppress immediately, independently of Reef Ops callback timing.

Recipient timezone is required for SMS. Customer marketing texts use 10:00–20:00; reviewed internal stock texts use 11:00–20:00 in the configured recipient timezone. Stock text setup requires staff confirmation of the recipient’s permission. Channel suppressions and unsubscribes always block delivery. Staff stock email does not subscribe the recipient to customer email marketing.

## Storefront installation

Host `public/reef-marketing.js` on the storefront's asset/CDN system, then load it with a script tag whose `data-endpoint` is `https://YOUR-REEF-OPS-HOST/api/marketing/storefront`. The current dashboard proxy protects static paths, so loading `/reef-marketing.js` directly from Reef Ops requires an explicit asset exception or copying the asset to Shopify. Set `data-known-customer="true"` when the theme recognizes a logged-in customer; existing confirmed/submitted visitors are also suppressed through local storage. Previously imported profiles on a completely anonymous browser cannot be recognized until they identify themselves.

Shopify share-preview links can use a rotating `https://TOKEN-STOREID.shopifypreview.com` origin instead of the main storefront domain. Set `MARKETING_PREVIEW_SHOP_ID` to this store's numeric Shopify ID to allow only its HTTPS preview hosts through the signup endpoint's CORS check. This setting is optional when previews stay on the configured storefront origin.

Use `shopify/reef-marketing-custom-pixel.js` for customer events, replacing the placeholder origin and requiring marketing/analytics permission in Shopify pixel settings. Validate actual sandbox Origin behavior before connecting: the endpoint accepts only the configured storefront origin. The theme helper `window.reefMarketingEvent` must only be invoked after customer privacy permits marketing analytics. Form action events record the signup funnel, while optional behavior tracking must honor storefront consent.

The form currently has fixed copy and styling. Brand/legal links and final appearance must be reviewed before installation. Rate limiting assumes your trusted ingress overwrites x-forwarded-for; otherwise configure an edge limit. Completed worker runs delete RATE, SIGNUP and CONFIRMATION records older than seven days; consent/event history is retained. Monitor retention separately if sending remains disabled for long periods.

## Migration

Export suppressed addresses, unsubscribes, subscribers, SMS consent evidence, profile properties/tags/lists and historical last-open timestamps before removing Klaviyo. Keep an untouched export outside the repository. The converter `scripts/prepare-klaviyo-import.ts` accepts a CSV/XLSX export and an explicit JSON field mapping; it never guesses consent. Example mapping: `{"email":"Email","emailStatus":"Email Status","consentAt":"Consent Timestamp","consentSource":"Consent Source"}`. Run with input file, mapping file, output JSON paths. Output creation refuses to overwrite an existing file.

The preferred path is **Settings → Advanced → Bring over the Klaviyo audience**. It uses the server-side `KLAVIYO_PRIVATE_API_KEY` and requires `profiles:read` and `lists:read`. The staff-started job reads one API page per request, records resumable progress, and can be paused. It imports identities, email and SMS consent evidence, global suppressions, current Klaviyo list membership, timezone, and an explicit `Shopify Tags` profile property when present. It never guesses consent from list membership or the `can_receive_*` flags. A list-specific suppression removes that list membership without turning it into a global suppression. When an email is available, Shopify remains authoritative for the profile's current phone number; Klaviyo phone identity is used only for phone-only profiles. Imported profiles do not enter historical Welcome or B2B flows, and the job never sends messages or writes to Klaviyo. Row conflicts remain visible for review while the rest of a page continues.

The prepared-file importer remains available as a fallback. Use Settings to validate and import normalized batches of 500. Statuses must be SUBSCRIBED, UNSUBSCRIBED or NEVER_SUBSCRIBED. Subscribed records require consentAt and consentSource. Email/SMS suppressed booleans win over subscription status. Empty fields do not create subscription permission. Suppressions come first. Validation checks each row in a rolled-back transaction; conflicts between two new rows in the same dry-run batch can still appear during import and are reported per row. Import is intentionally row-atomic so failures do not discard successful rows. Repeated imports do not enroll welcome flows.

Use emailConsentAt/emailConsentSource and smsConsentAt/smsConsentSource when channel evidence differs; consentAt/consentSource are fallbacks only when the evidence actually applies to both. Internal operational recipients can use smsTransactionalStatus with its required smsTransactionalConsentAt and documented source. Marketing consent never grants transactional SMS consent implicitly.

Compare profile, mailable and suppression totals with Klaviyo; inspect samples and resolve identity conflicts. Verify old engagement dates and timezones. Only then set MARKETING_MIGRATION_CONFIRMED=true, enable providers/worker, and send a small controlled campaign. Disable the corresponding Klaviyo flow/form when enabling each replacement to prevent duplicate messages.

## Validation and remaining work

`npm run marketing:test` runs helper, React editor and database-backed integration tests. Coverage includes B2B tag/consent hydration, single enrollment, tag removal, late consent, historical imports, queue fairness, confirmation-secret separation and replay protection, sticky suppression, ingestion controls, resource visibility, and inventory isolation. PGlite uses one connection; this does not establish production PostgreSQL concurrency behavior. Provider callbacks, overlapping workers under load, real inbox/SMS delivery and migration application against the existing deployment still require staging. `npm run build:check` builds with placeholder configuration after client generation.

Deferred or limited: A/B testing (explicitly excluded), full drag/drop editor, exact audited visual template reconstruction (original assets absent), Shopify product picker/collection population, consent reconciliation UI, SMS carrier adapter, automatic UNKNOWN-send reconciliation, detailed per-campaign unique-event funnels, refund-adjusted attribution, identity cross-device stitching, privacy erasure/export workflows, advanced deliverability dashboards, predictive CLV, benchmarking and enterprise reports. Klaviyo dynamic segments are not copied as static lists; Shopify remains authoritative for later customer-tag changes. These limits mean this implementation is not yet a turnkey Klaviyo replacement.

Primary technical references: https://shopify.dev/docs/apps/build/webhooks/verify-deliveries and https://resend.com/docs/dashboard/emails/idempotency-keys .

## Email editing workspace

Opening an email step opens a full-screen workspace with Content, Artwork, and Send test panels. Content supports visual text formatting and an explicit HTML mode; opening or switching panels does not rewrite saved HTML. Save email writes through the existing flow save action. Unfinished copy and uploaded artwork remain in the resource-scoped browser draft. Tests use the current draft without enabling the flow. Older queued deliveries keep their enrollment snapshot.

The preview renders the same responsive markup used for delivery, with desktop and 320/375/414 px phone widths. The email uses a fluid table capped at 600 px, constrained images, wrapping text, and narrower padding on phones. Preview links are inert. Individual inbox clients still need an internal test send.

Run `npm run marketing:browser:test` with Chrome installed (or set `MARKETING_TEST_BROWSER` to a browser executable) for isolated real-browser tests of overflow, oversized artwork, visual formatting, draft restoration, save failure feedback, and narrow-screen controls. The fixture blocks external requests and uses no deployment data. Screenshots go to a temporary directory reported by the test.

Design references: [Klaviyo template editor](https://help.klaviyo.com/hc/en-us/articles/4407911841435), [Klaviyo mobile optimization](https://help.klaviyo.com/hc/en-us/articles/115005254428), and [Mailchimp new builder](https://mailchimp.com/help/design-an-email-new-builder/). The workspace follows their sidebar/canvas, formatting, and device-preview patterns; it is not a full drag-and-drop template builder.

Footer editing is available in the email workspace Footer panel: heading, message, and unsubscribe introduction. Footer artwork remains in Artwork. Sender name/address come from Settings, and the unsubscribe link remains automatic. Internal test sends show an informational unsubscribe page and omit one-click headers; actual workflow messages keep their real token and headers. See [B2B acceptance checklist](b2b-workflow-acceptance.md) for the live test sequence and outstanding US compliance checks.

## Audience workspace

The Audiences tab has three views: **Contacts** for all known customers, **Saved audiences** for reusable email campaign groups, and **Pending flows** for profiles with at least one queued, in-flight, or uncertain flow message. Contacts supports server-side name/email/phone search, email-status filters, a B2B shortcut, and 25-row pages with Previous/Next controls. The list scrolls within a bounded area.

Open a contact to view a side panel without losing the list position. Overview shows subscriptions and tags; Messages shows scheduled, sent, and skipped messages with reasons; Activity translates events into readable history. Refresh in the panel retrieves current state. Marketing blocking is behind an explicit per-channel confirmation, and subscriptions cannot be restored here. Internal preview emails are not associated with a contact. History currently shows up to 100 messages and 100 events, with a visible limit notice.

Saved audiences display their rules in plain language. View contacts applies the same consent and segmentation rules used for email delivery; blocked or unsubscribed contacts are excluded. Creating/editing a group does not send email or change consent. The editor keeps input after a save error and asks before discarding unsaved changes. The original saved audience keys are retained on edits.

Pending flows supports profile search and an individual-flow filter. Each profile row groups all active flow work and shows the next subject and due time, upcoming-step count, and whether the flow is active, paused, or needs staff review. Opening the profile uses the same detailed Messages panel. This view is read-only and does not advance, cancel, or deliver messages.

Design references: [Klaviyo profiles](https://help.klaviyo.com/hc/en-us/articles/115005247088), [Mailchimp contact profiles](https://mailchimp.com/help/about-contact-profile-pages/), and [Mailchimp saved segments](https://mailchimp.com/help/save-and-manage-segments/).

Validation: `node scripts/audiences.browser.test.cjs` exercises the actual component in an isolated local browser fixture; no production data or email provider is contacted. Directory integration tests use the disposable marketing test database.

## Analytics workspace

Analytics reports 7-, 30-, 90-, or 365-day results separately for automated flows and one-time campaigns. Like Klaviyo's flow and campaign reports, the selected period chooses messages by send date; engagement and qualifying conversions remain attached to those messages even if they occur later. Sent, delivered, unique opened, unique clicked, attributed orders, order rate, and gross attributed revenue are shown. Currencies are reported separately rather than converted.

Reef Ops uses Klaviyo-style email last touch. The most recent qualifying open or click receives the order, and the click/open windows are independently configurable from 1–90 days; both default to Klaviyo's current five-day email defaults. The window starts at confirmed delivery when recorded, falling back to provider-accepted send time, and Analytics recalculates historical results from recorded interactions when the settings change. This is message attribution rather than proof that the message alone caused the sale. Gross order value is shown before refunds, currencies stay separate, and total tracked order revenue is shown for context.

Resend identifies the exact message for opens and clicks but does not label webhook events as Apple Mail Privacy Protection opens or bot clicks. Reef Ops therefore cannot reproduce Klaviyo's optional MPP/bot exclusion toggles with current provider data. SMS, push, WhatsApp, paid-channel cooperative attribution, linear attribution, currency conversion, and refund-adjusted revenue are also outside this email-only model.

## Settings workspace

Settings is organized into Overview, Sending & signup, Business details, and Advanced. Overview retains manual Shopify processing and readable health information. Configuration status is explicitly described as configuration, not verified domain authentication or inbox delivery. The sender address is read-only and comes from deployment configuration; the editable business name is used in the footer.

Each settings section submits only its own fields. Draft changes survive section navigation and status refreshes, and failed saves retain inputs. Enabling customer sending requires an explicit review of its scope and pending-message count. No delivery is triggered by saving business details or manually processing Shopify events. Existing worker and deployment gates remain enforced.

Advanced retains Shopify webhook registration, migration review, prepared JSON import, and diagnostics. Imports require successful validation of the current batch before the import button is enabled; editing or choosing another file clears validation. Results are shown per row instead of raw JSON. The import UI accepts prepared JSON, not raw Klaviyo CSV.

Design references: [Mailchimp settings and defaults](https://mailchimp.com/help/audience-settings-and-defaults/) and [Klaviyo sender settings](https://help.klaviyo.com/hc/en-us/articles/360024994912).

Run `node scripts/settings.browser.test.cjs` for the isolated browser checks, including independent section saves, sending confirmation, import validation, save-error recovery, and mobile layout. These checks never access production services.

### Manual delivery

Settings → Overview → Delivery health includes **Run delivery now**. It invokes the same worker as the scheduled job, processing due messages across eligible campaigns and workflows. It does not move future due dates, enable sending, bypass consent, or retry uncertain deliveries automatically. The result reports sends/checks or why the run was skipped. This is separate from **Process Shopify events now**, which never invokes delivery. The action requires dashboard authentication and the normal origin checks.

## Flow directory

The Flows landing page supports search by name/trigger, status filters, and enabled-first or alphabetical sorting. It presents plain-language trigger descriptions, channels and step counts from the shared executable flow sequence, and all-time message counts grouped by flow. Queued/sending includes pending and in-flight messages; Sent is provider acceptance, not proof of inbox delivery. Failed and uncertain messages are called out without automatically retrying them.

Flow enabled state is separate from global sending controls, which are summarized above the directory. Opening a workflow replaces the directory with the existing workflow editor. All flows returns to the prior search/filter state and restores focus. The existing email editor, saved copy/artwork, draft storage, and workflow execution logic are unchanged.

Design references: [Klaviyo Flows tab](https://help.klaviyo.com/hc/en-us/articles/12930413372187) and [Mailchimp automation flows](https://mailchimp.com/help/create-customer-journey/). Run `node scripts/flows.browser.test.cjs` for isolated browser verification, including draft preservation while navigating between the directory and editor.

## T5 staff stock alerts

The reviewed Shopify workflow watches collection `488202338530` (T5 Tank), tests **variant inventory < 5**, emails Russell, and emits a Klaviyo event for his text. Reef Ops uses the agreed improvement: one alert per observed crossing, then re-arms only after observed recovery to 5 or more. The prefilled staff email is russellvinson7@gmail.com and mobile is +16573450924, with America/Los_Angeles quiet hours.

- The stock editor uses the same clickable FlowMap schematic as the other flows. Trigger, recipient, text and recovery blocks open centered keyboard-accessible dialogs. Email opens the shared EmailDesigner with simplified stock-copy controls and the same desktop/mobile EmailPreview as B2B; preview and delivery share stockMessageContent so example fields render through the actual email template. review/enable/save controls remain below the diagram. The stock editor stores a validated `stock` configuration in the existing FLOW resource. Collection, threshold, recipient, channels, subject and message copy are editable. Browser drafts survive navigation; deployments do not rewrite saved resources.
- Shopify's [productVariants collection filter](https://shopify.dev/docs/api/admin-graphql/latest/queries/productVariants) supplies paginated variants, with inventory tracked per variant across locations. Untracked or missing quantities are excluded. All pages must load before applying observations; failures never replace inventory with zero.
- Checks run during the marketing worker, even while sending is paused, when the stock flow is reviewed/enabled and ingestion is enabled. This is polling, not a replay of every inventory webhook: a drop and recovery entirely between checks may be missed.
- The first observation establishes a baseline without queuing pre-existing low stock. The state key includes collection and threshold, so changing either establishes a new baseline. Durable serializable transactions and cycle-specific message keys prevent duplicate alerts. Stale snapshots are ignored.
- A recovery cancels unsent messages. Delivery rechecks the current recipient, channel, monitoring scope, variant presence, cycle, suppression and successful scan. A stock API failure defers stock delivery but does not stop unrelated customer email.
- Staff email uses the configured internal recipient without enrolling that person in email marketing. Existing EMAIL suppression/unsubscribe still blocks it. Staff texts require explicit permission confirmation in the editor; SMS_TRANSACTIONAL suppressions/unsubscribes still block them. Text delivery also requires the existing SMS gateway contract and waits outside **11 a.m.–8 p.m. Pacific**, including daylight-saving changes.
- **Preview current stock** is read-only and uses the unsaved form values. **Check saved flow now** applies the saved rules and can queue messages; it does not call a delivery provider. The regular worker can subsequently send eligible queued messages when sending is enabled.
- Existing legacy stock resources require review in the new editor before they can send. No migration rewrites saved copy or enables a flow.

### Live acceptance test

1. Open Flows → Low Stock Alert: T5 → the stock trigger block. Preview current stock and confirm the returned collection is T5 Tank. Review recipient, copy and channels. If the SMS gateway is not ready, use email only for the first test.
2. Arrange the cutover from the old Shopify/Klaviyo flow to avoid duplicate staff alerts. Save the reviewed stock flow enabled, then open **Test and check stock** and choose **Check saved flow now** to establish its baseline.
3. On a designated test variant in the collection, set stock to 5 and check; set to 4 and check. Expect one queued message per enabled channel. With sending on, the worker or **Run delivery now** delivers the due email; texts also respect quiet hours.
4. Check again at 4, then lower to 3 and check: no additional messages. Restore to 5 and check, then lower to 4 and check: one new cycle.
5. Confirm recovery before delivery cancels a queued alert. Verify recipient suppression and actual SMS gateway delivery before relying on texts.

Automated coverage: isolated PostgreSQL integration tests mock Shopify/provider calls for baseline/crossing/recovery, strict boundary, variants, duplicates, pagination, staff email, suppression, authenticated preview and failure isolation. Browser coverage exercises setup, validation, draft restoration/save, read-only preview, manual check and 320/390px layouts. These tests do not send real messages.

## Abandoned Cart — first iteration (September 9, 2026)

Open **Flows → Abandoned Cart**. The upgraded editor starts as an unreviewed, paused browser draft until saved. It preserves customized copy and artwork; untouched starter copy is replaced with the three supplied Klaviyo email approximations. Saving does not enable the flow unless the Enable checkbox is selected. Waiting versioned checkouts use updated email copy when first prepared. A wait already entered keeps its deadline; later waits use the current saved duration when they begin. Prepared provider retries keep their content and subject.

### What runs

- An identified Shopify checkout enters once per checkout if the profile has a trusted checkout-start event in the last three days (including the triggering checkout). A different checkout may re-enter without the old 24-hour enrollment lock.
- Text subscribers wait 30 minutes, then receive the marketing text when permitted. Other customers bypass that text delay.
- After the text is sent or skipped, wait three hours, then send the first soft-push email. Customers on the email-only path wait three hours from checkout.
- Wait one day after the first email is sent or skipped. A purchase in the preceding two weeks selects the second soft push; otherwise select the 10% offer.
- A purchase since the checkout began stops remaining reminders. Shopify order history is checked as well as locally received order events; if Shopify cannot be checked, delivery waits.
- Current consent and suppression apply to every message. If another marketing email was accepted in the last 16 hours, cart email waits until that spacing window ends and then repeats all purchase and eligibility checks. Text behaves the same way with a 24-hour spacing window. Pending or uncertain deliveries remain hard holds.
- Text quiet hours are 8 p.m.–11 a.m. in the profile's recorded timezone, checked before Smart Sending. Missing timezone or SMS gateway pauses that path, including subsequent email. This does not implement Klaviyo's inferred area-code timezones or additional country/state-specific SMS scheduling.
- Failed/skipped terminal steps allow the next delay to begin; an uncertain provider outcome holds the sequence for reconciliation. Manual delivery still honors due times, consent, quiet hours and global switches.
- Checkout updates refresh products/link without restarting the journey. Empty checkout updates cancel pending reminders. Old legacy jobs are not converted into the new sequence.

### Email and recommendations

All three messages use the existing responsive designer, editable footer, artwork storage and desktop/mobile preview. Turquoise styling, serif italic copy, logo area and pill-shaped cart button approximate the screenshots; exact water artwork, complete footer and product-section styling can be refined later. Test emails contain clearly marked sample products and a non-redeemable preview code.

The real checkout recovery URL replaces the example cart URL. Available products from the current checkout and identified cart activity in the last 90 days appear first. Remaining slots alternate products ranked by recorded sales quantities and product views during the last three days, across all categories, removing duplicates and unpublished/out-of-stock products. Four slots are the editable default (0–12). Product availability, URLs, images and prices come from Shopify. Fewer products are shown if insufficient data or stock exists; unrelated static products are not substituted.

Recommendations combine Reef Ops observations with completed Klaviyo imports. Views count per recorded event. History uses keyset pagination rather than a 10,000-event cutoff, and Shopify availability checks continue through batches of 100 candidates until the requested slots are filled or candidates run out. Slow history queries fail preparation for retry instead of silently using incomplete rankings. A completed import supplies popularity before its snapshot cutoff; native activity supplies events after that cutoff, preventing overlap from being counted twice. The mix of best sellers and most viewed is deterministic interleaving, not Klaviyo’s proprietary recommendation model.

**Preview customer products** is read-only and uses the draft product count and customer history. Its tracking disclosure downloads the existing Shopify custom pixel with this deployment’s public URL filled in. Install it in Shopify Customer events with marketing and analytics consent required, then verify product views with Check Shopify connection. Anonymous browsing is not matched by an unverified email address. The Shopify pixel is not installed automatically.

### Discount

The offer creates an actual Shopify basic discount: 10% off all items, no minimum, no combination with other discount classes, prefix AC300-, activation during send preparation, expiry one calendar year later. Codes are single-use (matching Klaviyo Shopify coupons) and unique per message. The random code is persisted before creating it; retries look up that same code to recover a lost Shopify response. Email is withheld on preparation failure. Prepared email content is frozen for provider retries.

Required Shopify access: read orders, read products and write discounts (including discount lookup access), plus protected customer-data permissions applicable to checkout/order data. The **Check Shopify connection** button checks scopes, checkout/order subscriptions and recent view activity without sending or creating a discount. It is not a full deliverability or SMS compliance certification.

### Controlled live test

1. Keep the flow paused. Open each email and use **Send test** to an internal allowlisted address; check desktop/mobile content and footer.
2. Run **Check Shopify connection**. Add missing app access, and use Settings to connect Shopify events (now includes ORDERS_CREATE). Verify that product views are arriving after installing the customer-events pixel.
3. Pause the equivalent Klaviyo automation before enabling Reef Ops to prevent duplicate customer reminders. Confirm SMS provider readiness and recipient timezone if testing texts.
4. Review and save the flow. Use a subscribed internal Shopify customer to start a fresh checkout with products, enter contact details and leave without paying.
5. Process events in Settings and inspect the contact's scheduled messages. Use Run deliveries now for messages already due, or wait for the worker. For a faster isolated test, save shorter delays before starting the test checkout, then restore 30 minutes / 3 hours / 1 day before live use.
6. Test both prior-order branches, then a separate checkout followed by a purchase to confirm cancellation. Verify the generated Shopify discount's amount, restrictions and expiration without using a customer purchase.
7. New checkouts may re-enter. Recent-email spacing can postpone a reminder, but it no longer permanently skips it; changing tags is unrelated to this flow.

Automated tests use an isolated disposable database and mocked Shopify/email providers. They do not verify production credentials, actual checkout webhook payloads, mobile carrier delivery, inbox placement, or access grants.

References: [Klaviyo quiet-hours sequencing](https://help.klaviyo.com/hc/en-us/articles/4408737146651), [Smart Sending](https://help.klaviyo.com/hc/en-us/articles/115002779311), [Shopify discount creation](https://shopify.dev/docs/api/admin-graphql/latest/mutations/discountCodeBasicCreate), [discount input fields](https://shopify.dev/docs/api/admin-graphql/latest/input-objects/DiscountCodeBasicInput).

### History import and results

**Bring over Klaviyo history** requires a server-side KLAVIYO_PRIVATE_API_KEY with events:read, metrics:read and profiles:read scopes. Add it in Railway, never in chat. The authenticated action imports one API page per request; the dialog continues batches while open and supports pause/resume. Progress, missing metrics and errors are visible. Imports read Checkout Started/Added to Cart (90 days), Viewed Product/Ordered Product (3 days), and Received Email (2 days). They do not create customers, enroll journeys, change consent, send messages or alter Klaviyo. Imported history can match a subsequently created Reef Ops profile by normalized email. Duplicate event IDs are ignored. Pagination URLs are restricted to the Klaviyo API origin.

The separate **Import Klaviyo email opens** task restores the previous 365 days of Opened Email activity used by the 2025 Mailable Subscribers segment. Starting it records a durable running state; the five-minute Railway scheduled service processes bounded batches and stores a cursor after every page. Staff can close the browser, view the latest batch and counts later, or pause without losing completed profile updates. It reads Klaviyo only and does not send messages or change consent.

Refresh history after drafting the equivalent Klaviyo flow and before enabling Reef Ops. Recent imported email receipts postpone eligible cart and Welcome reminder emails until the 16-hour spacing window ends. Imports are staff-triggered snapshots, not continuous synchronization; missing metrics cannot be reconstructed. Email eligibility, SMS support and artwork are unchanged in this iteration.

**View flow results** shows each cart step’s waiting, sent, delivered, unique opens/clicks, attributed orders/sales, skipped and attention counts for messages created in the last 30 days. Revenue stays separate by currency. Its saved order associations reflect the attribution settings in effect when each Shopify order was processed; the main Analytics workspace recalculates Klaviyo-style last touch from recorded history. Privacy-protected opens may inflate open measurements.

Additional verification covers paginated read-only imports and foreign-link rejection, the 90-day cart and 3-day popularity windows, overlapping history, queued content and wait edits, imported recent-email protection, report deduplication, staff authentication and production-specific tracking downloads. Browser checks cover these dialogs at desktop, 390px and 320px. Live API access, pixel installation and a controlled checkout still require verification before cutover.

References: [Klaviyo product feeds](https://help.klaviyo.com/hc/en-us/articles/115005082787), [flow timing and edits](https://help.klaviyo.com/hc/en-us/articles/360017706091), [Events API](https://developers.klaviyo.com/en/reference/get_events).

### Shopify custom pixel sandbox requests

Shopify custom pixels send cross-origin requests with the literal Origin header `null`. The storefront endpoint answers preflight and POST requests for that origin, but accepts only anonymous PRODUCT_VIEWED, ADDED_TO_CART and CHECKOUT_STARTED observations. A null origin is not identity proof: signup, SMS consent, session status and configuration actions remain restricted to the configured storefront origin. Missing and unrelated origins are rejected. Existing event validation, rate limits, deduplication and the ingestion switch still apply. No pixel reinstallation is needed for this server-side correction.

### Restricted abandoned-cart email testing

In the cart editor, enable **Restrict this flow to one test email**, enter the internal account, review, enable and save. The Saved audience line shows the persisted restriction and enabled state separately from the browser draft. Changing or removing the restriction clears review and enable in the draft; no production setting changes until saved. Product-count and content edits preserve the restriction.

Only the configured email may newly enroll, and matching test runs send email only, bypassing the SMS branch without changing subscription data. Normal consent, purchase checks, delays, email spacing and global send/ingest gates remain active unless the test-only spacing bypass is selected. Worker claims and final email preparation recheck the saved test audience. Previously queued customer runs cannot send under test mode, and queued test runs cannot become production runs when test mode is removed. Start a fresh checkout after saving the restriction; existing completed/cancelled journeys are not restarted. This restriction covers Abandoned Cart only, not other flows or campaigns. No live flow is enabled automatically by this release.

### Send an individual cart test step early

Audiences → the restricted test account → Messages shows **Send this step now** on pending, unattempted versioned cart email steps belonging to the current saved test audience. The follow-up stays disabled until the first step has sent or been skipped. The authenticated action checks the selected message belongs to that profile, confirms the enabled/reviewed test flow and global sending/ingestion setup, and requires a drained Shopify inbox before advancing only that message’s wait. It records an audit event and invokes the worker for that message ID only; it does not expand campaigns, process other recipients, run inventory checks or change the saved flow delays.

Consent/suppression, purchase checks, 16-hour spacing, test-audience changes, provider idempotency and uncertain-delivery safeguards remain in effect. Trying the follow-up immediately after receiving the first email postpones it until the spacing window ends unless the restricted test flow explicitly allows rapid test emails. The button bypasses the flow wait, not other delivery eligibility. Completed, attempted, non-test and other-profile messages are rejected. The account panel refreshes after the action and reports the actual result. No test email is sent automatically by deploying this feature.

## Shared email editing

Flows, campaign drafts, and reusable templates use `EmailDesigner`, the shared `Content` model and `content()` validation, `render()` HTML generation, and `emailBody()` delivery formatting. Layout presets (`standard`, `b2b-wholesale`, and `cart-recovery`) change appearance, not delivery infrastructure. Flow-specific logic supplies recipient data, products, checkout URLs, and coupons before using that same pipeline. Low-stock settings retain their existing token-based copy and store shared email footer settings in `emailContent`; old saved flows remain readable.

Every email has a Footer → Show business address toggle. `showPostalAddress` defaults to false for existing content without the field and for new content, and applies to HTML and plain text. The organization name and unsubscribe link remain. Turn the address on before customer marketing sends to meet postal-address requirements. This preference does not remove the configured business address or change sending gates.

Browser regression: `node scripts/campaigns.browser.test.cjs` checks campaign/template editing, preview, save payloads and narrow dialogs with mocked requests.

## Profile flow progress

Audience profiles show flow progress in Overview and Messages: last accepted send, next pending step, pending/sent/skipped/failed counts, and recorded cancellation or error reasons. Cart checkouts are grouped separately, including re-entry. Summaries combine the latest 100 messages with up to 500 active flow messages, and disclose truncated history. A pending cart follow-up does not claim a discount branch before send-time order checks. These summaries are read-only and do not alter enrollment or delivery.

Product recommendations exclude Shipping Protection and Shipping Box titles and backfill with eligible products; the actual Shopify checkout is not changed.

The isolated marketing integration suite advances stored timestamps to exercise follow-ups without real-time waits. It covers future messages remaining pending, sequential deadlines, both order-history branches, purchase cancellation, email-spacing deferral, and mocked Shopify discount creation/retry. This verifies application behavior, not the deployed scheduler uptime or live Shopify coupon redemption.
