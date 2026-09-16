# Delta for Servicios Transversales

## ADDED Requirements

### Requirement: Auditoría de solo anexado

Una mutación de dominio DEBE poder registrar un evento de auditoría con tenant, sucursal, usuario actor, acción, tipo e identificador de entidad, payload y timestamp.
El rol de aplicación (`farmaxia_app`) ÚNICAMENTE DEBE poder insertar o consultar eventos dentro de su contexto RLS.
La base de datos DEBE rechazar cualquier intento de `UPDATE` o `DELETE` sobre `audit_events`.

#### Scenario: Inserción válida de evento de auditoría

- GIVEN una sesión autenticada con tenant T1, sucursal B1 y usuario U1
- WHEN se invoca auditService.recordInTransaction con acción SALE_CONFIRMED, entidad Sale e ID S100
- THEN el evento se persiste con los identificadores del contexto transaccional actual
- AND es consultable únicamente por usuarios del mismo tenant y sucursal autorizada

#### Scenario: Inmutabilidad estricta contra UPDATE y DELETE

- GIVEN un evento de auditoría previamente persistido
- WHEN cualquier rol intenta ejecutar UPDATE audit_events o DELETE FROM audit_events
- THEN PostgreSQL dispara una excepción y aborta la transacción
- AND la fila permanece inalterada

### Requirement: Idempotencia de confirmaciones

Un servicio común DEBE gestionar claves de idempotencia opacas asociadas a una operación, tenant y sucursal.
La clave junto con el nombre de la operación DEBE identificar de forma única una solicitud.

#### Scenario: Primera ejecución de una operación con Idempotency-Key

- GIVEN una clave de idempotencia nueva K1 para la operación confirm-sale con payload P1
- WHEN se ejecuta la acción a través de idempotencyService.execute
- THEN la acción se ejecuta, el resultado se almacena junto con el hash SHA-256 del payload y el código HTTP
- AND devuelve el resultado de la ejecución

#### Scenario: Reintento idéntico con la misma Idempotency-Key

- GIVEN una operación previamente completada con clave K1 y payload P1
- WHEN se invoca nuevamente idempotencyService.execute con la misma clave K1 y el mismo payload P1
- THEN la acción interna NO se ejecuta de nuevo
- AND devuelve exactamente el resultado y estado HTTP almacenados originalmente

#### Scenario: Conflicto por reuso de clave con payload diferente

- GIVEN una operación completada con clave K1 y payload P1
- WHEN se invoca idempotencyService.execute con la misma clave K1 pero payload modificado P2
- THEN la solicitud falla inmediatamente con error IDEMPOTENCY_KEY_REUSED (HTTP 409 Conflict)
- AND no se modifica el registro original ni se produce ningún efecto colateral

### Requirement: Outbox durable sin efectos externos

Dentro de la misma transacción de una mutación DEBE poder anexarse un evento outbox con tenant, sucursal, tipo de agregado, identificador de agregado, tipo de evento y payload JSON.
El evento DEBE nacer con estado PENDING.

#### Scenario: Encolado atómico en transacción

- GIVEN una transacción de dominio abierta mediante TenantDatabase.withScope
- WHEN se invoca outboxService.enqueueInTransaction con un evento de tipo SALE_COMPLETED
- THEN el evento se inserta en outbox_events con estado PENDING, retry_count: 0 y timestamp programado
- AND si la transacción de dominio hace rollback, el evento outbox también se descarta

### Requirement: Secuencias documentales internas

Una secuencia correlativa DEBE asignarse atómicamente por tenant, sucursal y tipo de documento comercial (e.g. RECIBO, PROFORMA).
Dos peticiones concurrentes NUNCA DEBEN recibir el mismo número secuencial.

#### Scenario: Asignación correlativa secuencial

- GIVEN una secuencia para la sucursal B1 y tipo RECIBO cuyo último número es 42
- WHEN se solicita el siguiente número mediante documentSequenceService.nextNumber
- THEN se devuelve 43 y el valor persistido queda actualizado a 43

#### Scenario: Concurrencia sin colisiones ni duplicados

- GIVEN múltiples solicitudes simultáneas solicitando el siguiente número para el mismo tenant, sucursal y tipo
- WHEN todas las solicitudes se resuelven
- THEN cada solicitud recibe un número único y estrictamente correlativo sin números repetidos
