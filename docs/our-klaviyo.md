# Our Klaviyo — implementation and rollout

This is a local V1 implementation, not a completed Klaviyo cutover. No production database, storefront, sender configuration, or Shopify account was changed during implementation. All sends and flows default to disabled.

## Architecture inspected and reused

- Next.js 16.2.9 App Router, React 19.2.4, existing AppShell and shared CSS variables.
- Prisma 7.8 PostgreSQL adapter and the existing `lib/prisma.ts` client. Additive migration only; no existing tables are changed.
- Existing dashboard Basic authentication via `isDashboardRequestAuthorized`; explicit authorization on marketing APIs because the proxy excludes `/api`.
- Existing Shopify domain/helper configuration and order webhook. Order ingestion is gated by `MARKETING_INGEST_ENABLED` and runs before inventory deduplication so retries can recover missing marketing work.
- Existing Resend account variables and dependency. Marketing sends use a separate adapter with unsubscribe headers, postal address and stable idempotency keys.
- Existing standalone `tsx` scheduled-job pattern. Run `npm run marketing:scheduled` every minute on the deployment scheduler. The new worker uses database claims and bounded batches; no in-process timers.
- Existing ProductInventoryState for internal low-stock crossing detection. No separate stock sync.

## Preserved value and deliberate safeguards

Consent is channel-specific (email, SMS marketing, SMS transactional) with event history. Imports cannot clear suppressions. Older updates cannot roll back newer consent; suppressions win even when received late. Re-subscribing a suppressed address requires a future reviewed reconciliation process; ordinary imports cannot do it.

Identities are unique per shop/email/phone/Shopify ID. Conflicting identities or address changes fail for review rather than transferring consent. Confirmed signup links can associate the popup's anonymous events. Anonymous pixel events cannot claim a customer, purchase or consent; matching across devices or the pixel sandbox is not automatic.

Webhook event keys and message keys are unique. Transactions use serializable retry for profile/consent updates. Send claims recheck channel eligibility, audience membership, flow state and recorded purchases. Known rate-limit failures retry with backoff; uncertain network outcomes are marked UNKNOWN. A crashed in-flight send is also UNKNOWN. Never requeue UNKNOWN without checking provider logs; the provider's idempotency window is finite. Provider webhooks that arrive before the message ID is persisted return a retryable failure.

The audited mailable audience is subscribed, unsuppressed email AND an open within 365 days. Historical opens are critical to migrate. Apple/privacy proxy opens remain a limitation, just as with provider open reporting.

Attribution is one message per order: last recorded click within five days, otherwise last open within one day. Browser checkout completion is never counted as an order. Revenue is gross order value, grouped by currency; it does not subtract refunds and will differ from Klaviyo. Late engagement arriving after an order does not retroactively reattribute it. The current dashboard caps attributed-order aggregation at 10,000 records and labels this when reached.

## Milestones implemented

