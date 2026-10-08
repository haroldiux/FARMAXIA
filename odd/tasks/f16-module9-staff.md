# ODD Feature: F16 Module 9 — Staff, work shifts and commissions

## Objective
Give the pharmacy a staff roster (work shifts and night duties "guardias", distinct from cash shifts), automatic sales commissions per dispenser (simple in Profesional, tiered "multilevel" in Premium) and a dispenser productivity report.

## Problem / why
Module 9 is 0/3 in `ESTADO_FUNCIONALIDADES.md`. Plan feature keys already exist in `0015_core_saas.sql` (`staff.shifts`, `staff.commissions` for Profesional+; `staff.commissions.multilevel` for Premium; COMPLETO has all) but nothing uses them. Sales already identify the seller (`sales.created_by_user_id`) and net totals can be derived (total minus `sale_returns.refund_amount_bob`, voided excluded), so commissions and productivity can be computed without new sale writes.

## Scope
- Migration `0030_staff.sql` (journal idx 30) + schema.ts:
  - `staff_shifts` (branch-scoped RLS like 0029): user (branch membership FK), kind `REGULAR | NIGHT_DUTY`, `starts_at`, `ends_at`, notes, status `SCHEDULED | CANCELED`, cancel reason, `checked_in_at`, `checked_out_at`, created_by, timestamps. No overlapping SCHEDULED shifts for the same user in the branch (service check, 409 `SHIFT_OVERLAP`).
  - `commission_rules` (tenant-scoped RLS with membership, 0019 pattern): scope `DEFAULT | CATEGORY | PRODUCT`, target id (null for DEFAULT), rate percent (0-100, 2 decimals), active flag; unique (tenant, scope, target).
  - `commission_tiers` (tenant-scoped): min monthly net sales (BOB) → rate percent; used only with `staff.commissions.multilevel`.
  - Permissions `staff.shifts.manage`, `staff.commissions.manage`, `staff.reports.read` in role-templates + migration inserts.
- API `api/v1/staff`:
  - Shifts (`staff.shifts`): list by date range/user, create, cancel (reason), my shifts, check-in / check-out (own shift only, within shift window ± tolerance).
  - Commission rules (`staff.commissions`): CRUD rules; tiers CRUD (`staff.commissions.multilevel`).
  - Commission report (`staff.commissions`): period (from/to, La Paz time) per seller: net sales base, commission per line (product rule > category rule > default), total; with tiers, the rate is replaced by the tier reached by the seller's net sales in the period when higher. `me` variant for own commissions.
  - Productivity (all plans, `staff.reports.read`): per seller sales count, net amount, units, average ticket, returns, voids; hours worked and sales per hour only when `staff.shifts` is enabled (from check-in/out).
- Web: new sidebar section "Personal" with `/staff` (roster + my shifts with check-in/out), `/staff/commissions` (rules, tiers, report), `/staff/productivity`.

## Provisional defaults (REGISTRO_DECISIONES D61-D65, pending Harold)
- D61: Work shifts are a per-branch roster with kinds REGULAR and NIGHT_DUTY; attendance = self check-in/out allowed from 30 min before start until end; no payroll or overtime.
- D62: Commission base = net line amount (line total minus returned amount, voided sales excluded), credited to the sale's creator; priority product > category > default; computed on the fly per period, no liquidation/payment record yet.
- D63: "Multilevel" (Premium) = tiered rates by the seller's net sales in the report period (highest tier reached overrides the line rate when higher). Alternative pending: supervisor override on team sales.
- D64: Productivity available on every plan; hours and sales/hour only with `staff.shifts`.
- D65: Permissions `staff.shifts.manage` (owner, regente, encargado), `staff.commissions.manage` (owner), `staff.reports.read` (owner, regente, encargado). Any member sees and checks into own shifts and sees own commissions.

## Constraints
- Branch `Denil` only, no new branches, no commits by the agent (user commits manually — user rule overrides ODD work-unit commits; delivery strategy therefore not applied).
- TDD: strict (session config), runner vitest (`pnpm --filter @farmaxia/api test`, needs Postgres on 5433). Web has no test runner: typecheck + build.
- Follow controlled/transfers conventions; spec UUID range `id(n) = 920000 + n` and up.

## Tasks
- [x] T1 Migration 0030 + schema + permissions + role templates (delegated API writer, slice T1-T4)
- [x] T2 Staff shifts API + check-in/out + tests (delegated API writer)
- [x] T3 Commission rules, tiers and report + tests (delegated API writer)
- [x] T4 Productivity report + tests (delegated API writer)
- [x] T5 Web: sidebar "Personal", `/staff`, `/staff/commissions`, `/staff/productivity` (delegated web writer)
- [x] T6 Docs: ESTADO_FUNCIONALIDADES module 9 + totals, REGISTRO_DECISIONES D61-D65 (inline)

