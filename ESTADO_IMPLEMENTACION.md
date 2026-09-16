# Estado de implementación — FARMAXIA

**Actualizado:** 16 de septiembre de 2026  
**Fase actual:** F1 / B06 — servicios comunes de auditoría, idempotencia y outbox.

| ID | Estado | Evidencia | Bloqueo / siguiente condición |
| --- | --- | --- | --- |
| A01 | Completada para la base | `REGISTRO_DECISIONES.md`; D01, D02, D04, D05 y D10 delimitadas | D03 requiere un emisor y asesoría tributaria para adaptador real. |
| A02 | Completada como diseño y núcleo persistido | `docs/data-model.dbml` y migraciones B02–B05 describen entidades, ownership, claves y RLS | B06 añadirá los servicios transversales de auditoría, idempotencia y outbox. |
| A03 | Completada como contrato | `docs/api-contracts.md` define contratos, permisos, idempotencia y errores | OpenAPI ejecutable empieza con los módulos de dominio. |
| A04 | Completada como matriz | `docs/test-matrix.md` enlaza RF01–RF16 con T01–T27 | D06–D09, D11 y D14 se cierran antes de sus módulos. |
| B01 | Completada | Prueba health verde; builds API/web verdes; PostgreSQL 18 y Redis 8 saludables en Compose. | Completada. |
| B02 | Completada | Migración Drizzle, role local, RLS forzada, FKs compuestas y 4 pruebas contra `farmaxia_test`. | Base disponible para B04 y los módulos de dominio posteriores. |
| B03 | Completada | Migraciones `0001`–`0002`, Argon2id, JWT breve, refresh rotativo, RBAC, guards globales y 8 pruebas reales verdes. | Base disponible para B04. |
| B04 | Completada | Migración `0003`, contexto tenant/usuario/sucursal, RLS de sucursal, metadatos de jobs/archivos y claves de caché aisladas; 11 pruebas verdes. | Base disponible para B05. |
| B05 | Completada | Migración `0004`, plan `COMPLETO`, máquina de estados, entitlements y cuota atómica; 14 pruebas verdes. | Base disponible para administrar altas y segmentar planes posteriores. |

## Límites del lote B01

Se construyó la fundación técnica: monorepo, API NestJS/Fastify, web Next.js, configuración tipada, health checks y contenedores locales. No incluyó login, tenants persistidos, pagos, FEFO, SIAT, documentos fiscales ni operación offline.

## Evidencia B01

- Red: `pnpm --filter @farmaxia/api test` falló con `404` para `GET /health`.
- Green: el mismo comando pasó con 1 prueba.
- Build: `pnpm --filter @farmaxia/api build` y `pnpm --filter @farmaxia/web build` pasaron.
- Servicios: `docker compose ps`, `pg_isready` y `redis-cli ping` confirmaron PostgreSQL en `localhost:5433` y Redis en `localhost:6379` saludables.

## Evidencia B02

- Red: la prueba de RLS falló sin tablas; el contrato de `TenantDatabase` falló antes de implementar el contexto transaccional.
- Green: `pnpm --filter @farmaxia/api test` pasó con 4 pruebas, incluidas invisibilidad entre tenants, limpieza de contexto y FK compuesta anti-cruce.
- Migración: `0000_initial_tenancy.sql` es versionada por Drizzle y crea/actualiza de forma idempotente las tablas y políticas del núcleo organizativo.

## Evidencia B03

- Red: la nueva prueba de privilegio mínimo falló porque `farmaxia_auth` podía enumerar usuarios antes de activar su RLS específica.
- Green: `pnpm --filter @farmaxia/api test` pasó con 8 pruebas, incluidas membresía exacta, rotación/replay de refresh, rutas privadas y lectura limitada del rol de identidad.
- Migraciones: `0001_authentication_and_permissions.sql` y `0002_restrict_auth_role_read.sql` aplicadas a PostgreSQL local; `drizzle-kit check` pasó.
- Build y proceso real: `pnpm build` pasó; la API compilada inició, `/health` respondió 200 y `/api/v1/auth/me` sin bearer devolvió 401.

## Evidencia B04

- Red/Green: las pruebas de claves tenant/sucursal comenzaron sin módulo y luego pasaron; las pruebas PostgreSQL verificaron visibilidad de sucursal, RLS de archivos/jobs y FK compuesta que rechaza relacionar un job con un archivo de otra sucursal.
- Migración: `0003_tenant_resource_boundary.sql` se aplicó a PostgreSQL local y endurece las políticas de sucursal existentes; el rol de aplicación ya no puede concederse membresías por escritura directa.
- Verificación: `pnpm --filter @farmaxia/api test` pasó con 11 pruebas; `pnpm build`, `tsc --noEmit`, `drizzle-kit check` y `docker compose ps` pasaron con PostgreSQL y Redis saludables.

## Evidencia B05

- Red/Green: las pruebas de estados y cuotas se escribieron antes de sus servicios; la prueba de entitlement falló inicialmente sin `FeatureService` y pasó después de implementarlo.
- Reglas: `TRIALING` inicia con exactamente 7 días; el alta directa `ACTIVE` no crea trial; `PAST_DUE` conserva acceso únicamente durante 3 días; `SUSPENDED` y `CANCELED` niegan operación.
- Migración: `0004_subscriptions_and_quotas.sql` crea planes, funcionalidades, cuotas, suscripciones, overrides y uso, aplica RLS/privilegios y siembra `COMPLETO` con todas las funciones y límites `NULL` (ilimitados).
- Verificación: `pnpm --filter @farmaxia/api test` pasó con 14 pruebas contra PostgreSQL real; `pnpm build`, `tsc --noEmit`, `drizzle-kit check` y `docker compose ps` pasaron con PostgreSQL y Redis saludables.

## Próxima tarea

B06: incorporar servicios comunes de auditoría inmutable, idempotencia, outbox y secuencias documentales, sin worker ni proveedores externos.
