# ODD Feature: F20 — Interactive Product Tours & Guided Walkthroughs

## Objective
Provide an integrated, lightweight interactive tour engine and guided step-by-step product walkthroughs across the core web application (`apps/web`) to onboard users, explain POS operations, and guide inventory/cash management without third-party runtime bloat.

## Problem / Why
FARMAXIA now has all core functional modules (0 to 12) implemented (~91% complete), but complex workflows like POS counter shortcuts, FEFO batch selection, split payments, cash movement controls, and warehouse alerts require immediate user orientation. External tour libraries (e.g., legacy Joyride/IntroJS) conflict with React 19 (`react@19.2.4`) and introduce bundle overhead. A clean, native React 19 engine aligned with the Bento design system solves this cleanly.

## Scope
- **Tour Engine Core (`apps/web/app/components/tours/`)**:
  - `TourProvider` and `useTour` context for step registration, active tour state, current step, next/prev, skip, and complete.
  - SVG spotlight cutout overlay (`TourOverlay`) calculating bounding rectangles dynamically with smooth transitions, backdrop blur/dim, and click-blocker.
  - Floating tour tooltip card (`TourCard`) with progress indicator (e.g., "Paso 2 de 5"), title, description, badge, navigation buttons, and close button.
  - Viewport-aware boundary detection (top, bottom, left, right, auto-scroll to element).
- **Tour State & Persistence (`apps/web/app/lib/tours.ts`)**:
  - `localStorage` tracking per user and tenant (`farmaxia_tours_<tenantId>_<userId>`).
  - Automatic launch on first visit for uncompleted tours.
  - Safe replay support: "Ayuda / Iniciar tutorial" trigger in top navigation and page headers.
