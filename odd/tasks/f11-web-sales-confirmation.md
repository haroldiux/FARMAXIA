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

## Checklist
- [x] T1 — RED API/database tests for payment validation and exact decimal normalization; integration cases remain DB-gated.
- [x] T2 — GREEN API migration/service/controller/contracts using existing sales, cash and inventory patterns.
- [x] T3 — RED/GREEN Web client and sales confirmation workspace.
- [x] T4 — Run focused API/Web verification and static checks.
- [x] T5 — Commit one work unit on this feature branch.

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

## Progress
- Status: implemented and committed as a single work unit.
- Commit: this work-unit commit (`feat(sales): add non-fiscal cash sale confirmation`).
- Risks: PostgreSQL/Docker unavailable locally; migration application and FEFO/RLS integration require database verification.
- Next: parent runs review/commit orchestration and later repeats integration tests with PostgreSQL.
