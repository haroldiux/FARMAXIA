# Tareas — Vista operativa de inventario F3-WEB

## Fase 1 — Contrato y prueba roja

- [x] 1.1 Escribir prueba PostgreSQL roja para listar almacenes solo de la
  sucursal scoped y con orden determinista.
- [x] 1.2 Definir tipos/contratos de cliente para almacenes, alertas y errores.

## Fase 2 — API

- [x] 2.1 Implementar `listWarehouses` y `GET /api/v1/inventory/warehouses`
  bajo `inventory.manage`.
- [x] 2.2 Ejecutar pruebas API, typecheck y regresión de rutas C05.

## Fase 3 — Web

- [x] 3.1 Implementar cliente HTTP scoped y manejo de refresh/errores.
- [x] 3.2 Crear `/inventory` con selector, horizonte, tabla/tarjetas y estados.
- [x] 3.3 Añadir acciones confirmadas de cuarentena, liberación y merma con
  idempotencia y recarga.
- [x] 3.4 Enlazar Inventario desde el shell según `inventory.manage` y asegurar
  navegación responsive.

## Fase 4 — Verificación y entrega

- [x] 4.1 Ejecutar typecheck/build API y Web, suite PostgreSQL y `git diff --check`.
- [x] 4.2 Reconstruir Compose, comprobar los cuatro healthchecks y smoke HTTP.
- [x] 4.3 Actualizar contratos, matriz, estado y reporte SDD; archivar change.
- [x] 4.4 Crear commit convencional y publicar en `origin/main`.
