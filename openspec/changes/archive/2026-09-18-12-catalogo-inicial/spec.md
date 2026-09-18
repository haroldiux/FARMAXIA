# Specification: Primer módulo de catálogo conectado

## C12.1 — lectura tenant-scoped

`GET /api/v1/catalog/products` DEBE devolver únicamente productos activos del
tenant y contexto autorizado, con categoría y presentaciones, paginación y
búsqueda por nombre/principio activo.

## C12.2 — altas protegidas

Las altas de categoría, producto y presentación DEBEN exigir `catalog.manage` y
usar el contexto autenticado; nunca deben aceptar un tenant libre para autorizar
la escritura.

## C12.3 — vista operativa

`/catalog` DEBE permitir buscar productos y crear un producto básico, mostrar
presentaciones reales y comunicar permisos/errores sin inventar datos.
