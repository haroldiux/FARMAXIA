# ODD Feature: F22 — Training Sandbox Hardening

## Objective
Make the F21 "Modo Entrenamiento" (role-based training sandbox) actually isolated and usable end to end: no training action may write to the real backend, the mode survives reloads visibly and dies on logout, and every role-track step is simulated, auto-advances, and is highlighted on screen.

## Problem / Why
Review of commit `e811213` (2026-10-22) found:
- `authenticatedFetch` (`apps/web/app/lib/session.ts:124-132`) only short-circuits ~14 allow-listed routes; every other request, including POST/PUT/PATCH/DELETE, reaches the real API with the real token. Track steps such as "receive batch", "request transfer" and "create user" create real records (and consume plan quota), breaking the F21 "zero production writes" criterion and D85.
- On reload the sessionStorage flag stays `"true"` while the React state resets: the banner disappears but interception continues. `logout()` does not clear the flag.
- Loose `includes()` route matching returns wrong-shaped stubs for `/sales/lookup/batches` and `/inventory/warehouses/details`.
- Role-track `targetSelector`s are never consumed and 15 of 22 do not exist in the DOM; several `interactiveAction`s never call `notifyAction`; `TourAutoLauncher` overlaps the training banner.

## Scope
- Interceptor: deny-by-default for mutating methods while sandbox is active; exact route matching.
- Session lifecycle: persist active role/step in sessionStorage, restore on mount, clear on logout/exit.
- Simulated handlers for track writes missing today: procurement receiving, transfer request, staff shift scheduling, user creation (plus the list reads those pages need to reflect them).
- Track wiring: `notifyAction` for every `interactiveAction`; spotlight of the current step's `targetSelector`; add missing `data-tour` attributes; suppress page tours during training.

## Out of Scope
- Backend changes, migrations, real SIAT. Read-only GETs not simulated keep reading real data (no pollution).

## Constraints
- Strict TDD (enabled in user CLAUDE.md). Runner: `node --experimental-strip-types --test <files>` (apps/web has no test script; existing tests use `node:test`).
- No commits / no new branches: user commits manually on `Denil` (user memory rule). Work-unit commit step of ODD is replaced by leaving changes uncommitted.
- UI copy in Spanish to match existing app; code/comments in English.

## Tasks
- [x] T1 — Deny-by-default writes: unhandled POST/PUT/PATCH/DELETE in sandbox return a simulated blocked response (never reach `fetch`). Route: delegated.
- [x] T2 — Exact route matching; fix `/sales/lookup/batches` and `/inventory/warehouses/details` stubs. Route: delegated.
- [x] T3 — Lifecycle: restore active track/step after reload; clear flag+state on logout and exit. Route: delegated.
- [x] T4 — Simulated handlers: procurement receiving, transfers request, staff shift, user creation (+ list reads). Route: delegated.
- [x] T5 — `notifyAction` for all track actions (incl. `check_fefo_alerts`). Route: delegated.
- [x] T6 — Spotlight current step `targetSelector`, add missing `data-tour` attributes, suppress `TourAutoLauncher` during training. Route: delegated.

Route evidence: 2+ non-trivial files across interceptor, store, session, context and pages → writer trigger fired; one delegated writer.

## Acceptance Criteria
- Test proves no mutating request reaches `fetch` while sandbox is active.
- Tests for restore-after-reload and logout cleanup at the store/helper level.
- All 5 tracks completable without backend writes; every step highlights an existing element.
- Existing 43 tests still pass; `pnpm --filter @farmaxia/web build` (or typecheck) green.

