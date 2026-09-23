# ODD Feature: F10 Supplier Invoices and Basic Accounts Payable

## Objective
Expose the existing supplier-invoice/payable persistence through tenant-centralized API and Web workflows.

## Assumption
Accounts payable are administered centrally at tenant level. Existing persistence has no branch_id; this slice does not add branch ownership.

## Scope
- Create an invoice linked to an existing procurement receipt.
- List invoices with open/overdue balances.
- Preserve exact decimal amounts as strings.
- Add a basic Web invoice form and aging/list view.
- Keep payments, partial settlements, bank reconciliation, taxes, valuation, imports and exports out of scope.

## Acceptance criteria
- Authorized procurement users can create and list tenant-scoped supplier invoices.
- A receipt cannot be linked across tenants or duplicated under conflicting idempotency.
- Amounts and balances round-trip as exact decimal strings.
- Aging distinguishes open, paid/settled, and overdue records according to existing domain fields.
- Web UI exposes loading, empty, error and success states without inventing financial totals.
- Existing branch-scoped procurement and inventory behavior remains unchanged.

## Checklist
- [x] T1 — RED API tests for invoice creation, tenant isolation, receipt linkage, exact decimals, idempotency and aging. (Focused suite reached database connection boundary; tests cover list/status/idempotency behavior.)
- [x] T2 — GREEN API controller/service/contracts using existing persistence. (Added idempotent invoice creation, receipt/supplier validation, invoice aging list and receipt list endpoints.)
- [x] T3 — RED/GREEN Web client and invoice/aging view. (Added typed client methods and `/procurement/invoices` form/list with loading, empty, error and success states.)
- [x] T4 — Run focused API/Web verification and static checks. (TypeScript checks pass; runtime database test remains blocked by PostgreSQL unavailable.)
- [x] T5 — Commit the work unit on this feature branch.

## Route declaration
- Route: delegated direct implementation.
- Trigger evidence: API service/controller/contracts, tests, Web client/view and docs span multiple non-trivial files.
- Effective TDD: strict; RED -> GREEN -> REFACTOR.

## Verification plan
- `pnpm --filter @farmaxia/api test -- procurement.spec.ts`
- `pnpm --filter @farmaxia/api exec tsc --noEmit --project tsconfig.json`
- `pnpm --filter @farmaxia/api build`
- `pnpm --filter @farmaxia/web exec tsc --noEmit --project tsconfig.json`
- `pnpm --filter @farmaxia/web build`
- `git diff --check`

## Progress
- Status: authorized and started from `codex/f9-global-inventory-report` at `22334d0`.
- Accounting scope assumption: tenant-centralized, pending user correction if needed.
- Implementation: tenant-scoped supplier invoices reuse `idempotency_records`; no schema migration was required. Receipt linkage validates tenant and supplier before inserting the invoice/payable pair.
- Verification evidence: `pnpm --filter @farmaxia/api exec tsc --noEmit --project tsconfig.json` PASS; `pnpm --filter @farmaxia/web exec tsc --noEmit --project tsconfig.json` PASS; `pnpm --filter @farmaxia/api test -- procurement.spec.ts` BLOCKED at `ECONNREFUSED localhost:5433`.
- Commit: final work-unit commit is the HEAD recorded in git history for this task.
