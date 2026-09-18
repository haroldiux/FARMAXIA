# Proposal: Primer módulo de catálogo conectado

## Intent

Conectar el primer módulo operativo del backoffice al catálogo tenant-scoped
existente, ofreciendo lectura de productos activos y alta básica desde la web.

## Scope

- Endpoints autenticados para listar productos y crear categorías/productos/
  presentaciones.
- Permiso `catalog.manage` y contexto RLS de tenant/sucursal.
- Vista `/catalog` con búsqueda, lista de presentaciones y alta de producto.

## Out of scope

- Precios, códigos de barras, homologaciones, importación o edición/borrado.
- Inventario, ventas, FEFO y cualquier decisión D08/D22.

## Rollback

Se pueden retirar las rutas y la vista sin modificar las tablas C01 ni las
operaciones existentes.
