# ODD Feature: F21 — Role-Based Interactive Training & Client Sandbox Mode

## Objective
Provide a fully interactive, role-based training mode ("Modo Entrenamiento") across FARMAXIA's 5 core roles (Cajero, Almacenero, Regente, Encargado, Propietario). Users can execute end-to-end operational workflows hands-on, with automatic interception and complete client-side data purging upon completion, ensuring zero pollution of production tables, immutable audit logs, or financial balances.

## Problem / Why
Static tooltips explain what buttons do, but real pharmacy training requires hands-on practice (opening shifts, scanning barcodes, entering doctor prescription numbers, confirming mock sales, and closing registers). Because FARMAXIA enforces immutable PostgreSQL audit logs (`audit_logs`) and financial triggers, training data cannot simply be inserted into the production database and deleted later. A client-side sandbox interceptor allows full realistic interaction with instantaneous zero-trace cleanup.

## Scope
- **Client Sandbox Interceptor (`apps/web/app/lib/sandbox/`)**:
  - `SandboxContext`, `SandboxProvider`, and `useSandbox()` hook.
  - In-memory ephemeral mock state (`SandboxStore`) for:
    - Active shift / cash register (`OPEN`, initial fund BOB 200).
    - Mock products and inventory batches with FEFO dates.
    - Completed sales, receipts, and cash movements.
    - Prescriptions and AGEMED book records.
    - Procurement orders and receiving vouchers.
  - Intercepting fetch wrapper: when `isSandbox: true`, mutating endpoints (`POST`, `PUT`, `PATCH`, `DELETE`) and simulation reads route to `SandboxStore` instead of backend API.
  - Sandbox banner in `AppShell`: prominent indicator ("Modo Entrenamiento Activo · Datos de prueba aislados") with a 1-click "Salir del entrenamiento" button that purges the sandbox memory.
- **Role-Based Training Tracks (`apps/web/app/lib/tours/role-tracks.ts`)**:
  - **1. Cajero (POS & Caja)**:
    1. Abrir turno con fondo inicial en `/cash`.
    2. Buscar producto con lector o `F2` en `/sales`.
    3. Asociar cliente y verificar saldo de puntos de fidelización.
    4. Cobro simulado (Efectivo/QR) y previsualización de recibo térmico 58/80 mm.
    5. Registrar movimiento menor de caja (egreso con motivo).
    6. Conteo ciego y cierre de turno con cálculo de diferencia.
  - **2. Almacenero (Recepción & Almacenes)**:
    1. Ver órdenes de compra en `/procurement`.
    2. Simular recepción con ingreso de lote y fecha de vencimiento.
    3. Inspeccionar alertas de semáforo FEFO en `/inventory`.
    4. Enviar un lote a cuarentena por daño de embalaje.
    5. Generar acta de baja numerada en `/inventory/waste-acts`.
  - **3. Regente Farmacéutico (Controlados & AGEMED)**:
    1. Ficha sanitaria y marcas de psicotrópicos en `/catalog`.
    2. Simular venta de controlado con validación estricta de receta médica en `/sales`.
    3. Archivo oficial de recetas foliadas en `/controlled`.
    4. Revisión del libro digital foliado y balance mensual en `/controlled/book`.
  - **4. Encargado de Sucursal (Operaciones & Traspasos)**:
    1. Solicitar mercadería al almacén central en `/transfers`.
    2. Calendario semanal de turnos de personal en `/staff`.
    3. Supervisar y aprobar arqueo de caja con diferencias en `/cash`.
  - **5. Propietario (Gestión Global & SaaS)**:
    1. Lectura de KPIs del negocio en `/dashboard`.
    2. Alta de usuario y asignación de sucursales respetando cuotas en `/users`.
    3. Sucursales activas y límites del plan en `/branches`.
    4. Rentabilidad por producto y matriz ABC en `/analytics`.
- **Auto-Cleanup & Teardown**:
  - Exiting or finishing the track automatically purges all simulated sales, shifts, and batches from memory.
  - Displays summary modal: "¡Entrenamiento finalizado! Todos los datos de prueba han sido eliminados de la sesión."

## Out of Scope
- Backend database schema changes or migrations (pure client-side sandbox architecture per D85).
- Real integration with SIN SIAT servers during training.

## Provisional Decisions
- **D85**: Modo Entrenamiento / Sandbox implementado como interceptor en memoria del frontend; aísla completamente las mutaciones de la base de datos real, respetando la inmutabilidad de `audit_logs` y purga el estado al concluir el tutorial.

## Constraints
- Strict TDD for sandbox store, request interceptor, and role-track state transitions.
- React 19 and Next.js 16 compatible.
- English for code, identifiers, and comments; professional Spanish for UI text and training steps.
- Clean Bento styling for the Sandbox banner and launcher modal.

