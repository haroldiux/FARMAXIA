# Tasks: C01 Catálogo farmacéutico

## Phase 1: specification and database

- [x] 1.1 Escribir pruebas rojas de catálogo, precios, códigos y aislamiento.
- [x] 1.2 Añadir tablas Drizzle y migración `0006_cool_payback.sql` con FKs compuestas.
- [x] 1.3 Aplicar RLS, membresía de sucursal y privilegios mínimos a las tablas.

## Phase 2: service

- [x] 2.1 Implementar `CatalogService` transaccional.
- [x] 2.2 Implementar búsqueda por código y selección de precio vigente.
- [x] 2.3 Implementar homologaciones preparadas sin integraciones externas.

## Phase 3: verification

- [x] 3.1 Ejecutar migración y pruebas contra PostgreSQL real.
- [x] 3.2 Ejecutar typecheck, builds y `drizzle-kit check`.
- [x] 3.3 Actualizar estado, evidencia y Engram; no integrar compras ni FEFO.