- **Walkthrough Definitions (`apps/web/app/lib/tour-definitions.ts`)**:
  - **T-POS (`pos-counter`)**:
    1. Search bar & barcode reader (focus on F2 shortcut, scanner input).
    2. Customer selection & loyalty points / agreements indicator.
    3. Cart items, FEFO presentation conversion, and manual lot override.
    4. Quick actions (Quotes/Proformas, Petty Cash movements, Sales History).
    5. Multi-tender payment drawer (Cash, Card, QR, Points) and finalization (F4 / F9).
  - **T-DASH (`dashboard-welcome`)**:
    1. Executive KPI cards (Today's revenue, transactions, low stock / expiry alerts).
    2. Bento module navigation (Sales, Inventory, Procurement, Staff, etc.).
    3. Active branch indicator & shift status.
    4. SaaS plan quota card (branch, register, user limits).
  - **T-INV (`inventory-overview`)**:
    1. Warehouse & filter controls (Central, Quarantine, Cold-chain).
    2. FEFO expiry alerts traffic light (7, 30, 90 days).
    3. Batch actions: Quarantine, release, and waste act generation.
    4. Blind physical count audits & global multi-branch stock report.
- **Accessibility & UX**:
  - Keyboard shortcuts: `Escape` to dismiss/skip, `ArrowRight`/`Enter` to advance, `ArrowLeft` for previous.
  - Clean focus trapping and ARIA roles (`role="dialog"`, `aria-modal="true"`, `aria-label`).

## Out of Scope
- Backend persistence of tour states via DB migrations (keep client-side in `localStorage` for latency and simplicity per D84).
- Video tutorials or interactive simulators requiring fake backend sandbox records.
- SIAT fiscal step tours (blocked on D03 credentials).

## Provisional Decisions
- **D84**: Client-side tour engine implemented natively in React 19 without third-party dependencies, persisting completed status in `localStorage` scoped by `tenantId` and `userId`.

## Constraints
- Strict TDD for core state management, step progression, and persistence helpers.
- React 19 compatibility (`apps/web/package.json` uses `react: 19.2.4`, `next: 16.3.5`).
- English for code, comments, identifiers; Spanish for user-facing copy and tooltips.
- Visual styling must integrate with `apps/web/app/bento.css` and support dark/light theme switching without visual artifacts.

## TDD
- State/utility unit tests: Node native test runner (`node --experimental-strip-types --test`) or Vitest web suite.
- Verification checks: `pnpm --filter @farmaxia/web exec tsc --noEmit` and `pnpm --filter @farmaxia/web build`.

## Checklist
- [x] **T1 — Core Tour State Machine & Persistence (`apps/web/app/lib/tours.ts` + tests)**:
  - Implement tour registry, completion status storage, replay logic, and unit tests.
- [x] **T2 — Tour Engine UI Components (`apps/web/app/components/tours/`)**:
  - Build `TourProvider`, `TourOverlay`, spotlight bounding box calculator, and Bento-styled `TourCard`.
  - Add keyboard navigation, resize observer, and auto-scroll behavior.
- [x] **T3 — Walkthrough Definitions (`apps/web/app/lib/tour-definitions.ts`)**:
  - Register concrete step sequences for `dashboard-welcome`, `pos-counter`, and `inventory-overview`.
- [x] **T4 — Integration into App Shell & Target Views**:
  - Wrap `AppShellGate` with `TourProvider`.
  - Add `data-tour` anchors in `/dashboard`, `/sales`, and `/inventory`.
  - Add help / tour replay trigger button in top navigation bar.
- [x] **T5 — Verification, Typecheck, and Web Production Build**:
  - Run web tests, verify zero hydration mismatch, test theme switching (dark/light), and verify full Next.js production build.
- [x] **T6 — Documentation & Status Sync**:
  - Update `ESTADO_FUNCIONALIDADES.md` and `REGISTRO_DECISIONES.md` (record D84).

## Progress and evidence

### Task T1: Core Tour State Machine & Persistence
- **RED Stage**:
  - Test file: `apps/web/app/lib/tours.test.ts`
  - Command: `node --experimental-strip-types --test apps/web/app/lib/tours.test.ts`
  - Result: Failed with `ERR_MODULE_NOT_FOUND` as `apps/web/app/lib/tours.ts` was not yet implemented.
- **GREEN Stage**:
  - Implemented: `apps/web/app/lib/tours.ts` with types (`TourStep`, `TourDefinition`, `TourState`, `TourStorage`), pure transitions (`createInitialTourState`, `nextTourStep`, `prevTourStep`, `skipTour`, `completeTour`, `progressPercentage`), and scoped storage persistence (`getTourStorageKey`, `isTourCompleted`, `markTourCompleted`, `resetTourProgress`, `getBrowserStorage`) including safe exception handling for private browsing/quota errors.
  - Command: `node --experimental-strip-types --test apps/web/app/lib/tours.test.ts`
  - Result: 13/13 tests passed.
- **Typecheck**:
  - Command: `corepack pnpm --filter @farmaxia/web exec tsc --noEmit`
  - Result: Clean exit code 0 (zero errors).

### Task T2: Tour Engine UI Components
- **RED Stage**:
  - Test file: `apps/web/app/components/tours/tour-position.test.ts`
  - Command: `node --experimental-strip-types --test apps/web/app/components/tours/tour-position.test.ts`
  - Result: Failed with `ERR_MODULE_NOT_FOUND` as `tour-position.ts` was not yet implemented.
- **GREEN Stage**:
  - Implemented:
    - `tour-position.ts`: Pure positioning functions (`calculateTargetRect`, `calculatePopoverPosition`, viewport margins, and directional flipping).
    - `tour-context.tsx`: `TourProvider` & `useTour()` with step advancement, target DOM query, `ResizeObserver`, smooth auto-scrolling, and keyboard shortcuts (`Escape`, `Enter`, `ArrowRight`, `ArrowLeft`).
    - `tour-overlay.tsx`: SVG spotlight cutout overlay with accent border and interaction blocker.
    - `tour-card.tsx`: Bento floating tooltip card with step badges, progress indicator, Spanish copy, dark/light theme compatibility, and action buttons.
    - `index.ts`: Barrel export.
  - Command: `node --experimental-strip-types --test apps/web/app/components/tours/tour-position.test.ts`
  - Result: 10/10 tests passed.
- **Typecheck**:
  - Command: `corepack pnpm --filter @farmaxia/web exec tsc --noEmit`
  - Result: Clean exit code 0 (zero errors across `@farmaxia/web`).

### Task T3: Walkthrough Definitions
- **RED Stage**:
  - Test file: `apps/web/app/lib/tour-definitions.test.ts`
  - Command: `node --experimental-strip-types --test apps/web/app/lib/tour-definitions.test.ts`
  - Result: Failed with `ERR_MODULE_NOT_FOUND` as `tour-definitions.ts` was not yet implemented.
- **GREEN Stage**:
  - Implemented `apps/web/app/lib/tour-definitions.ts` registering walkthrough definitions for:
    - `dashboard-welcome`: Executive KPIs, module navigation, branch/shift status, and SaaS plan quotas.
    - `pos-counter`: Search & barcode scanner (F2), customer selection & loyalty points, cart & FEFO lot selection, quick actions (proformas/cash/history), and tender drawer (F4/F9).
    - `inventory-overview`: Warehouses selector, FEFO expiry alert traffic light (7/30/90 days), batch operations (quarantine/waste), and blind count audits / reports.
    - Helper `getTourForPathname(pathname)` for route-based tour lookup.
  - Command: `node --experimental-strip-types --test apps/web/app/lib/tour-definitions.test.ts`
  - Result: 5/5 tests passed.

### Task T4: Integration into App Shell & Target Views
- **App Shell Integration**:
  - Integrated `TourProvider` into `apps/web/app/components/app-shell.tsx` wrapping all tenant routes with tenant & user scoping.
  - Added `TourAutoLauncher` for auto-launching uncompleted tours on first visit.
  - Added `TourTriggerButton` with help icon in top navigation bar for on-demand replay.
  - Added `data-tour="dashboard-modules"`, `data-tour="shell-branch-status"`, and `data-tour="shell-plan-card"` to shell elements.
- **Target Anchors Added**:
  - `apps/web/app/components/dashboard-shell.tsx`: `data-tour="dashboard-kpis"`.
  - `apps/web/app/sales/page.tsx` & `apps/web/app/components/sales-nav.tsx`: `data-tour="pos-search"`, `data-tour="pos-customer"`, `data-tour="pos-cart"`, `data-tour="pos-quick-actions"`, `data-tour="pos-tender"`.
  - `apps/web/app/inventory/page.tsx` & `apps/web/app/components/inventory-nav.tsx`: `data-tour="inventory-warehouses"`, `data-tour="inventory-expiry-alerts"`, `data-tour="inventory-actions"`, `data-tour="inventory-audit-report"`.

### Task T5: Verification & Production Web Build
- **Unit Tests**:
  - Command: `node --experimental-strip-types --test apps/web/app/lib/tours.test.ts apps/web/app/components/tours/tour-position.test.ts apps/web/app/lib/tour-definitions.test.ts`
  - Result: 28/28 tests passed across 3 test suites (0 failures).
- **TypeScript Typecheck**:
  - Command: `corepack pnpm --filter @farmaxia/web exec tsc --noEmit`
  - Result: Clean exit code 0 (zero errors).
- **Production Next.js Build**:
  - Command: `corepack pnpm --filter @farmaxia/web build`
  - Result: Successful Turbopack production build; all 50/50 routes compiled and generated cleanly without errors.

### Task T6: Documentation & Status Sync
- Recorded decision **D84** in `REGISTRO_DECISIONES.md` (native React 19 interactive tours engine with SVG spotlight, Bento styling, and localStorage persistence).
- Updated `ESTADO_FUNCIONALIDADES.md` documenting F20 feature capabilities and walkthrough definitions.
- Updated `odd/tasks/f20-interactive-product-tours.md` marking all tasks completed with full verification evidence.

## Route Declaration
- Route: Delegated direct implementation per unit of work.
- Trigger evidence: Spans multiple web components, layout shell, page targets, state management, and tests.

## Acceptance Criteria
- Starting `/dashboard`, `/sales`, or `/inventory` triggers the corresponding tour on first visit (or manually via the help button).
- Target elements are highlighted with high-contrast spotlight overlay; background clicks outside the tooltip are intercepted safely.
- Tour can be skipped at any step or completed with keyboard or mouse.
- Completed status is saved in `localStorage` and not re-shown automatically.
- Web TypeScript check and `pnpm --filter @farmaxia/web build` pass with zero errors.
