# Especificación: B06 — Servicios Transversales Confiables

## S19 — Auditoría de solo anexado

Una mutación de dominio DEBE poder registrar un evento de auditoría con tenant, sucursal, usuario actor, acción, tipo e identificador de entidad, payload y timestamp.
El rol de aplicación (`farmaxia_app`) ÚNICAMENTE DEBE poder insertar o consultar eventos dentro de su contexto RLS.
La base de datos DEBE rechazar cualquier intento de `UPDATE` o `DELETE` sobre `audit_events`.

### Scenario S19.1: Inserción válida de evento de auditoría
- **Given** una sesión autenticada con tenant `T1`, sucursal `B1` y usuario `U1`
- **When** se invoca `auditService.recordInTransaction` con acción `SALE_CONFIRMED`, entidad `Sale` e ID `S100`
- **Then** el evento se persiste con los identificadores del contexto transaccional actual
- **And** es consultable únicamente por usuarios del mismo tenant y sucursal autorizada.

### Scenario S19.2: Inmutabilidad estricta contra UPDATE y DELETE
- **Given** un evento de auditoría previamente persistido
- **When** cualquier rol intenta ejecutar `UPDATE audit_events` o `DELETE FROM audit_events`
- **Then** PostgreSQL dispara una excepción y aborta la transacción
- **And** la fila permanece inalterada.

---

## S20 — Idempotencia de confirmaciones

Un servicio común DEBE gestionar claves de idempotencia opacas asociadas a una operación, tenant y sucursal.
La clave junto con el nombre de la operación DEBE identificar de forma única una solicitud.

### Scenario S20.1: Primera ejecución de una operación con Idempotency-Key
- **Given** una clave de idempotencia nueva `K1` para la operación `confirm-sale` con payload `P1`
- **When** se ejecuta la acción a través de `idempotencyService.execute`
- **Then** la acción se ejecuta, el resultado se almacena junto con el hash SHA-256 del payload y el código HTTP
- **And** devuelve el resultado de la ejecución.

### Scenario S20.2: Reintento idéntico con la misma Idempotency-Key
- **Given** una operación previamente completada con clave `K1` y payload `P1`
- **When** se invoca nuevamente `idempotencyService.execute` con la misma clave `K1` y el mismo payload `P1`
- **Then** la acción interna NO se ejecuta de nuevo
- **And** devuelve exactamente el resultado y estado HTTP almacenados originalmente.

### Scenario S20.3: Conflicto por reuso de clave con payload diferente
- **Given** una operación completada con clave `K1` y payload `P1`
- **When** se invoca `idempotencyService.execute` con la misma clave `K1` pero payload modificado `P2`
- **Then** la solicitud falla inmediatamente con error `IDEMPOTENCY_KEY_REUSED` (HTTP 409 Conflict)
- **And** no se modifica el registro original ni se produce ningún efecto colateral.

---

## S21 — Outbox durable sin efectos externos

Dentro de la misma transacción de una mutación DEBE poder anexarse un evento outbox con tenant, sucursal, tipo de agregado, identificador de agregado, tipo de evento y payload JSON.
El evento DEBE nacer con estado `PENDING`.

### Scenario S21.1: Encolado atómico en transacción
- **Given** una transacción de dominio abierta mediante `TenantDatabase.withScope`
- **When** se invoca `outboxService.enqueueInTransaction` con un evento de tipo `SALE_COMPLETED`
- **Then** el evento se inserta en `outbox_events` con estado `PENDING`, `retry_count: 0` y timestamp programado
- **And** si la transacción de dominio hace rollback, el evento outbox también se descarta.

---

## S22 — Secuencias documentales internas

Una secuencia correlativa DEBE asignarse atómicamente por tenant, sucursal y tipo de documento comercial (e.g. `RECIBO`, `PROFORMA`).
Dos peticiones concurrentes NUNCA DEBEN recibir el mismo número secuencial.

### Scenario S22.1: Asignación correlativa secuencial
- **Given** una secuencia para la sucursal `B1` y tipo `RECIBO` cuyo último número es `42`
- **When** se solicita el siguiente número mediante `documentSequenceService.nextNumber`
- **Then** se devuelve `43` y el valor persistido queda actualizado a `43`.

### Scenario S22.2: Concurrencia sin colisiones ni duplicados
- **Given** múltiples solicitudes simultáneas solicitando el siguiente número para el mismo tenant, sucursal y tipo
- **When** todas las solicitudes se resuelven
- **Then** cada solicitud recibe un número único y estrictamente correlativo sin números repetidos.