1. Profiles, identity conflict detection, consent ledger, sticky suppression, historical imports, dynamic audiences and static list memberships.
2. Expandable Our Klaviyo navigation: Overview, Campaigns, Flows, Forms, Audiences, Templates, Analytics, Settings.
3. Campaign drafts, template reuse, subject/preview/hero/body/button/product cards, desktop/mobile HTML preview, allowlisted internal test email, duplication, scheduling, cancellation and send-time eligibility. Flow message editors support plain copy with the audited automatic homepage link or sanitized HTML for deliberate formatting control.
4. Five configurable, initially paused flow definitions. Welcome/B2B enroll once; abandoned cart has a configurable email sequence and optional SMS at 30 minutes, with purchase cancellation; low stock alerts use configured internal profiles; delivery upsell requires a trusted expected-delivery event.
5. Storefront script: 10-second popup, desktop/mobile, outside/Escape dismissal, seven-day dismissal interval, submission suppression and a separate optional SMS step. Email confirmation adds an ownership check before enrolling welcome emails. This intentionally adds double opt-in to the audited experience; the popup says the offer follows confirmation. Settings stores the organization name and business mailing address used in every footer, preview and future send.
6. Signed Shopify, Resend and gateway event endpoints; open/click/delivery/bounce/complaint/unsubscribe events; anonymous storefront observations; aggregate analytics.

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
MARKETING_WELCOME_COUPON=YOUR_EXISTING_10_PERCENT_FIRST_ORDER_CODE
```

After the deployment gates above are configured, use **Our Klaviyo → Settings → Operational controls** for routine operation. The send, migration, Shopify-ingestion and signup-form switches are stored in the database and take effect without a redeploy. The corresponding Railway variables remain hard safety gates: a disabled deployment variable always blocks the matching Reef Ops control. Save the mailing address in the UI as well as `MARKETING_POSTAL_ADDRESS`, which is required by the provider readiness check.

The coupon must already exist in Shopify, with first-order eligibility and limits configured there. V1 references a configured code; it does not mint unique codes. Welcome must be reviewed/enabled before the signup offer can be fulfilled. Do not enable the form before this is ready. Confirmed signup emails and welcome jobs require the worker and email configuration.

Apply the migration to a staging database first using `npm run migrate:deploy`. Start the dashboard, visit Our Klaviyo and choose Create defaults. The build was tested with a placeholder local database URL; that did not apply migrations or access a real database.

Set up Resend sending domain authentication (SPF/DKIM/DMARC), marketing tracking, complaint handling and sending limits. Connect `/api/marketing/webhooks?source=resend` for email.delivered, email.opened, email.clicked, email.bounced, email.complained and email.failed. All bounce events suppress conservatively. Confirm your provider account supports the intended marketing volume. Test emails can go only to MARKETING_TEST_EMAILS, even while general sending is disabled.

Shopify: preserve the existing orders/create webhook and enable MARKETING_INGEST_ENABLED after migration. In **Our Klaviyo → Settings**, click **Connect Shopify events** once; Reef Ops registers customers/create, customers/update, customer tag added/removed and checkouts/create against `/api/marketing/webhooks?source=shopify`. The existing inventory orders/create route remains the single order subscription and also feeds marketing ingestion. Shopify's newer customer payloads do not include the changed tag list on customers/update, so the dedicated tag topics are required for B2B enrollment. If the button reports a permission error, add the app's webhook and customer read scopes, then retry. Import the initial customer base; webhooks cover subsequent changes. Checkouts without usable customer identity cannot enroll and require upstream reconciliation. Order cancellation checks depend on timely successful ingestion, so validate this before enabling abandoned cart.

For delivery-upsell integration, the trusted delivery source sends to `/api/marketing/webhooks?source=delivery` with fields id, order_id, expected_delivery_at, customer (id/email). Sign `timestamp.rawBody` using HMAC-SHA256/base64 with MARKETING_DELIVERY_WEBHOOK_SECRET, and provide x-marketing-timestamp (Unix seconds) and x-marketing-signature. The initial interpretation is 24 hours before expected delivery. Confirm the original Klaviyo trigger semantics before enabling it.

## SMS adapter contract

V1 defines a gateway interface, not a configured Twilio/carrier integration. Set MARKETING_SMS_GATEWAY_URL, MARKETING_SMS_GATEWAY_KEY and MARKETING_SMS_WEBHOOK_SECRET only after implementing a provider-backed gateway. The worker POSTs `{id,to,channel,text}` with bearer authentication and Idempotency-Key. The gateway must persist idempotency, return `{id}`, handle carrier registration, STOP/HELP, country restrictions and current opt-outs. Its callbacks to `?source=sms` use the HMAC headers above and `{id,messageId,type,occurredAt}`. Supported types include DELIVERED, CLICKED, FAILED, UNSUBSCRIBED and SMS_RECEIVED. Map STOP to UNSUBSCRIBED. The gateway must suppress immediately, independently of Reef Ops callback timing.

Recipient timezone is required for SMS; worker sends only 10:00–20:00 in that timezone. Confirm deployment-specific messaging rules with the provider. Internal low-stock recipients must have SMS_TRANSACTIONAL consent provisioned through a reviewed operational process; no public form grants that channel. Low-stock baselines avoid sending on the first observation. The default threshold is 5; verify what T5 meant in the audit.

## Storefront installation

Host `public/reef-marketing.js` on the storefront's asset/CDN system, then load it with a script tag whose `data-endpoint` is `https://YOUR-REEF-OPS-HOST/api/marketing/storefront`. The current dashboard proxy protects static paths, so loading `/reef-marketing.js` directly from Reef Ops requires an explicit asset exception or copying the asset to Shopify. Set `data-known-customer="true"` when the theme recognizes a logged-in customer; existing confirmed/submitted visitors are also suppressed through local storage. Previously imported profiles on a completely anonymous browser cannot be recognized until they identify themselves.

