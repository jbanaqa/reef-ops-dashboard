# SKU Sync

Open **Inventory & demand → SKU sync** in Reef Ops. Each row shows the two posted variants and their actual SKUs. Choose **Use Corals Anonymous SKU** or **Use Macroalgae Farms SKU**, review the destination/old/new values, and confirm. Only the opposite store's SKU is updated. Choosing an empty SKU explicitly clears the destination SKU.

## Automatic behavior

Saving a mapped variant's SKU in either Shopify store can trigger a check immediately via an `inventory_items/update` webhook. Reef Ops verifies Shopify's signature, queues a unique delivery, and reads both live SKUs before deciding whether to write. It does not use the webhook's SKU value. The Railway `scheduled:all` runner continues to check all mappings every five minutes as a fallback and retries queued notifications when time permits. No browser needs to stay open. No Cloudflare code, inventory quantities, descriptions, prices, or marketing settings are changed.

- Cloudflare's complete mapping list is read fresh each check. New mappings appear automatically; no export or manual rebuilding is needed.
- Both stores are read by variant ID, not SKU. New, remapped, or reactivated pairs save their current SKUs as independent baselines without overwriting either store.
- A subsequently observed SKU change on one side is copied to the other. Exact strings, including case, spaces and an intentional clear, are preserved.
- Both sides changing to the same SKU settles without a write. Different changes on both sides require a manual choice; no arbitrary winner is picked.
- Inactive/removed mappings do not sync. Ambiguous mappings that reuse either variant are blocked until corrected in Cloudflare.
- **Last automatic check** reports when the scheduled full check last completed. It does not move on an individual notification. **Refresh** reloads the comparison without writing a SKU to Shopify.
- **Needs attention** marks a pair whose update failed or was not confirmed. Refresh does not dismiss this note while the attempt is unresolved and the two SKUs still differ.

Shopify notification delivery is asynchronous; a delayed notification or busy worker may leave the next scheduled check to pick up the edit. A new mapping gets the fast path once Reef Ops has observed and indexed both variants. Neither path reconstructs intermediate SKU values edited and then changed back before a check.

## Reliability

A PostgreSQL lease serializes individual notifications, scheduled checks, and manual choices across web/cron processes. Fresh pair identity and both SKUs must still match a manual confirmation. Pending intent is stored before a Shopify write; baselines advance only after both stores are read back and agree. Echo notifications from a Reef Ops write are safe no-ops once both stores agree. An uncertain timeout is checked again without blindly resending. If Shopify still has the old value, staff may explicitly retry the same chosen SKU. A different choice is held while an earlier outcome remains uncertain.

There is no atomic transaction spanning two independent Shopify stores. A user editing Shopify between a fresh read and the API write can still race the operation; read-back detects discrepancies for review. Failed/missing variants never become empty SKUs and never silently clear the other store.

## Deployment

1. Deploy **reef-ops-dashboard**, letting its existing migration command add the SKU tables and inventory-item indexes.
2. Deploy **Collection Rotation Cron** to the same commit. Its command remains `npm run scheduled:all` and its schedule stays unchanged. Wait for a scheduled check to index the existing pairs. Do not run the whole command manually as a test: it also services existing marketing jobs.
3. Both services need the existing `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SPECIES_LIBRARY_SHOP_DOMAIN`, `MACROALGAE_SHOPIFY_CLIENT_ID`, and `MACROALGAE_SHOPIFY_CLIENT_SECRET`. Both Shopify apps need `read_products` and `write_products`. No Cloudflare API credentials are required.
4. Default read-only mapping source: `https://shopify-inventory-sync.jadenbanawa.workers.dev/admin/mappings`. Optional `SKU_SYNC_MAPPINGS_URL` may point to another trusted HTTPS feed with the same schema. Keep mapping edits staff-only: the feed determines which pairs can sync.
5. SKU Sync follows the existing dashboard access setting without a separate login. When Reef Ops is public (`DASHBOARD_AUTH_DISABLED=true`), anyone who can open it can see and edit mapped SKUs. The browser's public origin can be taken from `REEF_OPS_PUBLIC_URL`, `APP_BASE_URL`, or Railway's public domain when Next reports an internal URL instead.
6. First check establishes baselines only. Existing differences remain visible for the team to resolve. Do not claim live operation before deploying and checking both services.
7. From the deployed web service, run `node --import tsx scripts/register-sku-sync-webhooks.ts --origin https://reef-ops-dashboard-production.up.railway.app --check`. After confirming both canonical shops and the deployed callback, rerun with `--apply`, then `--check` to verify. Use the dashboard's main Railway hostname, not the email unsubscribe domain. The script registers only this callback and leaves unrelated subscriptions alone.

Emergency pause: set `SKU_SYNC_ENABLED=false` on **both** the cron and web services. This does not change access to manual choices. Restoring automatic checks preserves prior baselines, so observed edits made while paused may sync on the next check.

## Local verification

`npm run sku-sync:test` uses disposable PGlite and mocked providers, never production Shopify/Cloudflare/database access. The UI browser fixture likewise mocks its API. Production SKU edits and the combined scheduled job are not test steps.
