# Collection rotation redesign

Updated September 13, 2026. This replaces the initial three-view reorganization.

## User workflow

The home screen is a collection library. Each card shows product count, favorite status, automation membership, current ranking strategy, fixed-position counts, last run and error, and direct edit/preview, history and undo actions.

Select one card to rotate it using its saved strategy. Strategy editing for one collection lives only on that collection's card. When two or more cards are selected, **Set same strategy** becomes available as an explicit bulk assignment action. The bulk editor identifies all target collections, offers built-in strategies and custom weights, loads reusable presets, validates the 100% total, and can save a reusable mix without navigating elsewhere. It reports partial failures without hiding which collections failed.

Editing a collection opens a focused drawer locked to that collection. The ranked preview shows proposed/previous positions, factors and expandable explanations. Top-12/all-products views and search/pagination remain. Schedule management has its own drawer containing only schedule and membership controls.

## References

- Shopify select-then-act bulk workflow: https://help.shopify.com/en/manual/shopify-admin/productivity-tools/bulk-actions
- Algolia collection-focused merchandising: https://www.algolia.com/doc/integration/shopify/going-further/merchandising-tool

## Behavior preserved

No API, database, scoring, scheduler, shuffle or undo implementation changed. Bulk assignment uses the existing strategy/bulk endpoint. The existing confirmation for rotations and undo remains. Assigning a strategy saves settings without rotating products. Preview seeds are cleared after bulk assignment so stale previews cannot be applied. The collection editor remains mounted when dismissed, retaining its draft and preview. Presets refresh when reopened.

Native dialogs provide focus containment, Escape dismissal and focus restoration. The library selection remains in place underneath drawers. Styles are scoped to collection rotation and use the existing light/dark theme.

## Verification

- Production build and TypeScript pass via npm run build:check.
- Isolated populated fixture: node scripts/collection-rotation.preview.cjs (http://127.0.0.1:3019). All fetches are intercepted; the fixture cannot send API requests to production.
- Browser checks: selecting Torch Corals and New Arrivals, direct bulk entry, invalid totals disabling Apply, saved-preset weights sent to exactly those two targets, success feedback, collection-specific editor context, ranked preview rendering and automation membership visibility without bulk-ranking controls.
- Tested at 390px and 1440px: no document or custom-editor horizontal overflow. Populated library reviewed visually in light theme; production dark theme uses the same existing variables.
- Live merchandising actions were not run. Fixture verification covers UI wiring, not Shopify mutation outcomes.
