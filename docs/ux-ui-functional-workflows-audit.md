# UX/UI Functional Workflows Audit

**Scope:** current web UI on `codex/ux-ui-farmaxia` against `ESTADO_FUNCIONALIDADES.md`, `docs/api-contracts.md`, and the implemented API routes.

## Findings

| Severity | Evidence | Finding | Recommended correction |
| --- | --- | --- | --- |
| Critical | `apps/web/app/components/dashboard-shell.tsx:22,119`; `apps/web/app/catalog/page.tsx:53-66`; `apps/api/src/catalog/catalog.controller.ts:77-129,152-154` | A session with `sales.confirm` is authorized to read catalog products, but the dashboard hides Catalog and the catalog bootstrap requests categories and price lists that require `catalog.manage`. A rejection leaves `products` unset and the page renders nothing. The visible barcode lookup also calls a manage-only endpoint. | Expose Catalog to either supported permission; load and render read-only catalog data independently of manage-only resources; provide an explicit denied/error state; hide manage-only controls from read-only sessions. |
| Major | `apps/web/app/components/dashboard-shell.tsx:153-175`; `ESTADO_FUNCIONALIDADES.md` modules 2 and 3 | The dashboard says Catalog is the “next” view and Inventory comes “after”, although both are implemented and represented in primary navigation. This makes the information hierarchy misleading. | Replace roadmap copy with permission-aware links to implemented modules and keep unavailable modules out of the claim. |
| Major | `apps/web/app/inventory/report/page.tsx:63-65` | The report search field is preceded by a non-associated `span`, so assistive technology has no programmatic label for the input. | Use an associated `label` and input `id`; retain the existing visual layout. |
| Minor | `apps/web/app/components/platform-shell.tsx:24-31` | A failed operator-session check is ignored, leaving an indefinite loading screen rather than a recoverable error or sign-in route. | Route an unauthenticated operator to `/platform/login` and show an explicit failure state for other errors in a future, separately tested change. |

## Implemented in this task

The first three findings are high-confidence, contained in `apps/web/**`, and do not require new business workflows. The platform-session recovery finding remains deferred because it changes the operator authentication flow and needs dedicated UI coverage.

## Verification scope

- Behavior: focused node test for catalog permission access.
- Structure and accessibility: web production build and a source-level audit of the associated form label.
- Browser testing: not run; the isolated worktree has no configured running API/database session for authenticated flows.