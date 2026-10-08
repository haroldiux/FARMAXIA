# ODD Feature: F17 Module 10 — Customers, loyalty and agreements (CRM)

## Objective
Let the pharmacy register customers and see their purchase history, reward them with loyalty points redeemable at the POS, and sell to members of agreements (insurers, companies, unions) where the agreement covers part of the sale on monthly credit and the patient pays the copay, with a consolidated monthly statement per agreement.

## Problem / why
Module 10 is 0/5 in `ESTADO_FUNCIONALIDADES.md`. No customer, loyalty or agreement table exists; `sales` has no customer link; payments are only CASH/CARD/QR (`sale_payments_method_check`). Plan feature keys exist in `0015_core_saas.sql`: `crm.customers` (all plans), `crm.loyalty` (Profesional+), `crm.agreements` (Premium); COMPLETO has all.

## Scope
Part A — customers + loyalty (migration `0031_crm_customers_loyalty.sql`, idx 31):
- `customers` tenant-wide (tenant + membership RLS, like `commission_rules`): full name, doc type `CI | NIT | PASSPORT | OTHER`, doc number, complement, phone, email, notes, active; unique (tenant, doc type, doc number) when the number exists. `sales.customer_id` nullable FK.
- API `api/v1/customers` (`crm.customers`): search/list, create, update, detail, purchase history (sales of the active branch, net of returns).
- POS: optional `customerId` on sale confirm; `GET sales/:id` exposes the customer.
- Loyalty (`crm.loyalty`): tenant `loyalty_settings` (BOB per point earned, default 10; point value in BOB, default 0.10; enabled); `loyalty_movements` ledger (customer, branch, sale, kind `EARN | REDEEM | REVERSAL | ADJUST`, points, reason). Earn on confirm = floor(amount paid with CASH/CARD/QR net of change ÷ BOB per point); redeem = new payment method `POINTS` (non-cash, no drawer effect, amount = points × value, needs customer and balance). Balance = ledger sum. Manual adjustment with reason.
- Void reverses earned and redeemed points. Partial return: proportional reversal of earned points and proportional give-back of redeemed points; the rest refunded by the chosen method.
Part B — agreements (migration `0032_crm_agreements.sql`, idx 32, `crm.agreements`):
- `agreements` (name, kind `INSURER | COMPANY | UNION`, payer name + tax id, coverage percent, default monthly credit limit per member, active); `agreement_members` (agreement, customer, employee/member code, monthly limit override, active).
- POS: payment method `AGREEMENT` (non-cash, no drawer effect): requires a customer who is an active member; amount ≤ coverage % of the sale total and ≤ remaining monthly credit of the member; creates an `agreement_charges` row (branch, sale, member, amount, status `OPEN | BILLED | VOIDED`) in the sale transaction. Void voids the charge; partial return reduces the charge proportionally.
- Statements: `agreement_statements` per agreement and month consolidating OPEN charges from all branches (status `ISSUED | PARTIAL | PAID`), `agreement_statement_payments` (idempotent, like `supplier_payments`); printable + CSV. Not a fiscal invoice (waits D03).
Part C — web: sidebar "Clientes" (`/customers`, detail with history and points), POS customer picker + POINTS/AGREEMENT payments, `/customers/agreements`, `/customers/statements`, loyalty settings; customer + agreement on the receipt.

## Provisional defaults (REGISTRO_DECISIONES D66-D71, pending Harold)
- D66: customers are tenant-wide; purchase history shows the active branch only (sales are branch-scoped by RLS).
- D67: 1 point per 10 BOB paid with cash/card/QR (points and agreement parts earn nothing); 1 point = 0.10 BOB; both configurable.
- D68: redeeming points is a payment method (`POINTS`), not a price discount; tax treatment to confirm with SIAT.
- D69: agreements cover a fixed % of the sale up to the member's monthly credit limit; the rest is the patient's copay paid with other methods.
- D70: returns on sales paid partly with points/agreement are split proportionally to the payment mix.
- D71: the "global invoice" is a non-fiscal monthly statement per agreement with payments recorded manually. Permissions: `customers.manage` (owner, regente, encargado, cajero), `loyalty.manage` (owner), `agreements.manage` (owner, encargado), `agreements.billing` (owner).

## Constraints
- Branch `Denil`, no new branches, no commits by the agent (user commits manually; delivery strategy not applied).
- TDD strict (session config), runner vitest `pnpm --filter @farmaxia/api test` (Postgres :5433). Web: typecheck + build (no runner).
- Follow staff/controlled conventions; spec UUID ranges 950000+ (verify unused).
- Existing sales/returns behavior unchanged for sales without customer/points/agreement.

## Tasks
- [x] T1 Migration 0031 + customers API + `sales.customer_id` + history (writer A)
- [x] T2 Loyalty settings, ledger, earn on confirm, `POINTS` payment (writer A)
- [x] T3 Void/return handling for points (writer A)
- [x] T4 Migration 0032 + agreements and members API (writer B)
- [x] T5 `AGREEMENT` payment at POS with coverage/limit + charges, void/return handling (writer B)
- [x] T6 Monthly statements + payments + CSV (writer B)
- [x] T7 Web: customers, POS picker and payments, agreements, statements, receipt (writer C)
- [x] T8 Docs: ESTADO module 10 + totals, REGISTRO D66-D71 (inline)

