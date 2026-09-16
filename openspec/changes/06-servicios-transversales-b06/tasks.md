# Tasks: B06 Servicios Transversales Confiables

## Phase 1: Database Schema & Migrations

- [ ] 1.1 Add schema definitions for `audit_events`, `idempotency_records`, `outbox_events`, and `document_sequences` in `apps/api/src/database/schema.ts`
- [ ] 1.2 Create Drizzle migration `0005_transversal_services.sql` with composite FKs, RLS policies, table privileges for `farmaxia_app`, and immutable audit trigger
- [ ] 1.3 Apply migration to PostgreSQL test database and verify with `drizzle-kit check`

## Phase 2: Transversal Services Implementation

- [ ] 2.1 Implement `AuditService` with transactional append-only recording
- [ ] 2.2 Implement `IdempotencyService` with canonical payload SHA-256 hashing and conflict detection
- [ ] 2.3 Implement `OutboxService` with transactional event enqueuing in `PENDING` state
- [ ] 2.4 Implement `DocumentSequenceService` with atomic `ON CONFLICT DO UPDATE RETURNING` sequence generation

## Phase 3: Integration Testing & Verification

- [ ] 3.1 Write red tests in `apps/api/test/transversal-services.spec.ts` for immutable audit, idempotency hit/conflict, outbox, and concurrent sequences
- [ ] 3.2 Run test suite to verify green state against real PostgreSQL container
- [ ] 3.3 Verify RLS boundary enforcement and immutability violation rejection
- [ ] 3.4 Update implementation status in `ESTADO_IMPLEMENTACION.md` and save state to Engram
