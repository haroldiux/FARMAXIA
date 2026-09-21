# ODD Feature: F7 Cash Opening and Closing Controls

## Objective

Add a transactional cash-control lifecycle to the configurable F6 shifts:
open a scheduled shift with an exact BOB opening float, count the final amount,
and close immediately for zero difference or require supervisor approval for any
non-zero difference.

## Problem

F6 schedules registers and assigned users but deliberately has no monetary
state. Operators need a safe first control without pretending that sales or
payment reconciliation already exists.

## Why this slice

Comparing opening float to final count establishes accountability and a stable
state machine. Sales-ledger expectations, payment methods, denomination
breakdowns, and full reconciliation remain separate product decisions.

## Authorized scope

- A `cash_shift_controls` one-to-one persistence model linked to `cash_shifts`.
- `OPEN`, `PENDING_APPROVAL`, and `CLOSED` control states with transactional
  transitions and immutable audit events.
- API operations under `cash.manage` for opening and counting, plus a dedicated
  `cash.shift.approve` permission for approving non-zero differences.
- Typed Web actions and `/cash` UI states for opening, counting, pending
  approval, and supervisor approval.
- Exact decimal transport/storage for BOB values (`numeric(18,4)` in SQL,
  decimal strings at API/UI boundaries); no JavaScript floating-point money
  arithmetic.
- PostgreSQL tests for state transitions, RLS, permissions, idempotency,
  concurrent count/approval, and positive/negative differences.
- API/Web contracts, status, and this ODD task document.

## Out of scope

- Sales or payment ledgers, card/QR reconciliation, denomination breakdowns,
  recurring shifts, reopening/recount workflows, fiscal documents, and external
  providers.
- Deriving expected cash from sales: for this slice expected amount equals the
  opening float.

## Confirmed policy

- Opening float versus final counted amount is the first monetary slice.
- Zero difference transitions directly from `OPEN` to `CLOSED`.
- Any positive or negative difference transitions to `PENDING_APPROVAL`.
- Only an authorized supervisor with `cash.shift.approve` can approve a
  non-zero difference and transition to `CLOSED`.
- All monetary values remain exact decimal strings at API/UI boundaries.

## Acceptance criteria

- Only an assigned active shift user can open and count a shift in the active
  tenant/branch; unauthorized users receive a controlled denial.
- A shift can be opened exactly once with a valid non-negative decimal float.
- A final count computes the difference atomically in SQL.
- Zero difference closes immediately; non-zero difference cannot close without
  supervisor approval.
- Approval requires `cash.shift.approve`, is idempotent, and records an audit
  event plus optional approval note.
- Tenant/branch RLS, composite FKs, and idempotency prevent cross-scope or
  duplicate effects.
- Concurrent count/approval requests serialize on the shift-control row.
- `/cash` preserves decimal drafts and exposes actionable state/error feedback.

## Checklist

- [x] T1 — Red tests for opening, counting, discrepancy states, approval, RLS, and replay. RED observed when the new control table was absent; focused suite now covers zero, positive/negative differences, permission denial, replay, assignment and branch isolation.
- [x] T2 — Add migration/schema and scoped Cash control service/controller changes. Migration `0012_round_war_machine.sql` adds `cash_shift_controls`, exact numeric columns, RLS, grants and `cash.shift.approve`; API transitions lock the control row, audit and persist idempotent responses.
- [x] T3 — Add typed Web control actions and `/cash` UI states. Draft inputs remain intact on errors and use text decimal inputs without JavaScript money arithmetic.
- [x] T4 — Run API/Web verification, Docker smoke, and update docs/status. API suite 47/47, typecheck, `drizzle-kit check`, API/Web builds, `git diff --check`, and Compose `/health`/`/` smoke all passed.
- [x] T5 — Commit and push the authorized feature branch. Work-unit commit `90e1f59 feat(cash): add shift opening and approval controls` is published.

## Route declaration

- Route: delegated direct implementation.
- Mapping trigger: implementation spans cash schema/RLS, auth permissions, API,
  tests, Web UI, contracts, and status docs.
- Writer trigger: implementation touches more than two non-trivial files.
- Effective TDD: strict; RED → GREEN → REFACTOR with focused API tests.

## Verification plan

- `pnpm --filter @farmaxia/api test -- cash.spec.ts tenancy.rls.spec.ts auth.e2e.spec.ts`
- `pnpm --filter @farmaxia/api exec tsc --noEmit --project tsconfig.json`
- `pnpm --filter @farmaxia/api build`
- `pnpm --filter @farmaxia/web build`
- `git diff --check`
- Docker Compose health/smoke with `/health` and `/`.

## Progress

- Status: implementation and verification complete; commit `90e1f59` and documentation commit `cb9b4e2` are published.
- Previous boundary: `f135c1c docs(procurement): record F5 verification`.
- Current branch: `codex/f7-cash-controls`.
- Publication: `origin/codex/f7-cash-controls`.
- Focused cash suite: 8/8 passing; full API suite: 47/47 passing.
- Parent spot-check: Web production build passed.
- Environment: Docker/PostgreSQL was healthy during F5/F6/F7 verification.

## Evidence

- RED: `pnpm --filter @farmaxia/api exec vitest run test/cash.spec.ts` failed with `relation "cash_shift_controls" does not exist` before schema/migration work.
- GREEN: focused cash suite passed 8/8; full API suite passed 47/47.
- Verification: API typecheck/build, Web build, `drizzle-kit check`, `git diff --check`, and Docker Compose rebuild with HTTP 200 from `/health` and `/`.
