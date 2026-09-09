# B2B workflow acceptance and US email review

Status: local automated checks passed; live Shopify, sender authentication, Gmail delivery, and actual message content still need verification. No live email or Shopify change was made during this review. The signed-in browser was unavailable to automation.

## What passed locally

- Tag events hydrate the Shopify customer and marketing consent, creating one B2B enrollment. Duplicate/replayed tags do not produce another welcome.
- Removing the tag before delivery cancels the pending welcome. Unsubscribed/suppressed profiles do not receive marketing. Late consent can resume an existing eligible enrollment; historical imports do not enroll automatically.
- Delivery checks the flow, sending controls, consent, and inbox health again before sending. Unknown provider outcomes are not automatically retried.
- Footer heading, message, and unsubscribe introduction survive normalization and saves, are escaped in HTML, and appear in plain text. Clearing footer copy keeps the unsubscribe link and mailing address.
- Actual one-click unsubscribe POST requests suppress email and cancel pending messages. Repeating the request succeeds. Real delivery payloads include List-Unsubscribe and List-Unsubscribe-Post headers.
- Internal preview emails deliberately have no one-click subscription headers; their footer link explains that no subscription changed. A preview send cannot prove the Shopify trigger or actual unsubscribe flow.

## Guided live test

1. In Our Klaviyo → Settings, leave Allow email and campaign sends unchecked. Record emailReady, ingestEnabled, unresolved Shopify events, and worker heartbeat. Verify the organization name and a valid physical mailing address. Readiness flags only check configuration presence; they do not verify DNS or provider approval.
2. Review the B2B subject, copy, discounts, links, footer, and artwork. Use Save email. Add the approved internal address to MARKETING_TEST_EMAILS if it is absent, then use Send test. This can run with global sending disabled. Confirm receipt and desktop/mobile layout in Gmail. Use Gmail Show original to report only the SPF, DKIM, and DMARC results; do not share authentication secrets or full unsubscribe tokens.
3. Verify the Shopify test customer and their recorded email-marketing consent. Check whether this profile has already received a B2B welcome. A sent welcome must not be reset merely to rerun a test. Use a fresh approved test customer when necessary.
4. With global sending still disabled, connect Shopify events if needed, turn on ingestion, and review/enable only the B2B flow. Remove an existing b2b tag and wait for processing, then add it. Observe a processed tag event and exactly one pending welcome for the intended test profile. The worker needs to run to drain the webhook inbox even with sending disabled.
5. Check the duplicate-tag and tag-removal behavior before delivery. Test missing consent and suppression on disposable test profiles. Do not overwrite a real customer opt-out just to make a test pass.
6. Before an actual worker send, use a staging environment containing only approved test recipients, or explicitly review all due campaigns/messages and other enabled flows. MARKETING_TEST_EMAILS restricts the preview button only; it does NOT isolate the worker. Enabling global sending can release other pending email. Do not mark migration confirmed unless subscriber/suppression reconciliation has actually been completed.
7. In the isolated sending test, confirm exactly one real workflow email, correct personalization, working links/artwork/footer, provider delivery event, and no second send after another tag event. Use that workflow email to unsubscribe; verify the consent record and blocked later sends. Keep the normal pending-message snapshot behavior in mind when editing after enrollment.

## US compliance assessment

CAN-SPAM applies to B2B commercial email. Review accurate sender/subject information, clear commercial identification where required, a valid physical mailing address, and a working opt-out honored within 10 business days without fees or unnecessary hurdles. These are content and operational requirements, not something a unit test can certify. [FTC business guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)

For Gmail, verify authentication and applicable sender-volume requirements, plus working unsubscribe headers on actual marketing mail. A preview message has a different test purpose and intentionally does not claim a real subscription. Check the received workflow message and domain setup against [Google sender guidelines](https://support.google.com/mail/answer/81126?hl=en-GB).

Outstanding before sign-off: real sender domain/authentication, current customer consent evidence, valid organization/address, truthful current offer claims, Gmail rendering/delivery, and live unsubscribe/provider callbacks. Automated checks provide technical evidence; they do not establish overall legal compliance.

### Manual Shopify event processing

In Our Klaviyo → Settings → Delivery health, use **Process Shopify events now** to process up to 100 due inbox events without waiting for the scheduler. The action requires dashboard authentication and enabled ingestion. It refreshes profiles, consent, and flow enrollment but does not invoke email or SMS delivery. Keep general sending disabled during enrollment testing because the scheduled worker remains independent. The result reports completed and unresolved events; failed events and delayed retries still require the existing retry controls after resolving their cause. This processes received events, not a historical Shopify customer import.
