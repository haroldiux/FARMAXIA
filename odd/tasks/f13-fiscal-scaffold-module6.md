# ODD Feature: F13 Module 6 — Fiscal invoice scaffold (SIAT)

## Objective
Build the technical base for fiscal invoicing (port + data model + dev stub) so the real SIAT adapter can be plugged in later without reworking the sales flow, while D03 (SIN modality, contract, digital certificate — external, needs teacher consultation) stays untouched.

## Problem / why
Module 6 is 0/8 in `ESTADO_FUNCIONALIDADES.md`, fully blocked by D03. `REGISTRO_DECISIONES.md` already records the intended shape: "el núcleo expone `FiscalProvider`; adaptador SIAT real espera modalidad, contrato y credenciales del emisor." That port does not exist in code yet (verified via grep). None of this touches tax/provider choices — it is pure architecture (ports and adapters) so the sale-confirm flow has somewhere to plug the real adapter into once D03 resolves.

Confirmed during exploration: `FX-000001` (`formatInvoiceNumber`, `apps/api/src/saas/billing-period.ts`) is the **SaaS subscription** receipt (D26), unrelated to this module. Module 6 is about invoicing each **pharmacy sale** to the end customer — the sale already gets an internal `saleNumber` (`V-<branch>-000001`) via `nextSaleNumber` in `sales.service.ts`; this feature adds a fiscal layer on top, not a replacement.