## Progress / Evidence
- TDD config: strict, runner `node --experimental-strip-types --test` from apps/web (source: user CLAUDE.md).
- T1 RED: `node --experimental-strip-types --test app/lib/sandbox/sandbox-guard.test.ts`: 2 fail (unhandled POST returned handled=false; authenticatedFetch threw SESSION_REQUIRED after trying the real network).
- T1 GREEN: same command: pass 3, fail 0. Blocked response is HTTP 423 + `{code:"SANDBOX_BLOCKED", message}` (423 chosen because inventory.ts parseError rewrites every 409 to a generic text and would hide the message).
- T2 RED: same file after adding batches/details/loose-match tests: pass 4, fail 4.
- T2 GREEN: `node --experimental-strip-types --test app/lib/sandbox/*.test.ts`: pass 15, fail 0. Interceptor now matches normalized routes (prefix `/api[/v1]` and trailing slash stripped) with `===` / anchored regexes; `/sales/lookup/batches` returns `{items:[{batchId,lotCode,expiresOn,availableBase,fefoSuggested}]}`; `/inventory/warehouses/details` returns WarehouseDetail rows computed from the store.
- T3 RED: `node --experimental-strip-types --test app/lib/sandbox/sandbox-session.test.ts app/lib/sandbox/sandbox-guard.test.ts`: module `sandbox-session.ts` not found + logout cleanup test failing (pass 8, fail 2).
- T3 GREEN: `node --experimental-strip-types --test app/lib/sandbox/*.test.ts`: pass 24, fail 0. New `sandbox-session.ts` (save/load/clear/restore/exit helpers over a StorageLike); `logout()` calls `exitSandboxSession`; `SandboxProvider` restores on mount and persists step changes. React wiring itself is not unit-tested (thin).
- T4 RED: `node --experimental-strip-types --test app/lib/sandbox/sandbox-handlers.test.ts`: pass 0, fail 11.
- T4 GREEN: `node --experimental-strip-types --test app/lib/sandbox/*.test.ts`: pass 35, fail 0. Added store collections (suppliers, purchaseOrders, goodsReceipts, warehouses, transfers, staffShifts, roles, permissions, branches, users) + `receiveMockPurchaseOrder`, `requestMockTransfer`, `createMockStaffShift`, `createMockUser`; handlers in `sandbox-handlers.ts`, shared helpers in `sandbox-http.ts`. Simulated reads: procurement suppliers/presentations/purchase-orders/receipts/costs, transfers (lookups, list, detail), staff members/shifts/shifts-me, users/roles/permissions/branches.
- T5 RED: `node --experimental-strip-types --test app/lib/sandbox/sandbox-guard.test.ts app/lib/tours/training-actions.test.ts`: pass 9, fail 3 (horizon filter, /inventory/alerts, missing SUPPORTED_TRAINING_ACTIONS export).
- T5 INTERMEDIATE: after exporting the list and simulating alerts, `training-actions.test.ts` still failed with `no UI call reports the training action "view_orders"` (UI wiring pending).
- T5 GREEN: `node --experimental-strip-types --test` over sandbox/*, tours/*, lib/*.test.ts, components/tours/*.test.ts: pass 78, fail 0. `pnpm --filter @farmaxia/web exec tsc --noEmit`: exit 0. Added `SUPPORTED_TRAINING_ACTIONS` + `TrainingAction` type in role-tracks.ts, `useTrainingViewAction` hook (delayed 4s notify for look-at-the-screen steps), `notifyAction` calls in receiving, transfers, staff roster, users; view hooks in procurement, inventory (view_warehouses, check_fefo_alerts), controlled archive/book, catalog, dashboard, analytics, users branches tab. Context ignores auto-advance for already-passed steps. Seeded batch expiry dates are now relative to today; `expiry-alerts` honours `horizonDays`.
- Known gap: /catalog reads real products (Clonazepam may not exist in a tenant); not simulated.
- T6 RED: `node --experimental-strip-types --test app/lib/tours/training-selectors.test.ts`: 15 track selectors missing from their route sources (cash-open-shift, cash-movements, cash-close-shift, cash-shifts-list, procurement-orders, procurement-receiving-form, inventory-waste-acts-list, catalog-table, controlled-prescriptions-list, controlled-book-table, transfers-list, staff-schedule, users-list, branches-list, analytics-cards); `rectsEqual` export missing in tour-position.test.ts; `sandbox-cash-roles.test.ts` failing on missing `setSandboxUserId`.
- T6 GREEN: `node --experimental-strip-types --test` over sandbox/*, tours/*, lib/*.test.ts, components/tours/*.test.ts: pass 90, fail 0. `pnpm --filter @farmaxia/web exec tsc --noEmit`: exit 0.
- T6 details: all 15 `data-tour` attributes added; `TrainingSpotlight` (non-blocking amber ring, polls for the target, scrolls it into view, only on the step's route); `TourAutoLauncher` skips while training; `/branches` step uses `landingPath: "/users"` (the page redirects to /users?tab=branches). Prerequisite found while wiring `cash-open-shift`: the baseline cash shift was already OPEN so the open-shift form never rendered; sandbox now seeds per role (`purgeSandbox(roleCode)`): cajero = SCHEDULED shift without control, encargado = PENDING_APPROVAL shift with -15.00 difference (also covers the T7 encargado requirement), others = OPEN. Cash routes moved to `sandbox-cash-handlers.ts`; count with a difference now leaves PENDING_APPROVAL and approve closes it. `SandboxProvider` takes `userId` so simulated shifts/staff belong to the signed-in user. alert()/window.confirm left untouched (not trivial to replace without a modal component).
- Known gaps: going Prev from the branches step to /users keeps the branches tab (same route, no remount); approve button depends on the real session having `cash.shift.approve`.

## T7 — Close remaining F21 scope gaps (added by user authorization)
- [x] T7a — Cajero track: step "associate customer + loyalty balance" in /sales (simulate customers search/lookup + points balance; sale confirm records customer and earns points).
- [x] T7b — Cajero track: step "receipt preview 58/80 mm" after the simulated sale (simulate sale-detail GET the receipt needs).
- [x] T7c — Regente: sandbox prescriptions appear in /controlled (list + detail), /controlled/book (rows) and balance; simulate those GETs from store data.
- [x] T7d — Encargado: sandbox starts with a PENDING_APPROVAL shift with a difference (done in T6 prerequisite, covered by sandbox-cash-roles.test.ts).
- [x] T7e — Owner: user created in sandbox appears in /users list (covered by T4 test "created users appear in the users list"; confirm in final check).
- T7 RED: `node --experimental-strip-types --test app/lib/sandbox/sandbox-crm-controlled.test.ts`: pass 0, fail 10; `role-tracks.test.ts` failed on missing `shouldNavigateToStep`/`stepMatchesPath`; after track edits `training-actions.test.ts` ("no UI call reports the training action link_customer") and `training-selectors.test.ts` (pos-receipt-link, receipt-width) failed until the UI was wired.
- T7 GREEN: the 12 test files (sandbox x6, tours x3, lib tours/tour-definitions, tour-position): tests 102, pass 102, fail 0. `pnpm --filter @farmaxia/web exec tsc --noEmit`: exit 0. `pnpm --filter @farmaxia/web build`: exit 0.
- T7 details: simulated GET customers (search by name/doc/phone, accent-insensitive), customer detail, loyalty (+movements), loyalty settings, customer agreements (empty); sale confirm records customer, earns/redeems points (POINTS tender converted at point value; AGREEMENT rejected); GET /sales/sale-demo-N (receipt SaleDetail; other /sales/<x> routes keep reading real data); controlled prescriptions list/detail, book and balance derived from sandbox sales and waste acts; waste-acts list/detail. Cajero track now 8 steps: ... search_product, link_customer, confirm_sale, open_receipt, choose_receipt_width, ... Sales page treats CRM plan features as enabled while training. Receipt page reports open_receipt (view hook) and choose_receipt_width. New pure helpers `stepMatchesPath` / `shouldNavigateToStep` (dynamic `/sales/[saleId]` landing). T7d done in T6 (encargado PENDING_APPROVAL seed). T7e confirmed by sandbox-handlers.test.ts "created users appear in the users list".

## T8 - Restyle training/tour UI without Tailwind
- [x] T8 - apps/web has no Tailwind, so the Tailwind utility classes in `sandbox-banner.tsx`, `role-training-modal.tsx`, `tour-card.tsx`, `tour-overlay.tsx` and `training-spotlight.tsx` did nothing (modal/banner/card rendered as unstyled flow content). Route: inline (CSS + mechanical class swaps; trigger evidence: single concern, one test).
- T8 RED: `node --experimental-strip-types --test app/lib/tours/ui-classes.test.ts` from apps/web: pass 1, fail 1 (Tailwind tokens such as sticky, top-0, z-[9980], md:flex-row, dark:bg-amber-950/70 listed per file).
- T8 GREEN: same command: pass 2, fail 0. New test scans className literals of the 5 components and asserts each token is a selector in globals.css/bento.css/login.css.
- T8 details: semantic classes `ax-training-*` / `ax-tour-*` added as section 9 of `app/bento.css` (where the `ax-` styles live), using global tokens (--surface, --ink, --line, --blue...) so they follow `data-theme`; amber banner palette gets a dark override. Modal: fixed full-viewport backdrop with blur, centered card with internal scroll, 2-col grid (1-col under 640px), z-index 9999. Banner: sticky at top of the page, `SandboxBanner` publishes its height in `--ax-training-banner-h`; desktop shrinks the framed shell by that height, mobile offsets the sticky `.ax-topbar`; z-index 60 so the mobile menu still covers it. Tour card/overlay fixed with inline position kept. Spotlight keeps its inline rect and uses `.ax-training-spotlight`.
- T8 verification: all `*.test.ts` under app: tests 106, pass 106, fail 0. `pnpm --filter @farmaxia/web exec tsc --noEmit`: exit 0. `pnpm --filter @farmaxia/web build`: exit 0. No browser walkthrough performed.

## T9 - Show only training tracks the signed-in user can complete
- [x] T9 - A track is offered only if the user holds the permissions of EVERY page it visits (real permissions, so custom roles work). Route: inline (one pure module + thin wiring; trigger evidence: single concern, 5 small edits).
- T9 RED: `node --experimental-strip-types --test app/lib/tours/track-access.test.ts` from apps/web: module `track-access.ts` not found (pass 0, fail 1).
- T9 GREEN: same command: pass 9, fail 0 (after correcting two wrong test expectations: the owner track only needs users.manage + analytics.read, and test fixtures must pass permission arrays). Full suite: tests 115, pass 115, fail 0. `pnpm --filter @farmaxia/web exec tsc --noEmit`: exit 0. `pnpm --filter @farmaxia/web build`: exit 0.
- T9 details: `app/lib/tours/track-access.ts` (`getAvailableTracks`, `missingPermissionsForTrack`). Route to permission, confirmed from page guards and lib/modules.ts: /cash cash.manage; /sales sales.confirm; /sales/[saleId] sales.read (API); /procurement* and /inventory* inventory.manage; /catalog catalog.manage or sales.confirm (canViewCatalog); /controlled* controlled.read; /transfers transfers.manage; /staff staff.shifts.manage (page itself opens for every member, step schedules shifts); /users and /branches users.manage; /analytics analytics.read; /dashboard none. Action extras: approve_difference needs cash.shift.approve. `restoreSandboxSession(storage, permissions)` exits cleanly if the stored track is no longer allowed; `SandboxProvider` takes `permissions` (from app-shell), waits for them before restoring, refuses `startTraining` for unavailable roles; topbar button hidden when no tracks; modal shows a Spanish empty message.
- T9 result per predefined role (role-templates.ts): Propietario = all 5 (holds every permission); Encargado = cajero, almacenero, regente, encargado; Regente = almacenero, regente; Almacenero = almacenero; Cajero = cajero.
- T9 gaps: plan-feature gating (Premium/Profesional pages such as controlled balances, analytics, staff) is not evaluated because plan features are not in the client session (they load asynchronously in the shell via subscriptionSummary); /dashboard has no guard. Regente cannot get the cajero or encargado tracks (no cash.manage). The Regente track step "dispensacion" needs sales.confirm, which the predefined Regente holds.

## T10 - In-app dialogs and celebration instead of alert()/confirm()
- [x] T10 - Finish alert and exit confirm replaced by in-app alertdialogs (`components/sandbox/training-dialogs.tsx`, state in `SandboxProvider` via reducer `lib/sandbox/training-dialog.ts`). Finish dialog: "Entendido" + CSS-only confetti (`lib/sandbox/confetti.ts` pure seeded generator, 48 pieces, transform/opacity only, layer unmounts after the longest animation, skipped under `prefers-reduced-motion`). Exit dialog: "Cancelar" (initial focus) / "Salir y borrar datos" (danger). Escape = cancel/close, Tab trapped, focus restored. Route: inline (single concern).
- T10 RED: `node --experimental-strip-types --test app/lib/sandbox/confetti.test.ts app/lib/sandbox/training-dialog.test.ts`: tests 2, pass 0, fail 2 (modules not found). `ui-classes.test.ts` with the new component listed: pass 1, fail 1 (classes without CSS).
- T10 GREEN: confetti + dialog reducer tests pass 7/7; classes added to `bento.css` (section 9, before the tour block); ui-classes pass.

## T11 - Page tours relaunching after training
- [x] T11 - ROOT CAUSE: (1) `skip()` in `tour-context.tsx` never persisted anything (only completing wrote the storage key), so a dismissed tour auto-launched again on every visit; (2) `TourAutoLauncher` has an effect keyed on `isSandboxActive`+`pathname`: when training ended it re-ran and, as tours are suppressed (never recorded) during training, fired the page tour immediately, in the same moment as the finish dialog and the redirect to /dashboard. Exit/purge does not touch localStorage or the tour key.
- T11 RED: `node --experimental-strip-types --test app/lib/tours/auto-launch.test.ts`: tests 1, pass 0, fail 1 (module `auto-launch.ts` missing).
- T11 GREEN: same file pass 6/6. `lib/tours/auto-launch.ts`: `recordTourClosed` (used by complete AND skip), `shouldAutoLaunchTour`, `stepAutoLaunchGate` (blocks while training, then on the page where it ended plus /dashboard until the next real navigation); wired in `TourAutoLauncher` (ref) and `tour-context.tsx`.
- Verification: all `*.test.ts` under app: tests 128, pass 128, fail 0. `tsc --noEmit`: exit 0. `pnpm --filter @farmaxia/web build`: succeeded. No browser walkthrough.

## Final verification (2026-10-22)
- `node --experimental-strip-types --test <12 test files>` from apps/web: tests 102, pass 102, fail 0.
- `pnpm --filter @farmaxia/web exec tsc --noEmit`: exit 0.
- `pnpm --filter @farmaxia/web build`: exit 0.
- Nothing committed (user commits manually).

## Open gaps (not blocking)
- Real tenant data still read for catalog (Clonazepam may not exist), dashboard KPIs, analytics, controlled book CSV export, subscription/plan.
- Approve button needs the real session to hold `cash.shift.approve`; CRM picker needs nothing (forced on in training).
- Prev from branches step to Users keeps the branches tab (same route); (alert/confirm replaced in T10).
- No browser walkthrough was performed (no UI test harness); UI wiring is covered by static source tests + typecheck + build.

## Next Step
User review and manual commit; optional browser walkthrough of the 5 tracks.

## T10 follow-up — finish dialog was never wired (user report 2026-10-22)
- Cause: `nextStep` in `sandbox-context.tsx` still called `alert()`; the `finish` dialog action was never dispatched.
- RED: `node --experimental-strip-types --test app/lib/sandbox/no-browser-dialogs.test.ts`: pass 0, fail 1 (offender `sandbox-context.tsx`).
- GREEN: dispatch `{ type: "finish", roleTitle }` before `exitTraining()`. All web tests: tests 129, pass 129, fail 0. `tsc --noEmit`: exit 0.
