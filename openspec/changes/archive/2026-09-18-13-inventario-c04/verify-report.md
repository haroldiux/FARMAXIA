# Verification report — Inventario operativo C04

## Result

PASS. El motor FEFO y el ciclo de vida de reservas quedaron implementados,
aislados por tenant/sucursal, auditados y expuestos bajo `inventory.manage`.

## Evidence

- Red/Green: el test comenzó fallando con `TypeError: inventory.reserveFefo is not a function`; después pasó con 6 escenarios PostgreSQL reales.
- API: `pnpm --filter @farmaxia/api test` pasó con 33 pruebas en 11 suites; `tsc --noEmit`, build y `drizzle-kit check` pasaron.
- Migración: `0009_productive_human_torch.sql` se aplicó en la base de pruebas y en Docker, creando `inventory_reservations` con FK, RLS, grants, estados e índice.
- Concurrencia: dos reservas simultáneas de las últimas unidades dejaron una operación exitosa, otra rechazada y `reserved_base` consistente.
- Docker: `docker compose build api` y `docker compose up -d` pasaron; PostgreSQL, Redis, API y Web quedaron healthy.
- Smoke HTTP: `/health` y `/catalog` respondieron 200; `POST /api/v1/inventory/reservations/expire` sin bearer respondió 401.

## Contract checks

- FEFO usa presentación/factor entero, ignora lotes vencidos o no disponibles y ordena por vencimiento y `batch_id`.
- Reservar no baja stock físico; liberar/expirar baja solo `reserved_base`; consumir baja ambos contadores y crea movimiento `OUT` trazable.
- Idempotencia devuelve el resultado original y rechaza el mismo key con payload diferente.
- No se implementaron ventas/proformas ni se cerraron D08 (costos), D09 (política comercial de reservas) o D22 (importación histórica).
