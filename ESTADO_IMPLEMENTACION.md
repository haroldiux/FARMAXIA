# Estado de implementación — FARMAXIA

**Actualizado:** 21 de septiembre de 2026
**Fase actual:** F7-WEB — controles monetarios de apertura, conteo y cierre, verificada localmente.

| ID | Estado | Evidencia | Bloqueo / siguiente condición |
| --- | --- | --- | --- |
| A01 | Completada para la base | `REGISTRO_DECISIONES.md`; D01, D02, D04, D05 y D10 delimitadas | D03 requiere un emisor y asesoría tributaria para adaptador real. |
| A02 | Completada como diseño y núcleo persistido | `docs/data-model.dbml` y migraciones B02–B08 describen entidades, ownership, claves y RLS | D08 y D22 siguen abiertas; C04 continúa con reglas operativas. |
| A03 | Completada como contrato | `docs/api-contracts.md` define contratos, permisos, idempotencia y errores | OpenAPI ejecutable empieza con los módulos de dominio. |
| A04 | Completada como matriz | `docs/test-matrix.md` enlaza RF01–RF16 con T01–T27 | D06–D09, D11 y D14 se cierran antes de sus módulos. |
| B01 | Completada | Prueba health verde; builds API/web verdes; PostgreSQL 18 y Redis 8 saludables en Compose. | Completada. |
| B02 | Completada | Migración Drizzle, role local, RLS forzada, FKs compuestas y 4 pruebas contra `farmaxia_test`. | Base disponible para B04 y los módulos de dominio posteriores. |
| B03 | Completada | Migraciones `0001`–`0002`, Argon2id, JWT breve, refresh rotativo, RBAC, guards globales y 8 pruebas reales verdes. | Base disponible para B04. |
| B04 | Completada | Migración `0003`, contexto tenant/usuario/sucursal, RLS de sucursal, metadatos de jobs/archivos y claves de caché aisladas; 11 pruebas verdes. | Base disponible para B05. |
| B05 | Completada | Migración `0004`, plan `COMPLETO`, máquina de estados, entitlements y cuota atómica; 14 pruebas verdes. | Base disponible para administrar altas y segmentar planes posteriores. |
| B06 | Completada | Migración `0005`, auditoría inmutable con trigger, idempotencia transaccional con SHA-256, outbox PENDING y secuencias atómicas por sucursal; 22 pruebas verdes. | Base disponible para catálogo e inventario. |
| B07 | Completada | Dockerfiles reproducibles para API/web, Compose con cuatro servicios, migración automática y healthchecks; API y web respondieron HTTP 200. | Las vistas funcionales de dominio aún se construirán por lotes posteriores. |
| C01 | Completada | Migración `0006_cool_payback.sql`, catálogo con FKs/RLS, búsqueda de barras, precio por sucursal y homologación preparada; 24 pruebas verdes. | Base disponible para compras, recepción y lotes. |
| C02 | Completada | Migración `0007_swift_supernaut.sql`, proveedores, órdenes, recepción idempotente, lotes, saldos, movimiento `RECEIPT` y cuentas por pagar; 26 pruebas verdes. | Costeo/importación siguen provisionales hasta D08/D22. |
| C03 | Completada | Migración `0008_messy_mauler.sql`, dirección `IN`/`OUT`, conciliación idempotente, ajuste atómico respetando reservas, auditoría y RLS; 28 pruebas verdes. | C04 aborda FEFO, reservas operativas y vencimientos; D08/D22 permanecen abiertas. |
| C04 | Completada | Motor FEFO transaccional con factor de presentación, reservas por lote, liberación/consumo/expiración idempotentes, auditoría y RLS en migración `0009_productive_human_torch.sql`; 33 pruebas verdes. | La integración con proformas/ventas y la política comercial de reservas dependen de D09; D08/D22 siguen abiertas. |
| C05 | Completada | Migración `0010_wealthy_katie_power.sql`, alertas de vencimiento, cuarentena/cadena de frío, mermas y conteos autorizados con idempotencia, auditoría y RLS; 37 pruebas verdes; change archivado. | Preparar F3-WEB; sensores, notificaciones, D08/D09/D22 siguen fuera de alcance. |
| F1-WEB | Completada como base funcional | Login contra API, refresh/logout, dashboard protegido, contexto tenant/sucursal y permisos efectivos; builds Next y CORS verificados dentro de Docker. | CRUD de catálogo, ventas y caja se implementará por lotes posteriores. |
| F3-WEB | Completada | Cliente scoped y vista `/inventory` con almacenes de la sucursal activa, alertas FEFO a 7/30/90 días, estados de lote y acciones auditadas de cuarentena, liberación y merma; suite API en 38 pruebas; builds y smoke Docker verificados. | Reservas comerciales, sensores, notificaciones, D08/D09/D22 siguen fuera de alcance. |
| F4-WEB | Completada | Controller y módulo HTTP de compras, listados scoped de proveedores/presentaciones/órdenes y vista `/procurement` con alta de proveedor y orden de una línea; suite API en 39 pruebas; builds y smoke Docker verificados. | Recepción por lote, facturas/CxP e importación se mantienen para lotes posteriores. |
| F5-WEB | Completada | Ruta protegida de recepción, estados `PARTIALLY_RECEIVED`/`RECEIVED`, bloqueo de orden contra sobre-recepción concurrente y vista `/procurement/receiving` con lotes repetibles; suite focalizada de procurement 4/4, builds API/Web y smoke Docker verdes. Rama publicada en `origin/codex/f5-web-receiving`; facturas/CxP e importación siguen fuera de alcance. |
| F6-WEB | Completada | Migración `0011_hot_mongoose.sql`, turnos absolutos por caja, asignaciones múltiples, replay idempotente, bloqueo contra solapamiento concurrente y vista `/cash`; suite API enfocada 11/11, typecheck/builds y smoke Docker verdes. Rama publicada en `origin/codex/f6-web-cash-shifts`; apertura/cierre monetario, recurrencia, ventas y conciliación quedan fuera. |
| F7-WEB | Completada | Migración `0012_round_war_machine.sql`, controles 1:1 con estados `OPEN`/`PENDING_APPROVAL`/`CLOSED`, decimales exactos, locks, RLS, auditoría, idempotencia y acciones `/cash`; suite cash 8/8, API 47/47, typecheck, builds, Drizzle check, diff check y smoke Docker verdes. Rama publicada en `origin/codex/f7-cash-controls`. |

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

