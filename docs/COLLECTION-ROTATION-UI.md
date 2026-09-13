# Collection rotation interface

## Design rationale

The interface separates three tasks that previously competed on one long page:

- **Collections:** find and select collections, edit fixed positions, rotate, review history, and undo.
- **Strategy & preview:** choose a ranking method, tune weights, reuse presets, and inspect the proposed order before applying it.
- **Automatic rotation:** inspect the schedule and manage its collection set.

Shopify Polaris resource-list guidance informed the search/filter/sort grouping: https://polaris-site-prod-kit.shopify.prod.shopifyapps.com/components/selection-and-input/index-filters

Algolia merchandising guidance informed the separation of rules and preview from application: https://www.algolia.com/doc/guides/managing-results/rules/merchandising-and-promoting

Overview counts, progressive disclosure for help and reusable presets, explicit fixed-position labels, and a persistent desktop selection action bar reduce the amount users must interpret at once. Styles are scoped to this workspace and use the existing theme variables. Narrow screens keep table overflow inside its container.

## Behavior boundaries

The existing components stay mounted when switching views, preserving search, selections, strategy drafts, and preview seeds. Existing action handlers, requests, confirmation prompts, ranking logic, scheduling, history, and undo remain unchanged. No API, database, or scheduler files were modified.

## Verification — September 13, 2026

- `npm run build:check` passed, including TypeScript and production compilation.
- Local browser checks covered all three views, search retention across view changes, disabled rotate action without selections, empty/error state, light/dark rendering, and a 390px viewport without document horizontal overflow.
- The local environment did not return collection data. Populated collection rows, live previews, and mutation outcomes were not exercised. No live rotation, save, or schedule change was triggered during verification.

## Review on the deployed site

Verify populated collection rows and fixed-position/history dialogs. Select a collection, change views, and confirm selection remains. Confirm the preview and automation management controls are reachable. Applying a rotation still changes Shopify and should only be done when intended.
