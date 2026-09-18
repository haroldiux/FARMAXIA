# Propuesta — Compras F4-WEB

## Intención

Conectar el núcleo C02 de proveedores y órdenes de compra con una superficie
HTTP y una vista Next.js usable por el equipo de inventario. La primera vertical
permitirá consultar el contexto de compras, registrar proveedores y crear
órdenes con una línea de producto/presentación, sin adelantar la recepción
física ni la valoración contable.

## Problema

`ProcurementService` ya persiste proveedores y órdenes, pero no existe un
controller HTTP ni un flujo Web para operar esos datos. La navegación de
dashboard todavía deja Compras como módulo pendiente, por lo que el usuario no
puede preparar una recepción de forma trazable.

## Alcance

- Exponer proveedores activos scoped al tenant activo mediante
  `inventory.manage`; el modelo C02 no asigna proveedores a una sucursal.
- Exponer órdenes de compra de almacenes de la sucursal, incluyendo líneas y
  nombres de producto/presentación.
- Exponer presentaciones activas tenant-scoped para que la orden pueda elegirse
  sin exigir el permiso de edición del catálogo.
- Permitir alta de proveedor y creación de orden desde `/procurement`.
- Mantener sesión, refresh, aislamiento RLS y errores consistentes con F3-WEB.
- Enlazar Compras desde el dashboard solo con `inventory.manage`.

## Fuera de alcance

- Recepción parcial/completa y creación de lotes desde la vista; será F5-WEB.
- Facturas de proveedor, cuentas por pagar, costo promedio, importación y
  pagos.
- Nuevo permiso `procurement.manage`; se reutiliza el permiso operativo
  existente `inventory.manage`.

## Plan de reversión

Revertir el commit del change elimina el controller/módulo HTTP, cliente y
vista Web sin modificar las tablas C02 ni el servicio de recepción existente.
