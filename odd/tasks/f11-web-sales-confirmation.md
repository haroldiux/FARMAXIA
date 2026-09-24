# ODD Feature: F11 Non-Fiscal Cash Sales Confirmation

## Objective
Provide a bounded sales/POS confirmation workflow for cash-only, non-fiscal sales using FEFO inventory consumption and existing cash-shift controls.

## Scope
- Confirm a sale with one or more existing product presentations.
- Require an OPEN cash shift for the authenticated user/cashier.
- Accept CASH payment only in this slice.
- Allocate and consume inventory through the existing FEFO path.
- Preserve exact decimal strings for prices, totals and payment amounts.
- Apply idempotency, audit and outbox behavior through existing transversal services.
- Add a typed Web sales workspace with loading, empty, error and success states.

## Out of scope
- SIAT/fiscal documents or external fiscal providers.
- Quotes, commercial reservations, returns, discounts or promotions.
- Card/QR/payment gateway reconciliation.
- Final costing, taxes, currency conversion or accounting settlement.

## Acceptance criteria
- An authorized user can confirm a cash sale only while their cash shift is OPEN.
- Cross-tenant and cross-branch product/presentation access is rejected.
- FEFO allocation consumes only available stock and fails atomically when insufficient.
- Replaying the same idempotency key returns the original result; conflicting payloads fail deterministically.
- Sale, items, payment, inventory consumption, audit and outbox effects are transactional.
- Exact decimal values round-trip as strings without floating-point coercion.
- Web flow exposes clear loading, empty, error and success states and does not invent financial totals.
- The `/sales` read-only dependencies allow `sales.confirm` to read cash shifts, dispatch warehouses and sellable catalog data without granting management permissions; their mutating endpoints remain management-protected.

## Checklist
- [x] T1 — RED API/database tests for payment validation and exact decimal normalization; integration cases remain DB-gated.
- [x] T2 — GREEN API migration/service/controller/contracts using existing sales, cash and inventory patterns.
- [x] T3 — RED/GREEN Web client and sales confirmation workspace.
- [x] T4 — Run focused API/Web verification and static checks.
- [x] T5 — Commit one work unit on this feature branch.
- [x] T6 — Add and verify the read-only permission contract: RED/GREEN/REFACTOR coverage for `RequirePermissions` all-of and `RequireAnyPermission` any-of, then apply the any-of metadata only to the cash shifts, inventory warehouses and catalog products GET routes. The focused assertions pass with an isolated include override; the exact repository command remains blocked by the pre-existing Vitest allowlist.
- [x] T7 — Register exactly `test/permissions.guard.spec.ts` in the API Vitest include allowlist; verify with `pnpm --filter @farmaxia/api exec vitest run --config vitest.config.ts test/permissions.guard.spec.ts` (PASS: 1 file, 3 tests).
- [x] T8 — Complete the Web `/sales` loading/empty/error/success UX by deriving available cash shifts, dispatch warehouses and sellable presentations after loading; keep the form hidden when any required collection is empty, show actionable missing-requirement guidance, preserve the dashboard navigation, and run the requested Web checks.
- [x] T9 — Expand pure unit coverage for `normalizeSaleInput` with CASH normalization, trimmed identifiers, exact decimal-string preservation, invalid decimal rejection, invalid quantity rejection, and empty-line rejection; do not change production service behavior or add database integration.
- [x] T10 — Correct the PostgreSQL 42830 migration blocker by adding `warehouses_tenant_branch_id_unique` before the sales warehouse three-column FK, mirror it in Drizzle, preserve the FK, and do not edit migration metadata or snapshots.

## Route declaration
- Route: delegated direct implementation.
- Trigger evidence: new sales persistence/service/controller, inventory/cash integration, tests, Web UI and docs span multiple non-trivial files.
- Effective TDD: strict; RED -> GREEN -> REFACTOR.

