# Tasks: C02 Compras y recepción

## Phase 1: specification and database

- [x] 1.1 Escribir pruebas rojas de proveedor, orden, recepción idempotente,
  lotes, saldo/movimiento y cuenta por pagar.
- [x] 1.2 Añadir schema Drizzle y migración C02 con FKs compuestas.
- [x] 1.3 Aplicar RLS y privilegios mínimos por tenant/sucursal.

## Phase 2: services

- [x] 2.1 Implementar `ProcurementService` para proveedores y órdenes.
- [x] 2.2 Implementar recepción idempotente con lote, saldo y movimiento.
- [x] 2.3 Implementar factura de proveedor y cuenta por pagar básica.

## Phase 3: verification

- [x] 3.1 Ejecutar pruebas contra PostgreSQL real y verificar rollback.
- [x] 3.2 Ejecutar typecheck, builds, `drizzle-kit check` y migración idempotente.
- [x] 3.3 Actualizar estado y Engram; mantener D08/D22 abiertas.
