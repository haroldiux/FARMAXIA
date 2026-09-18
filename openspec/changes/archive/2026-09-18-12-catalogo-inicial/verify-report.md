# Verification report — Primer módulo de catálogo

## Result

PASS. El primer módulo operativo de catálogo quedó conectado entre API y Web, con autorización, alcance tenant/sucursal y verificación Docker.

## Evidence

- TDD red/green: `catalog.spec.ts` falló inicialmente con `TypeError: catalog.listProducts is not a function` y pasó después con listado, búsqueda, paginación, categoría y presentación.
- API: `tsc --noEmit`, build y `pnpm --filter @farmaxia/api test` pasaron; la suite quedó en 29 pruebas verdes.
- Web: `tsc --noEmit` y build pasaron; Next generó `/`, `/dashboard` y `/catalog`.
- Docker: `docker compose build api web` y `docker compose up -d` pasaron; `postgres`, `redis`, `api` y `web` quedaron healthy.
- Smoke HTTP: `/health` y `/catalog` respondieron HTTP 200; `GET /api/v1/catalog/products` sin bearer respondió HTTP 401.

## Contract checks

- `GET /api/v1/catalog/products` devuelve únicamente productos activos, agrupa presentaciones y aplica búsqueda/paginación dentro de `withScope`.
- Las altas de categorías, productos y presentaciones exigen `catalog.manage`.
- La vista `/catalog` usa la sesión existente y no presenta precios, códigos de barras, homologaciones ni inventario como si ya existieran.
- Las decisiones D08 (costos) y D22 (importación) siguen abiertas y no fueron cerradas por este lote.