## Verification plan and observed evidence
- `pnpm --filter @farmaxia/api exec vitest run --config vitest.config.ts test/sales.spec.ts`: PASS (1 test).
- `pnpm --filter @farmaxia/api exec vitest run --config vitest.config.ts test/sales.spec.ts test/cash.spec.ts test/inventory.spec.ts`: sales PASS; cash/inventory integration setup blocked by `ECONNREFUSED localhost:5433`.
- `pnpm --filter @farmaxia/api exec tsc --noEmit --project tsconfig.json`: PASS.
- `pnpm --filter @farmaxia/api build`: PASS.
- `pnpm --filter @farmaxia/web exec tsc --noEmit --project tsconfig.json`: PASS.
- `pnpm --filter @farmaxia/web build`: PASS (`/sales` generated).
- `DATABASE_URL=postgresql://... pnpm --filter @farmaxia/api exec drizzle-kit check`: PASS (`Everything's fine`).
- `git diff --check`: PASS.
- `pnpm --filter @farmaxia/api exec vitest run --config vitest.config.ts test/permissions.guard.spec.ts`: BLOCKED — Vitest exits 1 with `No test files found` because `apps/api/vitest.config.ts` has an explicit include list that does not contain the new spec; config ownership was outside T6.
- Focused Vitest run with an isolated temporary config including only `test/permissions.guard.spec.ts`: PASS (3/3).
- `pnpm --filter @farmaxia/api exec tsc --noEmit --project tsconfig.json`: PASS.
- `git diff --check`: PASS.
- T7 focused check: `pnpm --filter @farmaxia/api exec vitest run --config vitest.config.ts test/permissions.guard.spec.ts`: PASS (exit code 0; 1 file, 3 tests).
- T7 TypeScript check: `pnpm --filter @farmaxia/api exec tsc --noEmit --project tsconfig.json`: PASS (exit code 0).
- T7 diff check: `git diff --check`: PASS (exit code 0; LF-to-CRLF warnings only).
- T8 TypeScript check: `pnpm --filter @farmaxia/web exec tsc --noEmit --project tsconfig.json`: PASS (exit code 0).
- T8 production build: `pnpm --filter @farmaxia/web build`: PASS (exit code 0; Next.js generated 12 static pages).
- T8 diff check: `git diff --check`: PASS (exit code 0; CRLF warnings only, including pre-existing `.codegraph` runtime files).
- T8 test gap: `apps/web/package.json` has no `test` script; no Web test command was available or invented.
- T9 focused unit test: `pnpm --filter @farmaxia/api exec vitest run --config vitest.config.ts test/sales.spec.ts`: PASS (exit code 0; 1 file, 11 tests).
- T9 TypeScript check: `pnpm --filter @farmaxia/api exec tsc --noEmit --project tsconfig.json`: PASS (exit code 0).
- T9 diff check: `git diff --check`: PASS (exit code 0; LF-to-CRLF warnings for the changed files and pre-existing `.codegraph` runtime files).
- T10 supplied RED evidence: `db:migrate` failed in migration `0014_f11_cash_sales.sql` with PostgreSQL SQLSTATE 42830 because the sales warehouse three-column FK had no matching unique constraint on `warehouses`; no new RED run is authorized.
- T10 required checks: `pnpm --filter @farmaxia/api run db:migrate`; `pnpm --filter @farmaxia/api exec drizzle-kit check`; the requested Vitest suites; API TypeScript; and `git diff --check`, with no manual edits to `apps/api/drizzle/meta/_journal.json` or snapshots.
- T10 foreground verification: `db:migrate` BLOCKED before migration execution because `DATABASE_URL is required to run Drizzle migrations` (exit code 1); `drizzle-kit check` BLOCKED by the same missing environment variable (exit code 1), so migration state is not claimed as migrated. The combined sales/cash/inventory/procurement suite had 11 passed and 23 failed, with exact PostgreSQL `cannot truncate a table referenced in a foreign key constraint` failures in `test/cash.spec.ts:61`, `test/inventory.spec.ts:51`, and `test/procurement.spec.ts:54` (exit code 1); `inventory-report.spec.ts` had 2 failed with the same truncate/FK error at `test/inventory-report.spec.ts:52` (exit code 1). API TypeScript passed (exit code 0); `git diff --check` passed (exit code 0; LF-to-CRLF warnings only).

## Progress
- Status: T1-T9 implemented in scope; the Web sales workspace now blocks incomplete forms and explains each missing requirement with dashboard navigation, and `normalizeSaleInput` has focused pure-unit coverage for valid CASH normalization and invalid input boundaries. No production service behavior or database integration was changed.
- T10 initial progress: authorized minimal correction identified; next write is limited to the task ledger merge followed by the two requested source changes, with the supplied 42830 RED evidence retained and no new RED run planned.
- T10 completion: added the warehouse composite unique constraint in migration 0014 immediately before the preserved sales warehouse FK and mirrored it in `schema.ts`. The requested foreground checks were run without hiding failures; database migration was not claimed because the command stopped on missing `DATABASE_URL`, and the database-backed suites exposed the exact independent truncate/FK setup failures above. No new RED run was performed.
- Commit: prior work-unit commit `8179a29` (`feat(sales): add non-fiscal cash sale confirmation`); T6 work-unit commit `4103d33` (`fix(auth): allow sales read access for confirmation workspace`); documentation commit `1b3c48a` (`docs(odd): record F11 permission work unit`).
- T7 commit: `4c59991` (`test(api): register permission guard suite`).
- T8 commit: `bec6e82` (`feat(web): complete sales empty states`).
- T9 commit: `b6e84d3` (`test(api): cover sales input normalization`).
- Risks: PostgreSQL/Docker unavailable locally; migration application and FEFO/RLS integration remain blocked and require database verification. T9 is intentionally pure unit coverage only and does not reduce the PostgreSQL/Docker integration block. T8 has no Web test script available, so confidence comes from TypeScript, production build, diff validation, and code inspection.
- Next: later repeat integration tests with PostgreSQL.
