# ODD Feature: F5-WEB Receiving by Lot

## Objective

Expose the existing C02 receiving transaction through a protected API and a
responsive `/procurement/receiving` flow, so authorized operators can receive
ordered quantities into a selected warehouse by lot without duplicating stock.

## Problem

F4-WEB creates and lists purchase orders, while `ProcurementService.receive`
already performs transactional receiving in tests. There is no HTTP route or
Web form for entering lots, expiration dates, quantities, and receipt time.

## Why this slice

Receiving is the next bounded vertical after procurement setup. Keeping fiscal
invoices, supplier payables, sales, and transfer differences out preserves a
small rollback boundary and avoids inventing accounting policy.

## Authorized scope

- API `POST /api/v1/procurement/receipts` under `inventory.manage`.
- Web client and `/procurement/receiving` route linked from the procurement
  page, using existing session, warehouses, purchase orders, and presentations.
- One receipt form for a selected purchase order with repeatable lot lines,
  quantity/cost/date validation, idempotency, reload, and visible errors.
- PostgreSQL red/green coverage for scoped receipt endpoint behavior and replay.
- API/Web docs and implementation status updates.

## Out of scope

- Supplier invoices, payables, payment scheduling, costing policy, sales, and
  transfer workflows.
- New permissions; reuse `inventory.manage`.
- Remote operations or credentials.

## Acceptance criteria

- A valid receipt creates inventory exactly once and repeated same-key requests
  replay the original response.
- Received quantity cannot exceed or cumulatively exceed the purchase order.
- Lot code, expiration, quantity, and unit cost are validated before mutation.
- Tenant/sucursal RLS prevents receiving into another scope.
- `/procurement/receiving` loads only after an authorized session and keeps
  failed form values visible.
- API regression, Web/API typechecks/builds, Docker health, smoke HTTP, and
  `git diff --check` pass.

## Checklist

- [x] T1 — Red test for the receipt controller/service boundary and replay.
- [x] T2 — Add scoped receipt route and typed Web client contract.
- [x] T3 — Implement receiving page and procurement navigation link.
- [x] T4 — Run focused verification, update docs/status, and commit; no push performed (requires explicit authorization).

## Route declaration

- Route: delegated direct implementation.
- Mapping trigger: understanding spans API service/controller/module, tests,
  Web client/page/navigation, docs, and runtime configuration.
- Writer trigger: implementation changes two or more non-trivial files.
- Verification: delegated writer must run focused/full tests, typechecks/builds,
  Docker smoke, and report exact observed results.

## Delivery forecast

Estimated authored change size is medium (roughly 300–400 lines excluding
generated output). Keep one coherent work-unit commit unless the writer reports
the 400-line advisory boundary is exceeded.

## Progress

- Status: T1–T4 implemented; focused verification is green and the follow-up is committed locally.
- Evidence: controller-boundary coverage includes replay, partial/final status,
  and concurrent cumulative enforcement; API/Web production builds pass.
- RED: the focused procurement suite initially failed before test execution
  because PostgreSQL refused to truncate tables referenced by the new F6 cash
  shift foreign keys.
- GREEN: adding `cash_shift_users` and `cash_shifts` to the fixture truncation
  order made all 4 focused procurement tests pass. API/Web builds and Docker
  health smoke also pass (`/health` and `/` return 200).
- Follow-up work-unit commit: this commit (`test(procurement): restore F5 fixture isolation`).
- Previous boundary: `e330523 feat(web): add procurement workspace`.
- Implementation work unit: `feat(procurement): add receiving by lot`.

## Confirmed policy

- The user confirmed partial receiving with `PARTIALLY_RECEIVED` status.
- An order becomes `RECEIVED` only when every ordered line is fully received.
- The receive transaction must lock the order while checking cumulative
  quantities, preventing concurrent over-receipt.

## Decision gate

The current C02 transaction permits partial receipts but marks the purchase
order `RECEIVED`; it also permits later receipts and has no row lock around the
cumulative quantity check. The UI and acceptance contract need one explicit
business rule before source changes proceed.

- Decision gate: resolved by the user; proceed with partial receiving.
