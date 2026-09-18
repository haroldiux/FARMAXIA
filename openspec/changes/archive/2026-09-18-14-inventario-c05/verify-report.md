# Verification report — Inventario operativo C05

## Result

PASS. C05 añade alertas calculadas, cuarentena/cadena de frío, mermas y
conteos físicos expuestos, manteniendo aislamiento tenant/sucursal,
idempotencia, auditoría y compatibilidad con FEFO.

## Evidence

- TDD red/green: `inventory.spec.ts` comenzó con cuatro `TypeError` por métodos
  C05 inexistentes y terminó con 10 escenarios PostgreSQL reales verdes.
- API: `pnpm --filter @farmaxia/api test` pasó con 37 pruebas en 11 suites;
  `tsc --noEmit` y build API pasaron.
- Web: `pnpm --filter @farmaxia/web exec tsc --noEmit` y build Next pasaron.
- Migración: `0010_wealthy_katie_power.sql` se aplicó en test y Compose; creó
  `inventory_operation_events`, check de estados, RLS forzada, grants e índice.
- Drizzle: `pnpm --filter @farmaxia/api exec drizzle-kit check` pasó y el
  arranque del API confirmó la migración en PostgreSQL.
- Docker: `docker compose build api web` y `docker compose up -d` pasaron;
  PostgreSQL, Redis, API y Web quedaron healthy.
- Smoke HTTP: `GET /health` y `GET /` respondieron 200; la consulta de alertas
  y los POST de merma/reconciliación sin bearer respondieron 401.
- Calidad: `git diff --check` no reportó errores de whitespace.

## Contract checks

- Las alertas respetan horizonte inclusivo, orden FEFO, stock físico y scope sin
  persistir notificaciones.
- Cuarentena exige motivo, captura temperatura para `COLD_CHAIN`, rechaza
  reservas activas, registra evento/auditoría y libera solo lotes no vencidos.
- Merma decrementa únicamente stock libre, crea un movimiento `WASTE`/`OUT` y
  es replay-safe sin saldo negativo.
- El conteo físico reutiliza reconciliación idempotente y conserva el piso de
  `reserved_base`.
- No se implementaron sensores, workers de notificación, ventas/proformas ni
  se cerraron D08, D09 o D22.