## Acceptance criteria
- Sales without customer behave exactly as before (existing sales specs green).
- Points: earn/redeem/void/return math matches fixtures; POINTS without customer or balance → 400.
- Agreement: non-member, over coverage or over monthly limit → 400; charge created/voided/reduced consistently; statement totals = sum of charges; payments never exceed balance.
- Plan gating: Basico 403 on loyalty and agreements, Profesional 403 on agreements.
- RLS isolates tenants; full API suite green; web typecheck + build OK.

## Progress and evidence

### T1-T3 (API part A, delegated writer, 2026-10-05)
Route: delegated direct (single writer). TDD strict, runner vitest.
- Migration `0031_crm_customers_loyalty.sql` (journal idx 31): `customers` (tenant-wide RLS with membership), `sales.customer_id` (FK + index), `loyalty_settings`, `loyalty_movements` (immutable: SELECT/INSERT only; tenant-wide read, active-branch write), `sale_payments` method check + `POINTS` (no reference), `sale_returns.points_returned/points_refund_bob`, permissions `customers.manage` (owner, regente, encargado, cajero) and `loyalty.manage` (owner), module "Clientes" (24 permissions total).
- Code: `apps/api/src/customers/` (service, controller, loyalty service/controller, `loyalty-ledger.ts`, module registered in `app.module.ts`); `apps/api/src/sales/payment-methods.ts` (single place classifying methods: `creditLikeMethods`, `referenceMethods`, `earnsLoyalty`; Part B adds `AGREEMENT` there + its own constraint migration); `apps/api/src/sales/sales-loyalty.ts` (prepare/settle/void/return math); edits in `sales.service.ts`, `sales-history.ts`, `sales-returns.ts`, `schema.ts`, `role-templates.ts`.
- Endpoints: `api/v1/customers` (GET list, POST, GET/PATCH `:id`, GET `:id/purchases`), `api/v1/loyalty/settings` (GET, PUT), `api/v1/customers/:id/loyalty` (GET), `api/v1/customers/:id/loyalty/adjustments` (POST). Sale confirm accepts `customerId` and `POINTS`; void/return reverse points.
- Decisions: shortfall on reversal (customer spent earned points) reverses only the held balance, writes the missing amount in the REVERSAL reason and in the response/audit; returns keep `refund_amount_bob` = value of returned lines (so net-of-returns math is unchanged) and split money vs points in `refundMoneyBob`/`refundPointsBob`; point share is cumulative and floored.
- TDD: RED = 2 new spec files failed to load (modules missing, 0 tests) plus saas/identity count assertions at 22; GREEN = new specs 13 + 25 = 38 tests pass; existing assertions updated only where the change is intended (permission count 22 to 24, cajero template gains `customers.manage`, supervisor test role gets it).
- Verification: `pnpm --filter @farmaxia/api test`: 38 files / 322 tests passed (baseline 36 / 284). `pnpm --filter @farmaxia/api exec tsc --noEmit`: clean.

### T4-T6 (API part B, delegated writer, resumed 2026-10-06)
Route: delegated direct (single writer, resumed from the paused partial work; everything on disk was read, verified and kept). TDD strict, runner vitest.
- Migration `0032_crm_agreements.sql` (journal idx 32): `agreements` (tenant-wide RLS with membership), `agreement_members` (tenant-wide, unique customer and member code per agreement), `agreement_charges` (INSERT only for the selling branch, SELECT/UPDATE tenant-wide so billing can read every branch; no DELETE), `agreement_statements` (status/paid CHECK keeps ISSUED/PARTIAL/PAID consistent with `paid_bob`), `agreement_statement_payments` (SELECT/INSERT only, unique idempotency key per tenant). `sale_payments` method and reference checks gain `AGREEMENT`; `sale_returns.agreement_refund_bob`; permissions `agreements.manage` (owner, encargado) and `agreements.billing` (owner), module "Clientes" (26 permissions total). `schema.ts` mirror written, `role-templates.ts` updated.
- Code: `apps/api/src/customers/` (`agreements.service/controller`, `agreement-statements.service/controller`, registered in `customers.module.ts`); `apps/api/src/sales/sales-agreements.ts` (prepare with member row lock, coverage and monthly-credit checks, charge, void, proportional return plan, sale detail); `payment-methods.ts` classifies `AGREEMENT` as credit-like; edits in `sales.service.ts`, `sales-returns.ts`, `sales-history.ts`.
- Endpoints (`crm.agreements`, Premium/COMPLETO): `api/v1/agreements` (GET, POST), `agreements/:id` (GET, PATCH), `agreements/:id/members` (GET, POST), `agreements/:id/members/:memberId` (PATCH), `customers/:id/agreements` (POS lookup with used/remaining credit); statements: `GET preview`, `POST` (issue), `GET` (list), `GET :id` (detail with lines and payer data), `POST :id/payments` (idempotent), `GET :id/export` (CSV). Sale confirm accepts `AGREEMENT` + `agreementId`; `GET sales/:id` exposes `agreement`.
- Decisions: coverage cap = round(total x coverage %, 2); monthly credit measured per La Paz calendar month on non-voided charges net of reductions; member row locked for serialization; at most one agreement per sale; a BILLED charge blocks void/return with 409 `AGREEMENT_CHARGE_BILLED`; the agreement share of a return is cumulative and floored (final return closes the charge exactly), stored in `sale_returns.agreement_refund_bob`; statements snapshot sale number, branch code and issuer name because sales/users are branch-scoped; one statement per agreement and month, no future period.
- TDD: the specs and implementation were written by the previous (stopped) writer, so this resumed run did NOT observe RED itself (implementation was already on disk when resumed); its RED was not recorded. GREEN observed now: `crm-agreements.spec.ts` (21 tests) and `crm-agreement-statements.spec.ts` (13 tests) pass. Existing assertions changed only where intended: permission count 24 to 26 (`identity.spec.ts`, `saas.spec.ts`).
- Verification: `pnpm --filter @farmaxia/api test`: 40 files / 356 tests passed (Part A baseline 38 / 322; needed Docker + postgres started). `pnpm --filter @farmaxia/api exec tsc --noEmit`: clean.

