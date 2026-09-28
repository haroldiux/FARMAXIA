# UX/UI Functional Workflows

## Objective
Audit and improve the UX/UI delivered on the `origin/Denil` implementation branch so the interface accurately exposes the completed FARMAXIA modules without inventing unsupported business behavior.

## Problem
The Denil branch contains substantial Core SaaS, identity, catalog, and inventory functionality plus a UI/UX commit, but the visual and interaction quality has not been independently verified against the implemented API contracts and functionality ledger.

## Why
The user requested a UX/UI specialist to validate the assigned work and continue the project from the downloaded GitHub advances.

## Scope
- Review the existing web screens and shared shell against `ESTADO_FUNCIONALIDADES.md`, `docs/api-contracts.md`, and the actual API contracts.
- Fix UX/UI inconsistencies, missing states, accessibility gaps, and misleading labels in the implemented modules 0–3 and current billing/account/platform flows.
- Do not implement new POS, SIAT, AGEMED, transfer, CRM, or analytics business logic in this task.
- Preserve existing local `.codegraph` runtime files in the original checkout; work in the isolated UX/UI worktree.

## Constraints
- Branch base: `origin/Denil` (`3574309`).
- Technical artifacts and code remain in English unless existing product copy requires otherwise.
- Strict TDD is enabled for implementation changes; use RED → GREEN → REFACTOR where behavior changes are introduced.
- Existing API behavior is the source of truth; UI must not claim unsupported functionality.

## Authorized scope
- Worktree: `C:\PROYECTOS\FARMAXIA-worktrees\ux-ui`
- Branch: `codex/ux-ui-farmaxia`
- Owned paths: `apps/web/**` plus narrowly related documentation under this feature only.
- No remote push, PR creation, or merge without a later user request.

## Tasks
- [x] UX-UI-01 — Audit current UI against implemented functionality and API contracts; produce a concise findings list with file references, severity, and recommended corrections.
- [x] UX-UI-02 — Implement the highest-impact UX/UI corrections from the audit within the owned paths, including loading, empty, error, disabled, responsive, and accessible interaction states where applicable.
- [x] UX-UI-03 — Verify the result with the relevant web build and focused checks, then record evidence and any remaining gaps.
- [x] UX-UI-04 — Complete the catalog product-detail read-only experience for `sales.confirm` without loading management resources or exposing mutations.

## Acceptance criteria
- Implemented modules 0–3 and existing account/billing/platform screens have a coherent navigation and visual hierarchy.
- UI labels and actions match available functionality and permissions; unsupported workflows are not presented as complete.
- Critical loading, empty, error, disabled, and mobile/responsive states are handled for changed screens.
- Accessibility basics are preserved: semantic controls, keyboard reachability, visible focus, and usable contrast.
- `pnpm --filter @farmaxia/web build` passes, or any environmental failure is reported with the exact command and evidence.
- API tests are not changed to hide failures; run `pnpm --filter @farmaxia/api test` when UI changes affect shared contracts or integration assumptions.

## Route and trigger evidence
- Route: delegated direct implementation.
- Trigger: UX/UI review and implementation span multiple non-trivial web files and requires broad repository context.
- Delegated role: UX/UI worker with an independent audit/check of the downloaded branch.

## Progress
- Base downloaded from GitHub and isolated in the UX/UI worktree.
- Task document created before source edits.
- UX-UI-01: documented the audit in `docs/ux-ui-functional-workflows-audit.md`.
- UX-UI-02: restored catalog read-only access for `sales.confirm`, removed inaccessible manage-only resources from that flow, corrected dashboard module hierarchy, and associated the global-inventory search label with its input.
- UX-UI-03: completed focused permission test, production web build, and attempted API contract tests.
- UX-UI-04: made product detail permission-aware. A sales-only session now loads only `GET products/:id`, receives a readable product/presentation view, and does not request categories/options or render product, presentation, or barcode mutations.

## Verification evidence
- RED: `node --experimental-strip-types --test apps/web/app/lib/catalog-access.test.ts` failed before implementation with `ERR_MODULE_NOT_FOUND` for `catalog-access.ts`.
- GREEN: the same command passed after implementation: 1 test passed, 0 failed. Node emitted a non-blocking module-type warning because `apps/web/package.json` has no `type: module` field.
- `pnpm --filter @farmaxia/web build` passed: Next.js compiled successfully, TypeScript completed, and all 28 routes generated.
- `pnpm --filter @farmaxia/api test` could not start because PostgreSQL was unavailable at `localhost:5433` (`ECONNREFUSED` for `::1:5433` and `127.0.0.1:5433`). No tests were changed or suppressed.
- `git diff --check` passed.
- Work-unit commit: `8506427a018707ca6fff184c047bb7976fe20d70` (`fix(web): align catalog access with permissions`).
- UX-UI-04 RED: the focused access test failed because `catalogDetailMode` was not exported.
- UX-UI-04 GREEN: `node --experimental-strip-types --test apps/web/app/lib/catalog-access.test.ts` passed: 2 tests passed, 0 failed.
- UX-UI-04: `pnpm --filter @farmaxia/web build` passed: compilation, TypeScript, and all 28 routes completed.
- UX-UI-04 work-unit commit: `9d0cec356b893029ad264f6d6b0cd053dc2c6af9` (`fix(web): protect catalog detail read-only mode`).

## Remaining gaps
- The platform shell still suppresses an operator-session lookup failure and can remain on a loading screen; see the minor audit finding. Fix it only with dedicated authentication-flow coverage.
- Browser-based keyboard, screen-reader, contrast, and responsive validation could not run because this isolated worktree has no configured authenticated API/database session. The production build and structural accessibility checks passed.

## Next step
Start PostgreSQL on port 5433 and rerun `pnpm --filter @farmaxia/api test`; then perform authenticated browser accessibility checks for catalog read-only product detail and dashboard navigation states.
