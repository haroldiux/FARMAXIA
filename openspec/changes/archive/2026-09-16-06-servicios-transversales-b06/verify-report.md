```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:7725b3af3369be8801396b27ec00a3aa971ec3049c7430163e55bba582c0e2f6
verdict: pass
blockers: 0
critical_findings: 0
requirements: 4/4
scenarios: 8/8
test_command: corepack pnpm --filter @farmaxia/api test
test_exit_code: 0
test_output_hash: sha256:cc7996fddf806ef5b3e425f32378344d0f29d014fa868a2ff73ef773e9fd8e4b
build_command: corepack pnpm --filter @farmaxia/api build
build_exit_code: 0
build_output_hash: sha256:d8a8507f227817cac3db785806843553f0e17b7935a281a48f432ff2e41fe482
```

# Verification Report: B06 Servicios Transversales Confiables

**Change:** `06-servicios-transversales-b06`  
**Status:** PASSED  
**Date:** 2026-09-16  

## Summary

All 4 requirements (S19–S22) and 8 acceptance scenarios have been implemented and verified with automated integration tests against real PostgreSQL 18 with RLS enabled.

| Requirement | Description | Scenarios | Status |
|-------------|-------------|-----------|--------|
| **S19** | Auditoría de solo anexado e inmutabilidad | S19.1, S19.2 | PASSED |
| **S20** | Idempotencia de confirmaciones con SHA-256 | S20.1, S20.2, S20.3 | PASSED |
| **S21** | Outbox durable sin efectos externos | S21.1 | PASSED |
| **S22** | Secuencias documentales internas atómicas | S22.1, S22.2 | PASSED |

## Verification Details

### S19 — Auditoría Inmutable
- **S19.1 (Inserción válida):** `AuditService.recordInTransaction` persistió el evento ligado al tenant, branch y actor del contexto seguro transaccional.
- **S19.2 (Inmutabilidad estricta):** El trigger PostgreSQL `trg_audit_events_immutable` abortó y rechazó con excepción cualquier `UPDATE` o `DELETE`.

### S20 — Idempotencia
- **S20.1 (Primera ejecución):** Ejecutó la mutación, guardó la clave, el hash canónico SHA-256 y la respuesta.
- **S20.2 (Reintento idéntico):** Devolvió exactamente el resultado original sin re-ejecutar efectos.
- **S20.3 (Conflicto de payload):** Detectó discrepancia de hash y arrojó `IdempotencyKeyReusedError` (HTTP 409).

### S21 — Outbox Durable
- **S21.1 (Encolado atómico):** Encoló eventos con estado `PENDING` dentro de la transacción de dominio; verificado rollback completo si la transacción falla.

### S22 — Secuencias Documentales
- **S22.1 (Asignación correlativa):** Incremento correlativo estricto por sucursal y tipo documental.
- **S22.2 (Concurrencia):** Bloqueo a nivel de fila `ON CONFLICT DO UPDATE RETURNING` probado con 5 a 8 peticiones concurrentes sin colisiones ni saltos.

## Test Execution Results

- `pnpm --filter @farmaxia/api test`: 8 suites, 22 tests passing.
- `tsc --noEmit`: 0 errors in `@farmaxia/api` y `@farmaxia/web`.
- `drizzle-kit check`: schema and migrations completely consistent.
- `pnpm build`: production builds for API and Web passed.
