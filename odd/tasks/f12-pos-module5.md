# ODD Feature: F12 Module 5 — Complete POS and Cash

## Objective
Turn the cash-only POS into a counter-ready point of sale: multiple payment methods, fast search and barcode scanning, sales history and printable receipts, cash movements, voids and returns, authorized FEFO lot override and quotes (proformas).

## Problem / why
Today `/sales` only confirms non-fiscal CASH sales and `/cash` only manages shifts. A real pharmacy counter cannot operate without card/QR payments, a receipt, a way to void mistakes, petty-cash movements and sales lookup.

## Scope
- Payments: CASH, CARD, QR, and mixed payments per sale; change calculation for cash. Card/QR are recorded with a manual reference (no gateway).
- Sales history: list with filters (date, shift, cashier, status) and sale detail.
- Non-fiscal receipt: printable template for 58 mm / 80 mm thermal paper via browser print.
- POS UX: product search by name/generic/barcode, barcode-scanner input, keyboard shortcuts, touch-friendly buttons.
- Cash movements: manual cash in/out during an OPEN shift with reason; included in the expected cash at close.
- Voids (full sale) and returns (partial lines): restore stock to the original batches, refund through cash movements/payments, audited, permission-protected.
- Authorized lot override: choose a specific batch instead of FEFO with a dedicated permission and a reason.
- Quotes (proformas): create, print, expire and convert to sale; no stock reservation.

## Out of scope (depends on other modules)
- CREDIT and agreement (convenio) payments — need customers/agreements (module 10).
- Requiring a prescription for controlled medicines — needs module 8 (D13/D34).
- Fiscal invoice (SIAT) — module 6 (D03).

## Provisional decisions (to review with the teacher at the end)
Each one is recorded as pending in `REGISTRO_DECISIONES.md` and is reversible.
- D43 (D14) Card/QR: recorded manually with reference; no gateway or reconciliation.
- D44 (D17) Receipt: browser-print HTML template 58/80 mm, non-fiscal, no direct printer driver.
- D45 Sales visibility: `sales.read`; branch-wide only with `cash.shift.approve` or `catalog.manage`, otherwise own sales.
- D46 (D18) Voids only for sales of the current OPEN shift; returns allowed later; stock returns to the original batch; permission `sales.void`.
- D47 Lot override: permission `sales.fefo.override` + mandatory reason, audited.
- D48 (D09) Quotes: no stock reservation, valid 7 days by default, price re-evaluated on conversion.
- D49 Cash movements: permission `cash.manage`; withdrawals cannot exceed expected cash.

## Constraints
- Branch `Denil`; no new branches; leave changes uncommitted (the user commits manually).
- Exact decimal strings for money; never `number`.
- Reuse existing tenancy/RLS, idempotency, audit and outbox services.
- Artifacts (code, comments, identifiers) in English; UI copy in Spanish as the existing app does.
- ~400 changed lines per task is an advisory heuristic only.

## TDD
- Mode: strict (source: user global config `Strict TDD Mode: enabled`).
- Runner: `pnpm --filter @farmaxia/api exec vitest run --config vitest.config.ts <spec>` (PostgreSQL on localhost:5433 via `docker compose up -d postgres redis`); new specs must be added to the `include` list in `apps/api/vitest.config.ts`.
- Web checks: `pnpm --filter @farmaxia/web exec tsc --noEmit --project tsconfig.json` and `pnpm --filter @farmaxia/web build`.

## Checklist
- [x] T1 — Multiple payment methods (CASH/CARD/QR, mixed, change) in API + `/sales` UI.
- [x] T2 — Sales history and sale detail (API + `/sales/history` UI) and printable 58/80 mm receipt.
- [x] T3 — POS UX: search, barcode-scanner input, keyboard shortcuts, touch-friendly layout.
- [x] T4 — Cash movements (in/out) in OPEN shifts, included in shift close expected cash; UI in `/cash`.
- [x] T5 — Voids and partial returns with stock restoration and refunds; permission `sales.void`.
- [x] T6 — Authorized FEFO lot override with `sales.fefo.override` and reason.
- [x] T7 — Quotes (proformas): create, print, expire, convert to sale.
- [x] T8 — Update `ESTADO_FUNCIONALIDADES.md`, `REGISTRO_DECISIONES.md` and `docs/api-contracts.md`; full API test run and Web build.