## Checklist
- [x] **T1 — In-Memory Sandbox Store & Interceptor (`apps/web/app/lib/sandbox/` + tests)**:
  - Implement `SandboxStore` (shifts, sales, batches, mock seed data).
  - Implement fetch interceptor / client routing for sandbox mode.
  - Unit tests for mock mutations and memory purge (`node --test`).
- [x] **T2 — Role-Based Training Tracks Definition (`apps/web/app/lib/tours/role-tracks.ts` + tests)**:
  - Register concrete multi-step operational training flows for the 5 roles.
  - Unit tests validating step sequences, paths, and sandbox action triggers.
- [x] **T3 — UI Training Launcher & Sandbox Banner Component**:
  - Modal selector: "Elegir rol para iniciar entrenamiento práctico".
  - Persistent visual banner during training mode with clean "Finalizar y borrar datos" button.
- [x] **T4 — View Integrations & Interactive Step Triggers**:
  - Connect sandbox store to POS cart, Cash shift, and Procurement simulated views.
  - Automatic advance when the required interactive action is executed.
- [x] **T5 — Full Verification, Typecheck, and Production Build**:
  - Run all unit tests, typecheck (`tsc --noEmit`), and production build (`next build`).
- [x] **T6 — Documentation & Decision Ledger**:
  - Record D85 in `REGISTRO_DECISIONES.md` and update `ESTADO_FUNCIONALIDADES.md`.

## Progress and evidence

### Task T1: In-Memory Sandbox Store & Interceptor
- **RED Stage**:
  - Test file: `apps/web/app/lib/sandbox/sandbox-store.test.ts`
  - Command: `node --experimental-strip-types --test apps/web/app/lib/sandbox/sandbox-store.test.ts`
  - Result: Failed with `ERR_MODULE_NOT_FOUND` as `sandbox-store.ts` was not yet implemented.
- **GREEN Stage**:
  - Implemented `sandbox-store.ts` with ephemeral state container, seed data (Paracetamol, Amoxicilina, controlled Clonazepam with mandatory prescription validation, Ibuprofeno), cash shift lifecycle (`openCashShift`, `addCashMovement`, `closeCashShift` with discrepancy arithmetic), sales confirmation (`confirmMockSale` with `V-DEMO-0001` format, FEFO batch stock reduction, mixed payment tracking), inventory actions (`quarantineMockBatch`, `releaseMockBatch`, `recordMockWaste` with `AB-DEMO-0001`), and zero-trace teardown (`purgeSandbox()`).
  - Implemented `sandbox-interceptor.ts` with `handleSandboxRequest(url, init)` routing simulated API requests to in-memory store.
  - Command: `node --experimental-strip-types --test apps/web/app/lib/sandbox/sandbox-store.test.ts`
  - Result: 7/7 tests passed.
- **Typecheck**:
  - Command: `corepack pnpm --filter @farmaxia/web exec tsc --noEmit`
  - Result: Clean exit code 0 (zero errors).

### Task T2: Role-Based Training Tracks Definition
- **RED Stage**:
  - Test file: `apps/web/app/lib/tours/role-tracks.test.ts`
  - Command: `node --experimental-strip-types --test apps/web/app/lib/tours/role-tracks.test.ts`
  - Result: Failed with `ERR_MODULE_NOT_FOUND` as `role-tracks.ts` was not yet created.
- **GREEN Stage**:
  - Implemented `apps/web/app/lib/tours/role-tracks.ts` with 5 structured training tracks:
    - `cajeroTrainingTrack`: POS and cash drawer lifecycle (open shift, F2 search, mixed tender F4/F9, cash movement, shift close with count difference).
    - `almaceneroTrainingTrack`: Logistics & FEFO (procurement orders list, batch receiving with expiry, FEFO alerts, quarantine isolation, waste acts).
    - `regenteTrainingTrack`: AGEMED & controlled drugs (sanitary profile in catalog, controlled sale with mandatory doctor/patient prescription validation, prescription archive, digital book balance).
    - `encargadoTrainingTrack`: Branch oversight (inter-branch transfers, staff scheduling, cash shift discrepancy approval, warehouse monitoring).
    - `ownerTrainingTrack`: Executive administration (KPIs, SaaS quota checks, branch limits, ABC matrix and margin analytics).
    - Route/role resolver: `getTrainingTrackForRole(roleCode)` with alias normalization ("owner" / "propietario").
  - Command: `node --experimental-strip-types --test apps/web/app/lib/tours/role-tracks.test.ts`
  - Result: 8/8 tests passed (43/43 tests passing across the web suite).
- **Typecheck**:
  - Command: `corepack pnpm --filter @farmaxia/web exec tsc --noEmit`
  - Result: Clean exit code 0 (zero errors).