Use `shopify/reef-marketing-custom-pixel.js` for customer events, replacing the placeholder origin and requiring marketing/analytics permission in Shopify pixel settings. Validate actual sandbox Origin behavior before connecting: the endpoint accepts only the configured storefront origin. The theme helper `window.reefMarketingEvent` must only be invoked after customer privacy permits marketing analytics. Form action events record the signup funnel, while optional behavior tracking must honor storefront consent.

The form currently has fixed copy and styling. Brand/legal links and final appearance must be reviewed before installation. Rate limiting assumes your trusted ingress overwrites x-forwarded-for; otherwise configure an edge limit. Expired rate-limit and signup records need a scheduled retention policy before sustained public traffic.

## Migration

Export suppressed addresses, unsubscribes, subscribers, SMS consent evidence, profile properties/tags/lists and historical last-open timestamps before removing Klaviyo. Keep an untouched export outside the repository. The converter `scripts/prepare-klaviyo-import.ts` accepts a CSV/XLSX export and an explicit JSON field mapping; it never guesses consent. Example mapping: `{"email":"Email","emailStatus":"Email Status","consentAt":"Consent Timestamp","consentSource":"Consent Source"}`. Run with input file, mapping file, output JSON paths. Output creation refuses to overwrite an existing file.

Use Settings to validate and import normalized batches of 500. Statuses must be SUBSCRIBED, UNSUBSCRIBED or NEVER_SUBSCRIBED. Subscribed records require consentAt and consentSource. Email/SMS suppressed booleans win over subscription status. Empty fields do not create subscription permission. Suppressions come first. Validation checks each row in a rolled-back transaction; conflicts between two new rows in the same dry-run batch can still appear during import and are reported per row. Import is intentionally row-atomic so failures do not discard successful rows. Repeated imports do not enroll welcome flows.

Use emailConsentAt/emailConsentSource and smsConsentAt/smsConsentSource when channel evidence differs; consentAt/consentSource are fallbacks only when the evidence actually applies to both. Internal operational recipients can use smsTransactionalStatus with its required smsTransactionalConsentAt and documented source. Marketing consent never grants transactional SMS consent implicitly.

Compare profile, mailable and suppression totals with Klaviyo; inspect samples and resolve identity conflicts. Verify old engagement dates and timezones. Only then set MARKETING_MIGRATION_CONFIRMED=true, enable providers/worker, and send a small controlled campaign. Disable the corresponding Klaviyo flow/form when enabling each replacement to prevent duplicate messages.

## Validation and remaining work

`npm run marketing:test` covers eligibility, exact time boundaries, exclusions, identity input normalization, URL validation and HTML escaping. Type checking, scoped lint and production build pass. Database migrations, concurrency/recovery tests against PostgreSQL, provider callbacks and real inbox/SMS testing still require a staging database and external setup. Perform these before cutover; a passing build is not proof of production delivery reliability.

Deferred or limited: A/B testing (explicitly excluded), full drag/drop editor, exact audited visual template reconstruction (original assets absent), Shopify product picker/collection population, unique coupon generation, direct Klaviyo API backfill, consent reconciliation UI, visual flow designer, SMS carrier adapter, automatic UNKNOWN-send reconciliation, detailed per-campaign unique-event funnels, refund-adjusted attribution, identity cross-device stitching, privacy erasure/export workflows, advanced deliverability dashboards, predictive CLV, recommendations, benchmarking and enterprise reports. These limits mean this implementation is not yet a turnkey Klaviyo replacement.

Primary technical references: https://shopify.dev/docs/apps/build/webhooks/verify-deliveries and https://resend.com/docs/dashboard/emails/idempotency-keys .