## Acceptance criteria
- Overlapping shift → 409; check-in outside window → 400; other user's shift → 403/404.
- Commission report matches hand-computed fixture (product/category/default precedence, returns netted, voids excluded, tier override in Premium only).
- Plan gating: Basico gets 403 `PLAN_FEATURE_RESTRICTED` on shifts/commissions; productivity works without hours.
- RLS keeps tenants/branches isolated; full API suite green; web typecheck + build OK.

## Progress and evidence
(updated after each task)

### T1-T4 (API, delegated writer, 2026-10-05)
Route: delegated direct (single API writer). TDD strict, runner vitest. Docker Desktop had to be started locally for Postgres :5433.
- Files created: apps/api/drizzle/0030_staff.sql (+ journal idx 30), src/staff/{staff.module,staff.controller,staff.common,staff-shifts.service,staff-commissions.service,staff-productivity.service}.ts, test/staff-{shifts,commissions,productivity}.spec.ts.
- Files edited: src/database/schema.ts (staffShifts, commissionRules, commissionTiers), src/identity/role-templates.ts (3 permissions, module Personal, sort 72-74; regente/encargado get shifts.manage + reports.read), src/app.module.ts, vitest.config.ts, test/saas.spec.ts and test/identity.spec.ts (19 to 22 permissions).
- Endpoints (api/v1/staff): GET members, GET/POST shifts, GET shifts/me, POST shifts/:id/cancel|check-in|check-out, GET/POST commissions/rules, PATCH/DELETE commissions/rules/:id, GET/POST commissions/tiers, PATCH/DELETE commissions/tiers/:id, GET commissions/report, GET commissions/me, GET productivity.
- Gates: shifts and commissions by plan feature (staff.shifts, staff.commissions, tiers staff.commissions.multilevel; services also enforce 403 PLAN_FEATURE_RESTRICTED); productivity gated only by reports.basic (active subscription).
- TDD evidence: RED T1+T2 = staff-shifts spec failed to load (no service) plus saas/identity count assertions 19 vs 22 failing (3 files failed); GREEN 11 + saas 21 + identity = 48 passed. RED T3 = suite failed to load (0 of 9 run); GREEN 9/9. RED T4 = suite failed to load (0 of 4 run); GREEN 4/4 (one test expectation corrected: hours are 0, not null, on plans with staff.shifts and no attendance).
- Verification: pnpm --filter @farmaxia/api test: 36 files / 284 tests passed (baseline 33/260). pnpm --filter @farmaxia/api exec tsc --noEmit: clean.
- Notes: other suites truncate the global permissions catalog, so the T1 test asserts the migration file instead of the table. Commission attribution: sales by created_at (La Paz), returns netted regardless of return date, voided sales excluded.

### T5 (web, delegated writer, 2026-10-05)
Route: delegated direct (single web writer). No web test runner: typecheck + build.
- Files created: apps/web/app/lib/staff.ts, components/staff-nav.tsx, components/staff-shared.tsx, staff/page.tsx, staff/commissions/page.tsx, staff/productivity/page.tsx.
- Files edited: lib/modules.ts (new section "Personal", item "Turnos y comisiones", no permission so every member sees it), components/nav-icon.tsx (icon `staff`), components/app-shell.tsx (`/staff` in tenantRoutes), globals.css (staff roster styles).
- Pages: `/staff` (Mis turnos with Marcar entrada/salida for all; weekly roster, create and cancel for staff.shifts.manage; plan card on PLAN_FEATURE_RESTRICTED), `/staff/commissions` (Mis comisiones for all; team report with line detail for staff.reports.read; rules CRUD for staff.commissions.manage; tiers CRUD only with staff.commissions.multilevel, otherwise Premium card), `/staff/productivity` (staff.reports.read; hours and sales/hour columns only when hoursAvailable).
- Checks: `pnpm --filter @farmaxia/web exec tsc --noEmit` clean; `pnpm --filter @farmaxia/web build` OK (/staff, /staff/commissions, /staff/productivity built).

### T6 (docs, inline, 2026-10-05)
- ESTADO_FUNCIONALIDADES: module 9 3/3, totals 80/1/22 (~78%), sprint 5 row, header date. REGISTRO_DECISIONES: D61-D65 added as pending (Harold).
- Parent spot checks: staff specs 3 files / 24 tests passed; web `tsc --noEmit` clean.

## Next step
User tests in the browser and commits manually; review D61-D65 with Harold at the end.

### Browser test (user, 2026-10-05)
- User tested module 9 on localhost after rebuilding the api and web containers: all correct.
