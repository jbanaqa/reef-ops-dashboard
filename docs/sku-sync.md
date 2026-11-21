# SKU Sync

Open **Inventory & demand → SKU sync** in Reef Ops. Each row shows the two posted variants and their actual SKUs. Choose **Use Corals Anonymous SKU** or **Use Macroalgae Farms SKU**, review the destination/old/new values, and confirm. Only the opposite store's SKU is updated. Choosing an empty SKU explicitly clears the destination SKU.

## Automatic behavior

The existing Railway `scheduled:all` runner now checks SKU Sync on each cron tick (currently every five minutes). It does not need an open browser. No Cloudflare code, inventory quantities, descriptions, prices, or marketing settings are changed.

- Cloudflare's complete mapping list is read fresh each check. New mappings appear automatically; no export or manual rebuilding is needed.
- Both stores are read by variant ID, not SKU. New, remapped, or reactivated pairs save their current SKUs as independent baselines without overwriting either store.
- A subsequently observed SKU change on one side is copied to the other. Exact strings, including case, spaces and an intentional clear, are preserved.
- Both sides changing to the same SKU settles without a write. Different changes on both sides require a manual choice; no arbitrary winner is picked.
- Inactive/removed mappings do not sync. Ambiguous mappings that reuse either variant are blocked until corrected in Cloudflare.
- **Last automatic check** reports when the background job last completed a check. **Refresh** only reloads the comparison; it does not move that time or write a SKU to Shopify.
- **Needs attention** marks a pair whose update failed or was not confirmed. Refresh does not dismiss this note while the attempt is unresolved and the two SKUs still differ.

Polling observes values at each check; it is not a real-time webhook stream and cannot reconstruct edits changed back between checks. A mapping is not monitored until its first successful baseline check.

## Reliability

A PostgreSQL lease serializes scheduled checks and manual choices across web/cron processes. Fresh pair identity and both SKUs must still match a manual confirmation. Pending intent is stored before a Shopify write; baselines advance only after both stores are read back and agree. An uncertain timeout is checked again without blindly resending. If Shopify still has the old value, staff may explicitly retry the same chosen SKU. A different choice is held while an earlier outcome remains uncertain.

There is no atomic transaction spanning two independent Shopify stores. A user editing Shopify between a fresh read and the API write can still race the operation; read-back detects discrepancies for review. Failed/missing variants never become empty SKUs and never silently clear the other store.

## Deployment

1. Push these changes and deploy **reef-ops-dashboard first**, allowing its existing startup command to apply `20261120120000_sku_sync`.
2. Deploy **Collection Rotation Cron** to the same commit. Its command remains `npm run scheduled:all` and its schedule stays unchanged. To try manual edits first, set `SKU_SYNC_ENABLED=false` on the cron service until ready to start automatic checks. Do not run the whole command manually as a test: it also services existing marketing jobs.
3. Both services need the existing `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SPECIES_LIBRARY_SHOP_DOMAIN`, `MACROALGAE_SHOPIFY_CLIENT_ID`, and `MACROALGAE_SHOPIFY_CLIENT_SECRET`. Both Shopify apps need `read_products` and `write_products`. No Cloudflare API credentials are required.
4. Default read-only mapping source: `https://shopify-inventory-sync.jadenbanawa.workers.dev/admin/mappings`. Optional `SKU_SYNC_MAPPINGS_URL` may point to another trusted HTTPS feed with the same schema. Keep mapping edits staff-only: the feed determines which pairs can sync.
5. SKU Sync follows the existing dashboard access setting without a separate login. When Reef Ops is public (`DASHBOARD_AUTH_DISABLED=true`), anyone who can open it can see and edit mapped SKUs. The browser's public origin can be taken from `REEF_OPS_PUBLIC_URL`, `APP_BASE_URL`, or Railway's public domain when Next reports an internal URL instead.
6. First check establishes baselines only. Existing differences remain visible for the team to resolve. Do not claim live operation before deploying and checking both services.

Emergency pause: set `SKU_SYNC_ENABLED=false` on the cron service. This does not change access to manual choices. Restoring automatic checks preserves prior baselines, so observed edits made while paused may sync on the next check.

## Local verification

`npm run sku-sync:test` uses disposable PGlite and mocked providers, never production Shopify/Cloudflare/database access. The UI browser fixture likewise mocks its API. Production SKU edits and the combined scheduled job are not test steps.