## Evidencia B06

- Red/Green: se escribieron pruebas rojas para `audit_events` inmutables, reintentos/conflictos de `idempotency_records`, `outbox_events` transaccional y asignación atómica de `document_sequences`; pasaron 22 pruebas verdes contra PostgreSQL real.
- Inmutabilidad: el trigger `trg_audit_events_immutable` rechaza de forma determinista cualquier intento de `UPDATE` o `DELETE` sobre `audit_events`.
- Idempotencia: payload canonicalizado con SHA-256; peticiones repetidas devuelven la respuesta en caché sin duplicar efectos y peticiones con payload conflictivo elevan `IDEMPOTENCY_KEY_REUSED` (409).
- Secuencias: concurrencia verificada sin colisiones ni duplicados gracias a bloqueo a nivel de fila `ON CONFLICT DO UPDATE RETURNING`.
- Migración: `0005_transversal_services.sql` versionada con Drizzle, aplicando RLS forzada y privilegios estrictos para `farmaxia_app`.
- Verificación global: `pnpm --filter @farmaxia/api test` (22 pruebas verdes en 8 suites), `tsc --noEmit` en API y Web, `pnpm build` en API y Web, y `drizzle-kit check` pasaron.

## Evidencia C03

- Red/Green: `apps/api/test/inventory.spec.ts` se escribió contra el servicio inexistente y luego verificó conciliación OUT, replay idempotente, bloqueo por reservas y corrección IN.
- Migración: `0008_messy_mauler.sql` se aplicó a PostgreSQL local y de pruebas; añade `inventory_reconciliations`, dirección de movimiento, FKs, RLS y privilegios mínimos.
- Verificación: `pnpm --filter @farmaxia/api test` pasó con 28 pruebas en 11 suites; `tsc --noEmit`, build API/web y `drizzle-kit check` pasaron.

## Evidencia B07

- Construcción: `docker compose build api web` compiló API NestJS y web Next.js desde `pnpm-lock.yaml` con Node 22.
- Ejecución: `docker compose up -d` levantó `postgres`, `redis`, `api` y `web`; la API aplicó migraciones automáticamente.
- Healthchecks: `docker compose ps` mostró los cuatro servicios saludables; `GET /health` y `GET /` respondieron HTTP 200.

## Evidencia F1-WEB

- Web: `pnpm --filter @farmaxia/web exec tsc --noEmit` y `pnpm --filter @farmaxia/web build` pasaron con rutas `/` y `/dashboard`.
- Sesión: el cliente usa login, refresh y logout contra los contratos existentes; el dashboard no inventa métricas ni entidades.
- CORS: preflight desde `http://localhost:3000` respondió `204` con origen y credenciales permitidos.
- Stack: las imágenes reconstruidas sirvieron API y web con HTTP 200; la regresión API quedó en 28 pruebas verdes.

## Evidencia F2-WEB

