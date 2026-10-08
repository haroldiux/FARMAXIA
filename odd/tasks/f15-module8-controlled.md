# ODD Feature: F15 Module 8 — Controlled medicines (AGEMED / regencia)

## Objective
Make controlled medicines operable and auditable: the POS refuses to sell a controlled product without prescription data, every dispensed prescription is archived, and the pharmacy can see monthly balances and export the digital psychotropics book for SEDES/AGEMED inspection.

## Problem / why
Module 8 is 0/4 in `ESTADO_FUNCIONALIDADES.md`, and module 5 still has "Exigir receta al vender controlados" as ❌. Products already carry `is_controlled` / `sale_classification` (0017, D32/D34), but nothing in the sale flow reads them (D34: informational only). The stock ledger `inventory_movements` already records every IN/OUT per lot (RECEIPT, SALE, SALE_VOID, SALE_RETURN, TRANSFER_OUT/IN, WASTE, ADJUSTMENT, RESERVATION_CONSUME), so balances and the book can be derived without new stock writes.

## Scope
- `controlled_prescriptions` table (migration `0029_controlled_prescriptions.sql`, journal idx 29): tenant + branch scoped, RLS, linked 1:1 to `sales`, fields doctor name, doctor license (matrícula), patient name, patient ID document, issuing health center, prescription date, optional notes, folio `R-<branch>-000001` via `DocumentSequenceService`, created_by, created_at. Immutable (no UPDATE grant beyond what's needed).
- POS enforcement in `SalesService.postSale`: if any line's product is effectively controlled (`products.is_controlled OR category.is_controlled OR sale_classification = 'CONTROLLED'`), a `prescription` payload is mandatory → else 400 `PRESCRIPTION_REQUIRED`. Applies on every plan (legal requirement, T20/R01-R03). Prescription row inserted in the same transaction; audit event `controlled.prescription_recorded`. `SalesLookupItem` exposes `isControlled`.
- Plan tiers (feature keys from 0015): `controlled.manual` (all plans): capture + archive list; `controlled.assisted` (Profesional/Premium): stricter validation (license and ID format, prescription date not in the future and not older than the validity window); `controlled.book` (Premium/Completo): monthly balance + book export.
- API `api/v1/controlled`: list/detail prescriptions (archive), monthly balance per controlled product (opening, entries, exits, closing, broken down by movement type, transfers reported separately), book entries (chronological, folio-numbered lines) with CSV export.
- Permissions: `controlled.read` (archive, balances, book) and `controlled.book.export`; assigned to owner and regente (encargado read-only). Declared in `role-templates.ts` + migration inserts for existing tenants.
- Web: prescription dialog in the POS when the cart contains a controlled product; new sidebar entry "Controlados" with pages `/controlled` (prescription archive), `/controlled/balance` (monthly balance), `/controlled/book` (printable book + CSV download).

## Out of scope / defaults (pending regente/teacher, see REGISTRO_DECISIONES D57-D60)
- D57: only effectively CONTROLLED products require the prescription; `RETAINED_PRESCRIPTION` / `PRESCRIPTION` stay informational (D34 partially superseded).
- D58: prescription archive stores data only; scanned attachment deferred (no upload pipeline yet).
- D59: book = chronological ledger lines per controlled product and branch, folio numbering per listing, CSV + browser print; official SEDES/AGEMED format pending.
- D60: validity window for prescriptions under `controlled.assisted` defaults to 30 days.

## Constraints
- Branch `Denil` only, no new branches, no commits by the agent (user commits manually — user rule overrides ODD work-unit commits).
- Strict TDD: observed RED before implementation.
- Follow transfers module conventions (module registration, RLS, permissions, vitest include list, fixed UUID ranges).

## Tasks
- [x] T1 Migration 0029 + schema.ts + permissions + role templates (route: delegated writer, part of one slice with T2-T3)
- [x] T2 POS enforcement in sale confirm + lookup `isControlled` + tests (delegated writer)
- [x] T3 Controlled API: archive, monthly balance, book + CSV, tier gating + tests (delegated writer)
- [x] T4 Web: POS prescription dialog, sidebar entry, `/controlled`, `/controlled/balance`, `/controlled/book` (delegated writer)
- [x] T5 Docs: ESTADO_FUNCIONALIDADES (module 8, module 5 item, test totals) + REGISTRO_DECISIONES D57-D60 (inline)

## Acceptance criteria
- Selling a controlled product without prescription → 400 `PRESCRIPTION_REQUIRED`; with prescription → sale + prescription row in one transaction.
- Non-controlled sales unaffected; full API suite green.
- Balance: opening + entries − exits = closing, matching `inventory_balances` for the current month.
- Book export only on plans with `controlled.book`; RLS keeps branches/tenants isolated.

## Checks
- `pnpm --filter @farmaxia/api test` (full suite), `pnpm --filter @farmaxia/web typecheck` or build.
- TDD: mode strict (session config), runner vitest.

## Progress and evidence
(updated after each task)

### T1-T3 (API, one delegated writer, 2026-10-02)
- T1: `apps/api/drizzle/0029_controlled_prescriptions.sql` (+ journal idx 29, schema.ts `controlledPrescriptions`): immutable table (SELECT/INSERT grant only), branch-scoped RLS ENABLE+FORCE, unique (tenant, branch, sale) and (tenant, branch, folio); permissions `controlled.read` (owner, regente, encargado) and `controlled.book.export` (owner, regente) in role-templates + migration.
- T2: `src/controlled/prescription.ts` (rule, validation, folio `R-<branch>-NNNNNN` via document sequence `CONTROLLED_PRESCRIPTION`); `SalesService` enforces `PRESCRIPTION_REQUIRED`, inserts prescription in the sale transaction, audit `controlled.prescription_recorded`; assisted rules (formats, not future, max 30 days) only with `controlled.assisted`; lookup exposes `isControlled`; `ConfirmedSale.prescription` = `{ id, folio } | null`.
- T3: `src/controlled/` module (service, controller `api/v1/controlled`, registered in app.module). Plan gating for balance/book/export both via `@RequireFeature("controlled.book")` and in-service (403 PLAN_FEATURE_RESTRICTED).
- TDD RED: `controlled-prescriptions.spec.ts` 9 failed / 1 passed before implementation; `controlled-archive.spec.ts` failed to load (module missing). GREEN: 10/10 and 10/10.
- Verification: focused specs + sales-confirm green; full `pnpm --filter @farmaxia/api test` 33 files / 260 tests passed (baseline 240/31; saas.spec and identity.spec permission counts 17 -> 19 updated); `tsc --noEmit` clean.
- Route: delegated writer (mapping done by parent). No commits made (user commits manually).

### T4 (web, one delegated writer, 2026-10-02)
- POS: `isControlled` on lookup/cart (`lib/sales.ts`, `lib/pos-cart.ts` `cartHasControlled`), "Controlado" badge in results and cart lines, prescription dialog (`sales/page.tsx`) opened by confirm/F9 when the cart has a controlled line; `prescription` sent only in that case; `PRESCRIPTION_REQUIRED`/`INVALID_INPUT` keep the dialog open with the server message; folio shown in the success panel. Receipt not changed: `GET sales/:id` does not return the prescription (would need an API change).
- Sidebar "Controlados" (icon `controlled`, permission `controlled.read`), `/controlled` in `tenantRoutes`. Pages: `/controlled`, `/controlled/[prescriptionId]`, `/controlled/balance`, `/controlled/book` (print + CSV with `controlled.book.export`); `lib/controlled.ts` client + pure helpers; `components/controlled-nav.tsx` (locks Premium links when the plan lacks `controlled.book`), `components/controlled-shared.tsx`; PLAN_FEATURE_RESTRICTED shows a Premium message.
- Checks: `tsc --noEmit` clean; `pnpm --filter @farmaxia/web build` OK (routes listed). The web package has no test runner or lint script, so no unit tests were added (helpers sanity-checked ad hoc with node, not committed). Not exercised in a browser.

- T5 (inline): ESTADO_FUNCIONALIDADES updated (module 8 4/4, module 5 prescription item, totals 77/1/25, tests 260/260 in 33 files, roadmap rows); REGISTRO_DECISIONES D57-D60 added. Dev DB migrated to 0029 with drizzle-kit migrate.

## Next step
All tasks done. Follow-ups: show prescription folio on the printed receipt (GET sales/:id must return it); D57-D60 review with the teacher; user commits manually.