### Task T3: UI Training Launcher & Sandbox Banner Component
- Implemented `apps/web/app/components/sandbox/sandbox-context.tsx`:
  - `SandboxProvider` maintaining active role track, current step index, modal visibility, and `sessionStorage` sandbox active flag.
  - Exposes `useSandbox()` hook with safe fallback defaults when accessed outside provider.
  - Implements step navigation (`nextStep`, `prevStep`), reactive action dispatcher (`notifyAction`), and zero-trace teardown (`exitTraining`).
- Implemented `apps/web/app/components/sandbox/sandbox-banner.tsx`:
  - Prominent sticky top banner styled in Bento glassmorphism.
  - Displays current training track title, role badge, sequential step indicator, and operational guidance prompt.
  - Provides a 1-click "Salir y purgar datos" button that clears all in-memory mock mutations and returns the user to the main dashboard.
- Implemented `apps/web/app/components/sandbox/role-training-modal.tsx`:
  - Bento modal overlay displaying all 5 core pharmacy roles with estimated durations and target competencies.
  - One-click launcher initializing selected track and routing to the first required view.
- Implemented `apps/web/app/components/sandbox/index.ts` barrel export.

### Task T4: View Integrations & Interactive Step Triggers
- Integrated into `apps/web/app/components/app-shell.tsx`:
  - Wrapped `TourProvider` children with `<SandboxProvider>`.
  - Mounted `<SandboxBanner />` and `<RoleTrainingModal />`.
  - Added `RoleTrainingTriggerButton` in the topbar right action group (using `NavIcon name="users"`).
- Integrated fetch interception in `apps/web/app/lib/session.ts`:
  - In `authenticatedFetch`, checks `window.sessionStorage.getItem("farmaxia.sandbox_active") === "true"`.
  - Transparently intercepts and routes simulated requests to `handleSandboxRequest(path, init)`.
  - Returns mock Web API `Response` objects for sales lookup, sales confirmation, cash shifts, cash movements, expiry alerts, batch quarantine, and waste acts without any calls hitting the PostgreSQL backend.
- Integrated interactive step triggers (`notifyAction`) across core views:
  - `apps/web/app/sales/page.tsx`:
    - `notifyAction("search_product")` on product search lookup completion.
    - `notifyAction("confirm_sale")` on successful mock sale confirmation.
    - `notifyAction("submit_prescription")` on controlled medicine prescription submission.
  - `apps/web/app/cash/page.tsx`:
    - `notifyAction("open_shift")` on cash drawer opening.
    - `notifyAction("close_shift")` on blind cash count entry.
    - `notifyAction("approve_difference")` on cash difference approval.
  - `apps/web/app/components/cash-movements-panel.tsx`:
    - `notifyAction("record_movement")` on registering petty cash movement.
  - `apps/web/app/inventory/page.tsx`:
    - `notifyAction("check_fefo_alerts")` on FEFO expiry alerts inspection.
    - `notifyAction("quarantine_batch")` on sending batch to quarantine.
    - `notifyAction("create_waste_act")` on official waste act generation.

### Task T5: Full Verification, Typecheck, and Production Build
- **Unit Test Suites (5 suites / 43 tests)**:
  - Command: `node --experimental-strip-types --test apps/web/app/lib/tours.test.ts apps/web/app/components/tours/tour-position.test.ts apps/web/app/lib/tour-definitions.test.ts apps/web/app/lib/sandbox/sandbox-store.test.ts apps/web/app/lib/tours/role-tracks.test.ts`
  - Result: 43/43 tests passed (0 failures, 166ms duration).
- **TypeScript Static Verification**:
  - Command: `corepack pnpm --filter @farmaxia/web exec tsc --noEmit`
  - Result: Clean exit code 0 (zero errors).
- **Next.js Production Build**:
  - Command: `corepack pnpm --filter @farmaxia/web build`
  - Result: Compiled successfully in 844ms, all 50 static/dynamic routes generated cleanly.

### Task T6: Documentation & Decision Ledger
- Recorded **D85** in `REGISTRO_DECISIONES.md` documenting the client-side in-memory sandbox architecture.
- Updated `ESTADO_FUNCIONALIDADES.md` with the interactive role training and sandbox mode section.
- Fully verified and completed all tasks in `odd/tasks/f21-role-training-sandbox.md`.

## Route Declaration
- Route: Delegated direct implementation per unit of work via `odd-worker`.

## Acceptance Criteria
- Starting a role training enters Sandbox mode without refreshing the session.
- User can open shifts, scan products, enter prescriptions, and confirm sales without hitting PostgreSQL.
- Exiting or completing the tutorial clears all mock data with 0 orphaned records in production.
- Full test suites and `pnpm --filter @farmaxia/web build` pass cleanly.
