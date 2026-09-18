# Tareas — Compras F4-WEB

## Fase 1 — Contrato y prueba roja

- [x] 1.1 Escribir prueba PostgreSQL roja para listar proveedores tenant-scoped
  y órdenes solo de la sucursal scoped, con líneas ordenadas.
- [x] 1.2 Definir contratos TypeScript para proveedores, órdenes y mutaciones.

## Fase 2 — API

- [x] 2.1 Implementar `listSuppliers`, `listPresentations` y
  `listPurchaseOrders` con RLS y orden determinista.
- [x] 2.2 Crear `ProcurementController`/`ProcurementModule`, registrar rutas
  POST/GET y conectar `AppModule`.
- [x] 2.3 Ejecutar pruebas enfocadas, typecheck y regresión C02/C05.

## Fase 3 — Web

- [x] 3.1 Implementar cliente autenticado de compras y manejo de errores.
- [x] 3.2 Crear `/procurement` con listados, alta de proveedor y nueva orden
  de una línea.
- [x] 3.3 Enlazar Compras desde dashboard según `inventory.manage` y asegurar
  responsive/accesibilidad.

## Fase 4 — Verificación y entrega

- [x] 4.1 Ejecutar typecheck/build API/Web, suite PostgreSQL, diff check y
  drizzle check.
- [x] 4.2 Reconstruir Compose, comprobar healthchecks y smoke HTTP.
- [x] 4.3 Actualizar contratos, estado, tareas SDD; archivar change.
- [x] 4.4 Crear commit convencional y publicar en `origin/main`.
