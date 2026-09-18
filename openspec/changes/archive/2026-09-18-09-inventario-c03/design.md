# Diseño técnico: C03 — Movimientos y conciliación

`inventory_movements` añadirá `movement_direction` (`IN`/`OUT`) y conservará
`quantity_base` positiva. `inventory_reconciliations` será la evidencia de cada
conteo/ajuste, con esperado, contado, delta, motivo y clave única por tenant.

`InventoryService.reconcile` usará `IdempotencyService` y una transacción scoped:
lee el saldo con bloqueo de fila, calcula la diferencia, inserta la
conciliación, aplica un `UPDATE` condicional que respeta `reserved_base`, añade
movimiento y auditoría. Delta cero conserva la conciliación sin movimiento.

La lectura de saldo devuelve cantidad disponible y reservada; C03 no crea
reservas ni decide costeo. RLS exige membresía de sucursal y FK compuesta para
almacén/lote.