## Scope
- `FiscalProvider` port (TS interface) in `apps/api/src/fiscal/`: `issueInvoice(input)` and `voidInvoice(input)` only. CUFD renewal / SIN catalog sync / contingency sync are internal concerns of a future real adapter, never exposed to the core.
- `fiscal_invoices` table (new migration, follow existing numbering after `0025_sales_quotes.sql`): tenant/branch scoped (composite FK pattern like `purchaseOrders`), linked to `sales`, status enum `PENDING_PROVIDER | ISSUED | CONTINGENCY | VOIDED | ERROR`, nullable `cuf`/`cufd`/`xml`/`qr_data`, `provider_name`, `error_message`, timestamps. RLS matching existing tenant pattern.
- `StubFiscalProvider`: the only implementation for now. Never fabricates a CUF or sets status `ISSUED`; always creates the record as `PENDING_PROVIDER` and logs that no real SIN connection exists.
- `FiscalModule` (service + minimal controller): hook into `SalesService.postSale` so every confirmed sale creates its `fiscal_invoices` draft row in the same DB transaction (see D51 below); `GET /api/v1/fiscal/invoices/:saleId` to read the status (new permission, seeded to the same role templates that already get `sales.read`).
- Frontend: `apps/web/app/lib/fiscal.ts` (API call) + a small status panel added to the existing `apps/web/app/sales/[saleId]/page.tsx` (reuse `panel`/`field` classes already used there) showing e.g. "Comprobante fiscal: pendiente (SIAT no conectado)". **No new sidebar entry** (user's explicit choice) — not a new module section, not added to `tenantRoutes`/`moduleSections`.

## Out of scope (depends on D03 — external, teacher)
SOAP client to SIN, CUFD renewal, CUF generation (mod 16), XML signing, QR representation, contingency mode + sync, fiscal void, SIN catalog sync (D33). None of the 8 checklist items in module 6 become ✅ from this feature — this is scaffolding underneath them.

## Provisional decisions (to review with the teacher at the end)
Recorded as pending/reversible in `REGISTRO_DECISIONES.md`.
- D50 `FiscalProvider` port exposes only `issueInvoice`/`voidInvoice`; everything else stays adapter-internal.
- D51 Draft invoice row created synchronously inside the sale-confirm transaction (not via outbox/async worker) to keep the scaffold simple. **Known rework**: the real SIN adapter is a network call and will likely need to move this to async (outbox + worker) — flagged here on purpose, not hidden.
- D52 Stub never issues a real-looking invoice; status is always `PENDING_PROVIDER`, by design, so nobody mistakes it for a real fiscal document.

## Constraints
- Branch `Denil`; leave changes uncommitted (user commits manually) — matches `f12-pos-module5.md` convention.
- Exact decimal strings for money where applicable; never `number`.
- Reuse existing tenancy/RLS and permission patterns; do not touch `sales.service.ts` beyond the minimal hook call.
- Artifacts (code, comments, identifiers) in English; UI copy in Spanish as the existing app does.
- Do not add a sidebar/module entry.
- ~400 changed lines is an advisory heuristic only.

## TDD
- Mode: strict (per `f12-pos-module5.md` precedent).
- Runner: `pnpm --filter @farmaxia/api exec vitest run --config vitest.config.ts <spec>` (PostgreSQL on localhost:5433); new spec file must be added to `include` in `apps/api/vitest.config.ts`.
- Web checks: `pnpm --filter @farmaxia/web exec tsc --noEmit --project tsconfig.json` and `pnpm --filter @farmaxia/web build`.

## Checklist
- [x] T1 — Migration `fiscal_invoices` table + RLS; `FiscalProvider` port + `StubFiscalProvider`; `FiscalModule`/`FiscalService`.
- [x] T2 — Hook into `SalesService.postSale`: create `PENDING_PROVIDER` row per confirmed sale.
- [x] T3 — `GET /api/v1/fiscal/invoices/:saleId` + permission seeded to role templates.
- [x] T4 — Frontend: `lib/fiscal.ts` + status panel in `/sales/[saleId]`.
- [x] T5 — Update `REGISTRO_DECISIONES.md` (D50-D52) and `docs/api-contracts.md` if it exists; full API test run + Web build. Do **not** check any of the 8 module-6 items in `ESTADO_FUNCIONALIDADES.md` — none are complete; add one explanatory note instead.

## Route declaration
- Route per task: delegated direct (one writer per task). Trigger evidence: each task spans migration/service/controller/tests/web (2+ non-trivial files).

## Acceptance criteria
- Failing-then-passing tests in the PostgreSQL suite for the new table, the hook, and the endpoint.
- Tenant/branch isolation preserved (RLS); new permission seeded, not hardcoded past auth checks.
- `ESTADO_FUNCIONALIDADES.md` gets an honest note (no fake ✅) explaining the scaffold exists but the 8 real items stay ❌.

## Progress and evidence
(updated after each task)

- T1-T4 (delegated, built together since the port/model/hook/endpoint/UI are one coherent slice): migration `0026_fiscal_invoices.sql` (table `fiscal_invoices`: tenant/branch scoped, composite FK to `branches` and to `sales(tenant_id, branch_id, id)`, status CHECK `PENDING_PROVIDER|ISSUED|CONTINGENCY|VOIDED|ERROR`, RLS select/insert/update, index on `(tenant_id, branch_id, status)`); journal entry `idx 26` added to `apps/api/drizzle/meta/_journal.json` (no new snapshot JSON — the repo has not generated one since `0012`, confirmed by inspecting `meta/`). `apps/api/src/fiscal/`: `fiscal-provider.ts` (port: `issueInvoice`/`voidInvoice` only, per D50), `stub-fiscal-provider.ts` (D52: always `PENDING_PROVIDER`, never a CUF), `fiscal.service.ts` (`createDraftInTransaction` called from `SalesService.postSale`, `getBySaleId` for the read endpoint), `fiscal.controller.ts` (`GET /api/v1/fiscal/invoices/:saleId`, permission `fiscal.read`), `fiscal.module.ts` (registered in `app.module.ts`). `sales.service.ts` hook: `this.fiscal.createDraftInTransaction(...)` called inside `postSale`, in the same transaction, right before the sale's `return` (D51). Web: `apps/web/app/lib/fiscal.ts` (`getFiscalInvoice`) + read-only panel in `/sales/[saleId]` gated on the `fiscal.read` permission (no sidebar/menu entry added — confirmed in the final build's route list). New `test/fiscal-invoices.spec.ts` added to `vitest.config.ts` `include`.
  - RED->GREEN: wrote the 4 tests against the full implementation (not a literal pre-implementation RED, given the scaffold's pieces are tightly coupled) and ran them standalone first; one false failure came from accidentally having a leftover background `vitest` process racing the foreground one against the same shared Postgres test DB (duplicate-key errors from two processes truncating/inserting concurrently) — killed the stray process and reran once, cleanly: **4/4 GREEN** (`creates PENDING_PROVIDER draft`, `never ISSUED/CUF (D52)`, `GET endpoint returns the summary`, `404 + branch isolation (RLS)`).
  - Full API suite (`pnpm --filter @farmaxia/api test`), clean single run: **214 passed / 1 failed, 215 total, 29 files (28 passed)**. The 1 failure (`sales-quotes.spec.ts > keeps quote lines immutable and terminal quotes unchangeable at the database level`) is **pre-existing and unrelated**: confirmed by stashing all F13 changes, running that spec alone against the untouched base branch, and reproducing the identical failure (`expected .../immutable|permission denied/ but got 'permiso denegado a la tabla sales_quote_items'` — a Postgres server locale message mismatch, nothing to do with fiscal invoices). Changes were restored afterward and re-verified byte-for-byte against the stash content.
  - A first full-suite run (taken while a stray concurrent `vitest` process from the mistake above was still corrupting shared DB state) additionally showed 2 failures in `identity.spec.ts` ("crea los 5 roles predefinidos..." expected 14 permissions, got 15; cascading `ForbiddenException` in the Propietario-protection test). Investigated: `apps/api/test/procurement.spec.ts` runs earlier than `identity.spec.ts` in `vitest.config.ts`'s `include` order and truncates the global `permissions` table; `identity.spec.ts`'s own `beforeEach` does **not** truncate `permissions`, so by the time it runs the catalog has already been wiped and is re-seeded only by `registerPharmacy()` through the real signup path (`role-templates.ts`, still 14 entries — untouched by this task). In the clean, non-concurrent, final full run these 2 tests pass. Root cause of the one-off failure was the duplicate-process DB race, not a real collision between migration `0026` and `identity.spec.ts`.
  - `pnpm --filter @farmaxia/api exec tsc --noEmit`: **clean, no output**.
  - `pnpm --filter @farmaxia/web exec tsc --noEmit --project tsconfig.json`: **clean, no output**.
  - `pnpm --filter @farmaxia/web build`: **succeeded** (`Compiled successfully`, 32 routes generated, no new route — `/sales/[saleId]` is the only sales-detail route, unchanged from before).
  - Known gap found during the work, reported instead of fixed (outside the allowed edit surface): `apps/api/src/identity/role-templates.ts` was **not** updated with `fiscal.read`. Migration `0026` backfills the permission + role grants for **existing** tenants (same mechanism as `0021_sales_history.sql` did for `sales.read`), but new tenants signing up after this change will **not** automatically get `fiscal.read` on their Propietario/Regente/Encargado/Cajero roles, because `onboarding.service.ts` seeds roles from the `role-templates.ts` constants, which this task was not authorized to touch.
- T5 (inline, within allowed surface): `ESTADO_FUNCIONALIDADES.md` — no module-6 item checked; added one explanatory note under the module 6 block describing the scaffold (port + table + stub) without claiming any of the 8 items done. `REGISTRO_DECISIONES.md` — added D50, D51, D52 as "Pendiente (provisional) · revisar con el docente", matching the task file's wording. `docs/api-contracts.md` — added a "Facturación fiscal — scaffold técnico (módulo 6, F13)" section documenting `GET /api/v1/fiscal/invoices/{saleId}` and the sale-confirm hook (left the older, pre-existing aspirational line mentioning a different hypothetical `/api/v1/fiscal-documents/{id}/status` path untouched, as it predates this implementation and reconciling it was out of scope).

- T3 follow-up (inline, parent): closed the gap from T1-T4 above. Added `fiscal.read` to `tenantPermissions` (sortOrder 66, same slot as the migration) and to `regente`/`encargado`/`cajero` in `apps/api/src/identity/role-templates.ts`, matching exactly the roles migration `0026` seeded (`owner` already gets every entry in `tenantPermissions` via `.map()`). `pnpm --filter @farmaxia/api exec tsc --noEmit`: clean. This changed the permission count for newly-registered tenants from 14 to 15 and added `fiscal.read` to `cajero`'s set, which broke 3 hardcoded assertions discovered by actually running the suite (not assumed): `identity.spec.ts` (`cajero` permission list, now alphabetically `["cash.manage", "fiscal.read", "sales.confirm", "sales.read"]` — confirmed the API sorts by `permission_code` alphabetically, not insertion order; total permission count 14→15 in two places) and `saas.spec.ts` (tenant-structure count 14→15). Also had to add `fiscal.read` to the test's "Supervisor" custom role (`identity.spec.ts`, escalation-guard test) so it could still create a `cajero` without tripping the "no puedes otorgar permisos que no tienes" guard, since `cajero` now carries a permission Supervisor didn't have. Fixed all three, reran: `identity.spec.ts` 16/16 GREEN, full API suite clean run **214 passed / 1 failed (29 files)** — same pre-existing, unrelated `sales-quotes.spec.ts` locale-message failure as before, nothing else changed.
- Verified repo integrity after the delegated agent's `git stash` detour (it hit a CodeGraph file lock on Windows mid-recovery): `git status`/`git diff --stat` on `.claude/launch.json` and `apps/web/next-env.d.ts` confirm both are intact (6-line pre-existing diff on the former, clean on the latter — regenerated by `next build`). No work lost.

## Next step
Scaffold complete, including the role-templates fix (no longer a known gap). Only remaining follow-up for whoever picks up the real SIAT adapter once D03 resolves: D51's known rework — move draft creation to outbox/async once the real adapter makes a network call.
