# Proposal: B06 — Servicios Transversales Confiables

## Intent

Proporcionar los componentes transversales que protegen todas las mutaciones de dominio de FARMAXIA (ventas, inventario, caja y comprobantes):
1. **Auditoría inmutable de solo anexado** para trazabilidad regulatoria y de seguridad.
2. **Idempotencia transaccional** para evitar cobros dobles o descuentos de stock duplicados por fallos de red o reintentos del cliente.
3. **Outbox durable** para desacoplar transacciones de base de datos de efectos secundarios asíncronos (SIAT, notificaciones, sincronización) sin perder eventos.
4. **Secuencias documentales internas** atómicas por sucursal y tipo de documento para numeración comercial correlativa sin colisiones bajo concurrencia.

## Scope

### In Scope
- Schema Drizzle y migración PostgreSQL con RLS para:
  - `audit_events` (con trigger de inmutabilidad que rechaza `UPDATE` y `DELETE`).
  - `idempotency_records` (con unicidad por tenant, operación y clave, guardando hash del payload y respuesta).
  - `outbox_events` (con estado `PENDING`, reintentos y payload tipado).
  - `document_sequences` (con asignación atómica de números mediante `ON CONFLICT DO UPDATE RETURNING`).
- Servicios transaccionales en NestJS integrados con `TenantDatabase.withScope`:
  - `AuditService`
  - `IdempotencyService`
  - `OutboxService`
  - `DocumentSequenceService`
- Pruebas unitarias e integración en Vitest contra PostgreSQL real en Docker Compose validando RLS, inmutabilidad, idempotencia y concurrencia.

### Out of Scope
- Procesamiento de background workers o polling del outbox (se implementará en módulo de workers posterior).
- Integración real con SIAT o pasarelas de pago.
- Expiración o purga de registros de auditoría (D12 pendiente de definición regulatoria).

## Approach

Implementar schema y migraciones SQL explícitas que fortalezcan RLS sobre el rol `farmaxia_app`. Los servicios se consumirán exclusivamente dentro del contexto de `TenantDatabase.withScope`, garantizando que `app.tenant_id`, `app.user_id` y `app.branch_id` gobiernen cada inserción.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/api/src/database/schema.ts` | Modified | Nuevas tablas `audit_events`, `idempotency_records`, `outbox_events`, `document_sequences` |
| `apps/api/drizzle/0005_transversal_services.sql` | New | Migración SQL con tablas, RLS, triggers y privilegios |
| `apps/api/src/transversal/*` | New | Servicios `AuditService`, `IdempotencyService`, `OutboxService`, `DocumentSequenceService` |
| `apps/api/test/transversal.spec.ts` | New | Pruebas de integración con PostgreSQL real |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Colisión de concurrencia en secuencias | Media | Uso de `INSERT ... ON CONFLICT (tenant_id, branch_id, document_type) DO UPDATE SET current_number = document_sequences.current_number + 1 RETURNING current_number` con bloqueo de fila en PostgreSQL |
| Reuso de Idempotency-Key con payload distinto | Alta | Cálculo de SHA-256 sobre payload normalizado canónicamente; rechazar con `IDEMPOTENCY_KEY_REUSED` si no coincide |
| Mutación o borrado de eventos de auditoría | Baja | Trigger PostgreSQL a nivel de tabla que eleva excepción en cualquier `BEFORE UPDATE OR DELETE` |

## Rollback Plan

Revertir la migración 0005 en PostgreSQL y retirar la exportación de los servicios transversales de `AppModule`.