- Red/Green: `apps/api/test/catalog.spec.ts` comenzó fallando porque no existía `listProducts` y pasó después con búsqueda, paginación, categoría y presentaciones reales.
- API: `CatalogController` expone listado y altas de categorías, productos y presentaciones bajo `catalog.manage`; el listado mantiene el alcance tenant/sucursal mediante `withScope` y solo devuelve productos activos.
- Web: `/catalog` consume el API autenticado, permite buscar y dar de alta productos, y muestra presentaciones persistidas; no inventa precios, códigos de barras, homologaciones ni métricas.
- Verificación: la suite API pasó con 29 pruebas; `tsc --noEmit` y builds de API/Web pasaron; las cuatro imágenes Docker reconstruidas quedaron saludables, `/catalog` respondió HTTP 200 y el endpoint de catálogo sin bearer respondió HTTP 401.

## Evidencia C04

- Red/Green: las pruebas nuevas comenzaron con `TypeError: inventory.reserveFefo is not a function` y luego verificaron FEFO por factor, cruce de lotes, insuficiencia atómica, replay/conflicto de idempotencia, concurrencia, liberación, consumo y expiración.
- Persistencia: `0009_productive_human_torch.sql` crea `inventory_reservations` con estados, FK compuestas, RLS forzada, índice de expiración y privilegios mínimos.
- Servicio: `InventoryService` bloquea balances por `expires_on ASC, batch_id ASC`, mantiene `quantity_base` separado de `reserved_base`, registra movimientos OUT solo al consumir y audita cada transición.
- Verificación: `pnpm --filter @farmaxia/api test` pasó con 33 pruebas; `tsc --noEmit`, build y `drizzle-kit check` pasaron; Docker aplicó la migración, registró las cuatro rutas C04 y el endpoint sin bearer respondió HTTP 401.

## Evidencia C05

- Red/Green: las pruebas nuevas comenzaron con métodos inexistentes para
  alertas, cuarentena y merma; después verificaron 10 pruebas de inventario,
  incluyendo replay, cadena de frío, reservas activas y stock libre.
- Persistencia: `0010_wealthy_katie_power.sql` crea `inventory_operation_events`,
  restringe estados de lote a `AVAILABLE`/`QUARANTINED`/`DISPOSED`, aplica RLS
  forzada y concede privilegios mínimos.
- Servicio: `InventoryService` calcula alertas sin mutación, bloquea lote/saldo
  para cuarentena y merma, registra `WASTE`/`OUT` y expone reconciliación por
  `inventory.manage`.
- Verificación: suite API completa pasó con 37 pruebas; typecheck, builds,
  `drizzle-kit check` y Compose pasaron; los cuatro servicios quedaron
  healthy y el change se archivó en `openspec/changes/archive/2026-09-18-14-inventario-c05`.

## Evidencia F3-WEB

- Red/Green: la prueba scoped de almacenes comenzó con `listWarehouses` inexistente
  y pasó después con orden determinista por nombre/ID; la suite de inventario
  quedó en 11 pruebas y la suite API completa en 38.
- API: `GET /api/v1/inventory/warehouses` mantiene tenant/sucursal mediante
  `withScope`; las alertas incluyen `batchStatus` para decidir acciones sin
  inferir estado en el navegador.
- Web: `/inventory` usa la sesión y `inventory.manage`, evita respuestas
  obsoletas al cambiar filtros, conserva idempotencia en el cuerpo de cada
  mutación y ofrece estados vacíos, errores y layout responsive.
- Verificación: typecheck/build de API y Web, `git diff --check`, Compose,
  healthchecks y smoke HTTP fueron ejecutados antes de publicar el lote.

## Evidencia F4-WEB

- Red/Green: la prueba de listados comenzó con `listSuppliers` inexistente y
  pasó después con proveedores activos tenant-scoped, órdenes limitadas a la
  sucursal y líneas de presentación/producto.
- API: `ProcurementController` expone proveedores, presentaciones y órdenes
  bajo `inventory.manage`; `ProcurementModule` quedó registrado en `AppModule`.
- Web: `/procurement` permite registrar proveedores y crear una orden de una
  línea; muestra órdenes existentes, estados y aviso explícito de recepción
  diferida sin mutar stock.
- Verificación: suite completa pasó con 39 pruebas; typecheck/build API y Web,
  `drizzle-kit check`, Compose y smoke (`/procurement` 200, suppliers sin
  bearer 401) fueron ejecutados; change archivado en
  `openspec/changes/archive/2026-09-18-16-compras-f4-web`.

## Próxima tarea

Esperar revisión del parent antes de cualquier publicación; ventas y la
integración comercial de reservas continúan dependiendo de D09.
