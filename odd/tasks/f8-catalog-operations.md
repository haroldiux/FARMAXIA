# ODD Feature: F8 Catalog Operational Pricing and Barcodes

## Objective

Expose the existing catalog domain capabilities for operational price lists,
dated prices, and product barcodes through scoped API routes and the `/catalog`
Web experience without coupling this slice to sales or inventory movement.

## Problem

`CatalogService` already models product, price-list, dated-price, and barcode
operations, but operators do not yet have complete HTTP and Web workflows for
maintaining them. The catalog needs a safe operational boundary before sales
and inventory valuation are implemented.

## Why this slice

Operational catalog data is a prerequisite for later sales and inventory
features. Keeping it independent makes pricing and barcode rules testable while
avoiding premature coupling to checkout, FEFO consumption, or valuation.

## Confirmed policy

- Price intervals for the same presentation and scope (global or branch) must
  never overlap, including open-ended intervals.
- Global and branch prices may coexist; a branch-scoped price takes precedence
  for that branch, with global price as fallback.
- Money remains exact decimal strings at API/UI boundaries and is stored as
  `numeric(18,4)`; JavaScript floating-point arithmetic is forbidden.
- FEFO physical dispensing plus perpetual moving weighted-average valuation is
  the inventory architecture decision, but it is not implemented or changed by
  this catalog slice.
- The tenant-wide total inventory report is a separate F9 slice with its own
  global permission and is out of scope here.

## Authorized scope

- API routes under existing catalog read/manage permissions for listing and
  creating price lists, setting dated prices, registering barcodes, and looking
  up products by barcode.
- `/catalog` Web flows for these operations while preserving existing product
  CRUD and permission-conditioned navigation.
- Validation for interval overlap, branch/global scope, exact decimal values,
  duplicate barcodes, idempotency, audit events, tenant isolation, and RLS.
- Focused API/Web tests plus contracts and status documentation.

## Out of scope

- Sales, checkout, payment methods, proformas, stock movements, FEFO picking,
  moving-average calculations, inventory reports, controlled-product workflows,
  external providers, and fiscal documents.

## Acceptance criteria

- Authorized users can list/create price lists and set valid dated prices in
  the active tenant; invalid or overlapping intervals are rejected atomically.
- Branch-scoped prices override global prices for matching branch reads while
  preserving global fallback.
- Authorized users can register and search unique product barcodes without
  cross-tenant leakage.
- API responses preserve decimal values as strings and return controlled,
  actionable validation errors.
- Mutations are protected by existing catalog permissions, RLS, audit events,
  and idempotency semantics.
- `/catalog` keeps drafts on errors and exposes price/barcode states without
  introducing sales or inventory UI.

## Checklist

- [x] T1 — Add RED tests for dated-price overlap/scope precedence, barcode
  registration/lookup, idempotency/audit, and decimal transport. PostgreSQL
  integration execution remains blocked by unavailable local infrastructure.
- [x] T2 — Add scoped API routes/controllers and contract updates, reusing
  `CatalogService` invariants with RLS, idempotency and audit.
- [x] T3 — Add typed Web actions and `/catalog` price-list, price, and barcode
  workflows while preserving product CRUD.
- [ ] T4 — Run PostgreSQL API integration and Docker smoke; typechecks/builds,
  API/Web compilation, docs and status updates are complete, but Docker/Postgres
  are unavailable in this environment.
- [x] T5 — Commit the authorized feature branch without pushing (`71ce744`).

## Route declaration

- Route: delegated direct implementation.
- Mapping trigger: API, contracts, Web UI, tests, permissions, and docs span
  multiple non-trivial files.
- Writer trigger: implementation touches more than two non-trivial files.
- Effective TDD: strict; RED → GREEN → REFACTOR with focused catalog tests.

## Verification plan

- `pnpm --filter @farmaxia/api test -- catalog.spec.ts tenancy.rls.spec.ts auth.e2e.spec.ts`
- `pnpm --filter @farmaxia/api exec tsc --noEmit --project tsconfig.json`
- `pnpm --filter @farmaxia/api build`
- `pnpm --filter @farmaxia/web build`
- `git diff --check`
- Docker Compose health/smoke with `/health` and `/`.

## Progress

- Status: implementation complete pending unavailable PostgreSQL/Docker checks.
- RED: added F8 assertions before implementation; focused API suite could not
  execute because `localhost:5433` refused connections.
- GREEN/static proof: `pnpm --filter @farmaxia/api exec tsc --noEmit --project tsconfig.json`,
  `pnpm --filter @farmaxia/api build`, `pnpm --filter @farmaxia/web exec tsc --noEmit`,
  `pnpm --filter @farmaxia/web build`, and `git diff --check` passed.
- Docker smoke: `docker compose up -d postgres redis` was blocked because the
  Docker Desktop Linux engine pipe is unavailable.
- Previous boundary: `1801a63 docs(cash): record F7 publication`.
- Current branch: `codex/f8-catalog-operations`.
- Work-unit commit: `71ce744 feat(catalog): add pricing and barcode workflows`.
- Publication: intentionally pending; this task must not push.
