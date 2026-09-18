# Diseño — Inventario operativo C04

## Persistencia

Se agregará `inventory_reservations` con una fila por lote asignado:
`tenant_id`, `warehouse_id`, `batch_id`, `quantity_base`, `expires_at`,
`status`, marcas de consumo/liberación y `idempotency_key`. Las FK compuestas
apuntan al almacén y lote del mismo tenant; un índice cubre reservas activas
por vencimiento. RLS replica el límite de sucursal de C03.

## Servicio

`InventoryService.reserveFefo` ejecutará una transacción idempotente. Primero
lee la presentación, calcula unidades base y bloquea balances elegibles en
orden `(expires_on, batch_id)`. Si alcanza, inserta una reserva por lote,
actualiza `reserved_base` y audita cada asignación en la misma transacción.

`releaseReservation` y `consumeReservation` bloquearán la fila de reserva y
el balance. El consumo validará disponibilidad física, decrementará ambos
contadores e insertará un movimiento OUT con el `referenceType/referenceId`
que entregue el caller. `expireReservations` recorrerá reservas activas ya
vencidas en orden de ID y liberará sus contadores de manera atómica.

No se devuelve `unit_cost` ni se calcula subtotal: el orden físico FEFO es
independiente de la política contable D08.

## HTTP

`InventoryController` expondrá:

- `POST /api/v1/inventory/reservations/fefo`;
- `POST /api/v1/inventory/reservations/:reservationId/release`;
- `POST /api/v1/inventory/reservations/:reservationId/consume`;
- `POST /api/v1/inventory/reservations/expire`.

Todas las rutas requieren `inventory.manage`. El endpoint de consumo exige
`referenceType` y `referenceId` para no inventar una venta.

## Pruebas

La suite nueva sembrará dos lotes con vencimientos distintos y una
presentación con factor mayor que uno. Verificará orden FEFO, cruce de lotes,
insuficiencia sin efectos, replay/conflicto de idempotencia, liberación,
consumo, expiración y aislamiento RLS.
