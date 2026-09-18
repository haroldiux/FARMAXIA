# Specification: C03 — Movimientos y conciliación

## C03.1 — Dirección y trazabilidad

Todo movimiento DEBE indicar `IN` u `OUT`, cantidad positiva, almacén, lote,
tipo, referencia y fecha. Las recepciones existentes se consideran `IN`.

## C03.2 — Ajuste atómico

Un ajuste DEBE cambiar `inventory_balances` y crear su movimiento dentro de la
misma transacción. Un movimiento `OUT` DEBE fallar si la cantidad supera el saldo
libre (`quantity_base - reserved_base`); nunca se permite saldo negativo.

### Scenario: ajuste de salida

- GIVEN un lote con 10 unidades disponibles
- WHEN un conteo confirma 7 unidades
- THEN se registra una diferencia OUT de 3, el saldo queda en 7 y se audita la
  conciliación una sola vez

## C03.3 — Conciliación idempotente

Una conciliación DEBE guardar esperado, contado, delta, motivo y clave de
idempotencia. Repetir la misma clave y payload devuelve el resultado original sin
repetir movimiento ni auditoría.

## C03.4 — Reservas y contexto

Un ajuste OUT DEBE respetar unidades reservadas y todas las operaciones DEBEN
respetar tenant, almacén y sucursal del `TenantScope`.
