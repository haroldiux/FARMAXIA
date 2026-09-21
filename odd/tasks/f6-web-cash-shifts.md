# ODD Feature: F6-WEB Configurable Cash Shifts

## Objective

Expose a branch-scoped cash-shift scheduling flow that supports multiple dated
shifts per cash register, one or more assigned users per shift, and strict
non-overlap on each register.

## Problem

The repository persists cash registers but has no operational cash-shift module.
The product requires configurable schedules such as Caja 1 from 08:00–16:00
for one user and 16:00–00:00 for another user, without simultaneous ownership
of the same register.

## Why this slice

Scheduling is the smallest safe cash vertical before opening floats, closing
counts, discrepancies, sales, and reconciliation. It establishes the branch
and assignment boundaries without inventing monetary policy.

## Authorized scope

- API endpoints under `cash.manage` to list active branch cash registers and
  eligible active branch users, create dated shifts, list shifts, and assign
  one or more users per shift.
- A `cash_shifts` persistence model with absolute start/end timestamps and a
  status limited to `SCHEDULED` and `CANCELED` for this slice.
- A `cash_shift_users` join model with branch-scoped membership validation.
- Web `/cash` scheduling flow with validation, empty/error states, and a
  configurable repeatable user assignment UI.
- PostgreSQL red/green coverage for RLS, permission, assignment, idempotency,
  concurrency, and same-register overlap rejection.
- API/Web contracts, implementation status, and this ODD task document.

## Out of scope

- Opening floats, closing counts, discrepancies, approvals, sales, payments,
  stock consumption, fiscal documents, returns, recurrence templates, and
  external payment providers.
- Changes to `origin/main` or remote operations without explicit authorization.

## Confirmed policy

- A cash register may have many shifts over time.
- Each shift has configurable absolute start and end timestamps, including
  midnight-crossing intervals.
- A shift may have one or more assigned users.
- Shifts on the same cash register must never overlap. Different registers may
  schedule independently.
- Use exact decimal strings for future monetary fields; this slice has no money
  arithmetic.

## Acceptance criteria

- Active branch registers and eligible active branch users are listed without
  leaking users or registers from another tenant/branch.
- A dated shift can be created with one or more distinct eligible users.
- Empty, duplicate, inactive, or cross-branch assignments are rejected.
- `scheduledEndAt` must be after `scheduledStartAt`; absolute timestamps handle
  midnight correctly.
- Any overlapping interval on the same register is rejected, including
  concurrent create attempts; adjacent intervals are allowed.
- Repeated requests with the same idempotency key replay without duplicates.
- `cash.manage`, authentication, branch RLS, and audit boundaries are enforced.
- `/cash` exposes scheduling states, preserves failed draft values, and builds.

## Checklist

- [x] T1 — Red tests for cash-shift scheduling, overlap, assignments, RLS, and replay.
- [x] T2 — Add migration/schema and scoped Cash service/controller/module.
- [x] T3 — Add typed Web client and `/cash` scheduling UI/navigation.
- [x] T4 — Run API/Web verification, Docker smoke when available, and update docs/status.
- [x] T5 — Commit as one work unit; no push performed (requires explicit authorization).

## Route declaration

- Route: delegated direct implementation.
- Mapping trigger: current behavior spans database schema/RLS, auth, module wiring,
  API tests, Web shell, contracts, and status docs.
- Writer trigger: implementation touches more than two non-trivial files.
- Effective TDD: strict; RED → GREEN → REFACTOR with the API test command.

## Verification plan

- `pnpm --filter @farmaxia/api test -- cash.spec.ts tenancy.rls.spec.ts auth.e2e.spec.ts`
- `pnpm --filter @farmaxia/api exec tsc --noEmit --project tsconfig.json`
- `pnpm --filter @farmaxia/api build`
- `pnpm --filter @farmaxia/web build`
- `git diff --check`
- Docker Compose health/smoke when Docker Desktop is available.

## Progress

- Status: T1–T5 implemented; work-unit committed locally (no push authorized).
- RED: focused Vitest discovered `cash.spec.ts` and failed because the Cash
  controller/service did not yet exist.
- GREEN evidence: API source+test typecheck, API build, Web production build,
  focused API/RLS/auth suite (11 tests), and `/cash` static route generation
  pass. Docker migration and health smoke pass (`/health` and `/` return 200).
- Fixed during verification: migration `0011` initially created the cash-register
  foreign key before its composite unique constraint, and Nest could not inject
  `CashService` because `TenantDatabase` was imported as type-only. The migration
  ordering and runtime import are corrected; shared auth/RLS test fixtures now
  truncate the new cash-shift tables before each test.
- Concurrency approach: creation locks the active cash-register row before
  checking the half-open interval, while a per-key advisory lock serializes
  concurrent idempotent retries.
- Previous boundary: `4f91e64 feat(procurement): add receiving by lot`.
- Current branch: `codex/f6-web-cash-shifts`.
- Work-unit commit: this commit (`feat(cash): add configurable shift scheduling`).
- Environment: Docker Desktop/PostgreSQL became available; migration and health smoke passed.
