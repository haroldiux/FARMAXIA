# Especificación — Inventario operativo C04

## C04.1 — Asignación FEFO

Una asignación DEBE recibir una presentación, cantidad comercial positiva,
almacén y fecha de expiración explícita. El backend DEBE validar que la
presentación exista y calcular `quantityRequested * baseUnitFactor` usando
enteros seguros.

Solo son elegibles lotes con `status = AVAILABLE`, vencimiento igual o
posterior al día actual y unidades disponibles (`quantity_base -
reserved_base`) positivas. La selección DEBE ordenar por `expires_on ASC,
batch_id ASC`, bloquear los saldos con `FOR UPDATE` y devolver asignaciones a
uno o más lotes cuya suma cubra exactamente la solicitud.

Si la suma no alcanza, la operación DEBE fallar sin modificar saldos,
reservas, movimientos ni auditoría.

## C04.2 — Reservas

Una reserva FEFO DEBE incrementar `inventory_balances.reserved_base` sin
alterar `quantity_base`. Cada asignación persistirá su lote, almacén,
unidades base y `expires_at`, con estado `ACTIVE`, `CONSUMED`, `RELEASED` o
`EXPIRED`.

Las operaciones mutantes DEBEN aceptar una clave de idempotencia. Repetir la
misma clave y payload DEBE devolver la respuesta original; reutilizarla con
otro payload DEBE producir conflicto sin nueva mutación.

## C04.3 — Ciclo de vida

- Liberar una reserva activa disminuye `reserved_base`, marca `RELEASED` y no
  crea movimiento físico.
- Consumir una reserva activa disminuye simultáneamente `quantity_base` y
  `reserved_base`, crea movimiento `OUT` referenciado a la operación caller y
  marca `CONSUMED`.
- Una reserva activa cuyo `expires_at <= now()` puede ser expirada por un
  worker/llamada operativa; se libera disponibilidad y marca `EXPIRED`.
- Liberar, consumir o expirar una reserva ya finalizada DEBE ser replay-safe y
  no modificar contadores otra vez.

## C04.4 — Seguridad y auditoría

Todas las consultas y mutaciones DEBEN ejecutarse mediante `withScope`, RLS,
FK compuestas y membresía activa de sucursal. Las reservas, liberaciones,
consumos y expiraciones DEBEN registrar auditoría transaccional. Las rutas
HTTP DEBEN exigir `inventory.manage`.

## Fuera de alcance

Este lote no define si una proforma reserva por defecto, qué TTL comercial
usar ni cómo convertir una proforma/venta; esas decisiones siguen en D09.
Tampoco calcula costo de salida ni valoración contable (D08).
