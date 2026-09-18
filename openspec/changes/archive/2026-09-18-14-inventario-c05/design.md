# Diseño — Inventario operativo C05

## Decisiones

### D1 — Eventos operativos aditivos

Se agregará `inventory_operation_events` con una fila por cuarentena,
liberación de cuarentena o merma. Tendrá `tenant_id`, `warehouse_id`,
`batch_id`, `operation_type`, `reason_code`, `reason`, `quantity_base` nullable,
`temperature_celsius` nullable, `idempotency_key` y `created_at`. Una clave
única por tenant permite trazabilidad sin sustituir `idempotency_records`, que
continúa siendo la fuente de replay de la respuesta.

El tipo de operación será `QUARANTINE`, `RELEASE_QUARANTINE` o `WASTE`.
`COUNT` seguirá en `inventory_reconciliations`, ya existente y diseñado para
guardar el delta completo.

### D2 — Estado de lote explícito

El estado de `inventory_batches` se restringirá a `AVAILABLE`, `QUARANTINED` y
`DISPOSED`. C05 solo ejecuta transiciones `AVAILABLE -> QUARANTINED` y
`QUARANTINED -> AVAILABLE`; `DISPOSED` queda reservado para futuras
operaciones de disposición total y no se usa implícitamente por una merma.
FEFO ya filtra `AVAILABLE`, por lo que no requiere una regla paralela.

### D3 — Locks y atomicidad

`InventoryService` usará `withScope` y SQL parametrizado. Cuarentena bloqueará
el lote y el saldo de la sucursal, verificará reservas activas y luego insertará
evento/auditoría. Merma bloqueará el saldo, validará stock libre, actualizará
saldo, insertará movimiento `WASTE` y evento/auditoría en la misma transacción.

### D4 — Alertas calculadas

`listExpiryAlerts` será una lectura derivada de `inventory_batches` y
`inventory_balances`; no persistirá alertas. Se filtrará existencia física
positiva y horizonte inclusivo, devolverá estados `EXPIRED`/`DUE_SOON` y
normalizará fechas a `YYYY-MM-DD` para respuestas deterministas.

### D5 — API

`InventoryController` añadirá:

- `GET /api/v1/inventory/expiry-alerts?warehouseId=&horizonDays=`;
- `POST /api/v1/inventory/batches/:batchId/quarantine`;
- `POST /api/v1/inventory/batches/:batchId/release-quarantine`;
- `POST /api/v1/inventory/waste`;
- `POST /api/v1/inventory/reconciliations`.

Todas las rutas quedarán bajo `inventory.manage`. Las entradas se validarán
antes de tocar la base y las mutaciones devolverán estados HTTP 201/200
compatibles con el servicio de idempotencia.

## Pruebas

La suite `apps/api/test/inventory.spec.ts` añadirá pruebas rojas para alertas
scoped, cuarentena con y sin reserva, replay/conflicto, frío, merma libre y
sobre reservado, conteo expuesto y exclusión FEFO. Se verificará además que
otra sucursal/tenant no puede leer ni mutar estos recursos.

## Migración y despliegue

La migración `0010_*` añadirá la tabla de eventos, el check de estados, índices,
RLS y privilegios mínimos. Debe ser idempotente mediante la secuencia Drizzle,
aplicarse en el arranque del API y dejar intactas las migraciones `0001..0009`.

## Rollback técnico

El código puede deshabilitarse sin borrar movimientos. La reversión de esquema
elimina únicamente la tabla de eventos y su política después de retirar los
consumidores; el check de estado se revierte solo si existen estados legacy
documentados. Antes de ejecutar rollback se verifica que no haya eventos C05
que deban conservarse como evidencia.
