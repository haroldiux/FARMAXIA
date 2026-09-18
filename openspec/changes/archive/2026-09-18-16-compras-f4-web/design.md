# Diseño técnico — Compras F4-WEB

## API

`ProcurementController` y `ProcurementModule` se añadirán a NestJS. El
controller usará `@RequirePermissions("inventory.manage")` y derivará el scope
desde `AuthenticatedRequest`, igual que Inventario. `ProcurementService`
recibirá métodos de lectura:

- `listSuppliers(scope)` consulta proveedores activos tenant-scoped (el modelo
  C02 no los vincula a una sucursal) y ordena por nombre/ID.
- `listPresentations(scope)` consulta presentaciones de productos activos para
  poblar el selector de órdenes sin requerir `catalog.manage`.
- `listPurchaseOrders(scope)` consulta órdenes cuyo almacén pertenece a la
  sucursal, agrupa sus líneas mediante `json_agg` y resuelve producto,
  presentación y almacén en la misma consulta.

Las mutaciones HTTP delegarán en `createSupplier` y `createPurchaseOrder`, sin
duplicar validación. El módulo importará `DatabaseModule`; `AppModule` lo
registrará.

## Cliente Web

`apps/web/app/lib/procurement.ts` encapsulará requests autenticadas, respuestas
tipadas y mensajes para `403`/`409`. La página usará `currentSession`, el
cliente de almacenes existente y el endpoint scoped de presentaciones para
construir el selector de órdenes.

## Vista

`/procurement` será un Client Component con:

1. Cabecera contextual y selector de almacén.
2. Tabla/lista de órdenes agrupadas por proveedor, almacén, estado y líneas.
3. Panel lateral de alta de proveedor.
4. Panel de nueva orden con proveedor, almacén, presentación, cantidad y costo.
5. Aviso visible de que recepción por lote es el siguiente flujo.

Después de una mutación se recargan proveedores, órdenes y presentaciones. Los
formularios conservan sus valores si la operación falla. Se reutilizan tokens
de `globals.css` y reglas responsive existentes.

## Seguridad y consistencia

- Todas las lecturas/mutaciones usan `TenantDatabase.withScope` y RLS.
- Los IDs enviados son referencias, nunca autorización; las FKs/RLS validan el
  tenant y el almacén de sucursal.
- No se agregará un permiso nuevo en esta entrega.

## Verificación

Prueba roja de listado scoped antes de implementar; suite API completa,
typecheck/build de API/Web, `drizzle-kit check`, `git diff --check`, Compose y
smoke de `/procurement`/rutas protegidas.
