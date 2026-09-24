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

## Progress
- Status: T1-T6 implemented; the exact focused Vitest invocation is blocked by the pre-existing test allowlist, while the isolated guard run and static checks pass.
- Commit: prior work-unit commit `8179a29` (`feat(sales): add non-fiscal cash sale confirmation`); T6 work-unit commit `4103d33` (`fix(auth): allow sales read access for confirmation workspace`).
- Risks: PostgreSQL/Docker unavailable locally; migration application and FEFO/RLS integration require database verification. The repository Vitest allowlist still needs a separately authorized config update before the exact focused command can pass.
- Next: later repeat integration tests with PostgreSQL and separately authorize adding the guard spec to `apps/api/vitest.config.ts` if the exact command must run unchanged.