### T7 (web part C, delegated writer, 2026-10-06)
Route: delegated direct (single writer). Web has no test runner: verification is typecheck + build; no API code touched.
- Sidebar: module "Clientes" (`/customers`, permission `customers.manage`, new `customers` icon) in "Operacion"; `/customers` added to the shell's tenant routes. Sub-navigation `CustomersNav` (same pattern as `StaffNav`): Clientes (`customers.manage`), Puntos (`loyalty.manage`, locked label "Profesional" without `crm.loyalty`), Convenios (`agreements.manage` or `agreements.billing`, locked "Premium" without `crm.agreements`), Estados de cuenta (`agreements.billing`, locked "Premium").
- Pages: `/customers` (search/filter/paging, create, edit, side detail: purchases of the active branch with link to the receipt, points balance + ledger + manual adjustment gated by `crm.loyalty` + `loyalty.manage`, the customer's agreements with remaining credit); `/customers/loyalty` (enabled, BOB per point, point value; `loyalty.manage`); `/customers/agreements` (CRUD + members: add, edit code/limit override, activate/deactivate; read-only for `agreements.billing` only); `/customers/statements` (agreement + month, preview of open charges, issue, list with filters) and `/customers/statements/[statementId]` (printable A4, lines, payments, payment form with an idempotency key reused only while the payload is unchanged, CSV download via authenticated blob; `agreements.billing`).
- POS (`/sales`): optional customer picker (search by name/document/phone, shown when `crm.customers` is in the plan snapshot). Payment options `POINTS` (needs balance > 0 and loyalty enabled; input in whole points, amount computed, "use max") and `AGREEMENT` (needs at least one active agreement of the customer; shows coverage cap, remaining monthly credit and "use max") only appear when the customer has them, which also hides them when the plan lacks the feature. Removing/changing the customer resets POINTS/AGREEMENT payments. Sales without customer send exactly the same payload as before (`customerId`/`agreementId` only when present). CRM API errors (insufficient points, not a member, coverage/limit exceeded, charge already billed, ...) are translated to Spanish in `lib/sales.ts` because the API answers them in English.
- Receipt (`/sales/[saleId]`): customer line, points earned/redeemed/balance, agreement name and covered amount, POINTS/AGREEMENT payment labels, points given back and agreement part on returns. History uses the wider tender labels. Refund methods stay CASH/CARD/QR (`SalePaymentMethod`); payments use `SaleTender`.
- Decisions: customer detail is a side panel (not a route); optional CRM blocks wait for the plan snapshot before calling the API so a plan without the feature never fires 403 requests; no quick customer creation from the POS (done in Clientes); no new API endpoints.
- Verification: `pnpm exec tsc --noEmit` (apps/web): exit 0, no errors. `pnpm --filter @farmaxia/web build`: exit 0, routes `/customers`, `/customers/agreements`, `/customers/loyalty`, `/customers/statements`, `/customers/statements/[statementId]` generated. Not exercised in a browser by the writer.

### T8 (docs, inline, 2026-10-06)
Route: direct inline (two mechanical doc edits).
- `REGISTRO_DECISIONES.md`: D66-D71 added as provisional, pending Harold (D69 also records that a billed agreement charge blocks void/return).
- `ESTADO_FUNCIONALIDADES.md`: module 10 0/0/5 to 5/0/0; module 5 "credit/agreement payments" to done (15/0/1 to 16/0/0); totals 80/1/22 to 86/1/16 (~83%); F17 note with new permissions and pending items; roadmap sprint 3 row updated.
- Parent spot checks: API `tsc --noEmit` clean; web `tsc --noEmit` clean.

## Status
F17 complete (T1-T8). Not committed (user commits manually on `Denil`). Manual browser test pending by the user. Known gap: TDD RED for part B (T4-T6) was not observed.
