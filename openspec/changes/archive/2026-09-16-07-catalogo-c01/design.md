# Diseño técnico: C01 — Catálogo farmacéutico

## Persistencia

Se añadirán `product_categories`, `products`, `product_presentations`,
`product_barcodes`, `price_lists`, `presentation_prices` y
`product_homologations` al schema Drizzle. Todas tendrán `tenant_id`, claves
únicas tenant-scoped y políticas RLS forzadas. Las relaciones usarán FKs
compuestas `(tenant_id, id)` para impedir cruces.

El catálogo es compartido por tenant, pero las consultas requieren un contexto
`TenantScope` válido con membresía de sucursal. Las listas específicas validan
que su sucursal sea la del contexto; una lista global usa `branch_id = NULL`.

## Servicio

`CatalogService` expondrá operaciones transaccionales para crear categoría,
producto, presentación, código, lista, precio y homologación, además de
`findByBarcode`. El servicio no confiará en `tenantId` enviado por el cliente y
no ejecutará efectos externos.

La búsqueda elegirá precio vigente específico de sucursal antes que global,
ordenando por `valid_from DESC`. La persistencia conservará el decimal como
texto para no perder precisión en Node; C01 no hace operaciones monetarias.

## Verificación

Las pruebas rojas cubrirán creación y lectura, código duplicado, factor inválido,
prioridad de precios, homologación sin llamada externa y rechazo de un tenant
ajeno. La migración se aplicará a PostgreSQL real y el conjunto completo seguirá
ejecutándose para detectar FKs nuevas en las fixtures existentes.
