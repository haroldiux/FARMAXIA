# ODD Feature: F9 Tenant-Wide Inventory Report

## Objective

Provide a read-only tenant-wide inventory report that aggregates physical,
reserved, and available quantities across every branch and warehouse, with
hierarchical rows and subtotals for operational visibility.

## Problem

The existing inventory endpoints are intentionally scoped to the active
branch and protected by `inventory.manage`. Authorized global users need a
cross-branch view without weakening ordinary branch isolation or mutation
permissions.

## Why this slice

Cross-branch visibility is a separate privilege boundary from inventory
administration. A focused report enables oversight while preserving the current
FEFO, reservation, reconciliation, and branch-scoped mutation behavior.

## Confirmed policy

- Report rows are hierarchical: branch → warehouse → product → presentation.
- The response includes branch subtotals and one tenant total.
- The report is read-only and protected by dedicated `inventory.report.global`.
- Quantities are `physical`, `reserved`, and `available = physical - reserved`.
- First version excludes valuation, batch/expiry drill-down, CSV export, and
  zero-stock rows unless later requested.
- Tenant-wide visibility must be implemented with SELECT-only RLS policies;
  existing branch-scoped mutation policies remain unchanged.

## Authorized scope

- Add the `inventory.report.global` permission and safe provisioning/fixture
  coverage.
- Add report-specific SELECT RLS policies for tenant branches, warehouses,
  balances, batches, presentations, and products.
- Add a read-only API endpoint under `/api/v1/inventory/reports/tenant-stock`
  with deterministic search and pagination.
- Add a typed Web client, `/inventory/report` view, and permission-conditioned
  navigation separate from `/inventory` administration.
- Add tests for authorization, cross-branch aggregation, reserved math,
  cross-tenant isolation, RLS, pagination, and decimal transport.
- Update contracts, test matrix, status, and this ODD task document.

## Out of scope

- Inventory mutations, FEFO/reservations, reconciliation, valuation or moving
  weighted-average cost, batch drill-down, exports, scheduled reports,
  notifications, external providers, and sales integration.

## Acceptance criteria

- A user with `inventory.report.global` can read all branches in their tenant;
  a branch-only user cannot access the endpoint or report view.
- Cross-tenant rows are never visible, including through direct SQL/RLS access.
- Each detail row includes branch, warehouse, product, presentation, physical,
  reserved, and available quantities as exact decimal strings.
- Branch subtotals and the tenant total reconcile with detail rows.
- Search, ordering, and pagination are deterministic and do not leak scope.
- No report route grants write access or changes existing inventory behavior.

## Checklist

- [x] T1 — Add RED API/database tests for permission denial, RLS, aggregation,
  reserved math, pagination, decimals, and cross-tenant isolation.
- [x] T2 — Add dedicated permission, SELECT-only report RLS policies, service,
  controller, and contracts.
- [x] T3 — Add typed Web client, `/inventory/report` hierarchy/subtotals, and
  permission-conditioned navigation.
- [ ] T4 — Run API/Web verification, Docker smoke when available, and update
  status/test documentation. Static checks pass; PostgreSQL/Docker remain
  unavailable in this environment.
- [x] T5 — Commit and push the authorized feature branch (`2893a1b`) to
  `origin/codex/f9-global-inventory-report`.

## Route declaration

- Route: delegated direct implementation.
- Mapping trigger: schema/RLS, permissions, API, Web UI, tests, and docs span
  multiple non-trivial files.
- Writer trigger: implementation touches more than two non-trivial files.
- Effective TDD: strict; RED → GREEN → REFACTOR with focused report tests.

## Verification plan

- `pnpm --filter @farmaxia/api test -- inventory-report.spec.ts tenancy.rls.spec.ts auth.e2e.spec.ts`
- `pnpm --filter @farmaxia/api exec tsc --noEmit --project tsconfig.json`
- `pnpm --filter @farmaxia/api build`
- `pnpm --filter @farmaxia/web build`
- `git diff --check`
- Docker Compose health/smoke with `/health` and `/` when the engine is available.

## Progress

- Status: implementation and authorized publication complete; live
  PostgreSQL/Compose verification remains blocked by unavailable local services.
- Previous boundary: `8eaf9ff docs(catalog): record F8 publication`.
- Current branch: `codex/f9-global-inventory-report`.
- Publication: `origin/codex/f9-global-inventory-report`.
- Work-unit commit: `2893a1b feat(inventory): add tenant-wide stock report`.

## Evidence

- RED: `pnpm --filter @farmaxia/api exec vitest run test/inventory-report.spec.ts`
  reached the new suite but could not migrate because PostgreSQL at `localhost:5433`
  refused connections; the test assertions remain pending against a live database.
- GREEN source checks: API `tsc --noEmit` and Web production build passed; Web
  exposes `/inventory/report`.
- Pending: focused PostgreSQL tests, migration/RLS execution, and Docker
  health/smoke; API/Web static verification passed.