## Route declaration
- Route per task: delegated direct (one writer per task, sequential). Trigger evidence: each task spans migration + service + controller + tests + Web page (2+ non-trivial files).

## Acceptance criteria
- Every API change has failing-then-passing tests in the PostgreSQL suite.
- Tenant/branch isolation preserved; new permissions seeded into role templates.
- `ESTADO_FUNCIONALIDADES.md` reflects each finished item.

## Progress and evidence
(updated after each task)
- T1 (delegated): migration `0020_sale_payment_methods.sql`; payments[] CASH/CARD/QR with change; legacy shape kept. RED 14 failed -> GREEN; `pnpm --filter @farmaxia/api test` 22 files/144 tests PASS; API+Web tsc PASS; web build PASS. Parent spot check sales specs 27/27 PASS. ESTADO_FUNCIONALIDADES + D43 updated. Uncommitted (user commits).

- T2 (delegated): migration `0021_sales_history.sql` (sale_number V-<branch>-000001, `sales.read`, RLS split: branch-wide SELECT, creator-only writes); GET /sales, GET /sales/:id; `/sales/history`, `/sales/[saleId]` receipt 58/80 mm; `sales-nav.tsx`. RED 8/8 -> GREEN; full API 23 files/152 PASS (one flaky outbox failure in an earlier run, passed alone and on re-run); API/Web tsc PASS; web build PASS. Follow-up: dashboard summary restricted to own sales for cashiers. Dev DB `farmaxia` needs migrations 0020-0021 (API applies on start).
- T3 (delegated): `GET /api/v1/sales/lookup` (search + exact barcode, branch price, available stock); `/sales` counter screen (scanner, F2/F4/F9/Esc, touch, `lib/pos-cart.ts`). Security follow-up: confirm now resolves price server-side (409 PRICE_CHANGED / PRICE_NOT_FOUND). RED 7/7 lookup; price RED via bypass 2/3. Full API 24 files/163 PASS; API/Web tsc PASS; web build PASS. Parent spot check sales-confirm PASS. Not browser-tested.
- T4 (delegated): migration `0022_cash_movements.sql` (immutable, RLS); POST/GET /cash/shifts/:id/movements; breakdown in shift control; `/cash` movements panel. RED 7/7 -> GREEN; full API 25 files/170 PASS; API/Web tsc PASS; web build PASS. Parent spot check cash-movements PASS. Not browser-tested.
- T5 (delegated): migration `0023_sale_voids_returns.sql` (void columns, immutable returns tables, guarded sales UPDATE policy, `sales.void`); POST /sales/:id/void, /sales/:id/returns; `sale-actions.tsx`. Status name kept `CONFIRMED`. RED 14/14 -> GREEN; full API 26 files/184 PASS; API/Web tsc PASS; web build PASS. Parent spot check sales-returns PASS. Not browser-tested.
- T6 (delegated): migration `0024_fefo_override.sql`; confirm `lines[].batchId` + `overrideReason`; GET /sales/lookup/batches; `sales-fefo.ts`; web "Cambiar lote". RED 11/11 -> GREEN; full API 27 files/195 PASS; API/Web tsc PASS; web build PASS. Parent spot check PASS. Not browser-tested.
- T7 (delegated): migration `0025_sales_quotes.sql`; quotes endpoints + confirm `quoteId`; `/sales/quotes`, `/sales/quotes/[quoteId]`, Proformas tab. RED 16/16 -> GREEN; full API 28 files/211 PASS; API/Web tsc PASS; web build PASS. Parent spot check PASS. Gap: no test for cross-branch conversion via confirm.
- T8 (inline): ESTADO_FUNCIONALIDADES (module 5 14/16 done, ~65%), REGISTRO D43-D49, api-contracts (by writers). Parent full run: `pnpm --filter @farmaxia/api test` 28 files/211 PASS; API tsc PASS; web build PASS (/sales, /sales/history, /sales/[saleId], /sales/quotes, /sales/quotes/[quoteId], /cash); `git diff --check` PASS. Browser smoke pending (user will test on localhost).

## Next step
Feature complete. Remaining module-5 items depend on module 10 (credit/agreements) and module 8 (prescriptions).
