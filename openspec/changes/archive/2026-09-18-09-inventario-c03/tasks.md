# Tasks: C03 Movimientos y conciliación

## Phase 1: specification and database

- [x] 1.1 Escribir pruebas rojas de dirección, ajuste, reserva, conciliación e idempotencia.
- [x] 1.2 Añadir dirección de movimiento y tabla de conciliaciones con migración C03.
- [x] 1.3 Aplicar RLS y privilegios mínimos.

## Phase 2: service

- [x] 2.1 Implementar `InventoryService.reconcile` y lectura de saldos.
- [x] 2.2 Integrar idempotencia y auditoría sin modificar costeo.

## Phase 3: verification

- [x] 3.1 Ejecutar pruebas PostgreSQL reales, typechecks, builds y migración idempotente.
- [x] 3.2 Actualizar estado/OpenSpec/Engram; mantener D08/D22 abiertas.
