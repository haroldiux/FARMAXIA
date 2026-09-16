# Tareas ejecutables — lote B01

- [x] B01.1 Crear workspace pnpm y configuración TypeScript compartida.
- [x] B01.2 Escribir una prueba de integración que describa `GET /health`.
- [x] B01.3 Implementar módulo/controlador health mínimo Nest/Fastify.
- [x] B01.4 Crear aplicación Next.js con página de preparación.
- [x] B01.5 Añadir Docker Compose, ejemplos de entorno e instrucciones.
- [x] B01.6 Ejecutar pruebas y builds; registrar resultados reales.

B02 empieza únicamente después de verificar B01. Creará tenant, sucursales, almacenes, cajas y membresías sin adelantar venta.

## Lote B02

- [x] B02.1 Escribir pruebas rojas de tablas, RLS y referencias cruzadas.
- [x] B02.2 Añadir schema Drizzle y migración versionada de tenants, estructura y membresías.
- [x] B02.3 Crear rol de aplicación local y políticas RLS/privilegios explícitos.
- [x] B02.4 Implementar `TenantDatabase` para contexto transaccional seguro.
- [x] B02.5 Ejecutar migración y pruebas contra PostgreSQL real; documentar evidencia.

## Lote B03

- [x] B03.1 Escribir pruebas rojas para login, selección de sucursal, refresh y rutas protegidas.
- [x] B03.2 Añadir roles, permisos, sesiones y políticas del rol de autenticación mediante migración Drizzle.
- [x] B03.3 Implementar hash Argon2id, access JWT y refresh rotativo.
- [x] B03.4 Implementar guards globales de identidad y permisos.
- [x] B03.5 Ejecutar pruebas de API contra PostgreSQL real y registrar evidencia.

## Lote B04

- [x] B04.1 Escribir pruebas rojas para el contexto tenant/usuario/sucursal, RLS de recursos internos y prefijos de caché.
- [x] B04.2 Reemplazar el acceso de aplicación solo por tenant con un contexto transaccional de tenant, usuario y sucursal.
- [x] B04.3 Añadir schema y migración para `background_jobs` y `tenant_files`, con FKs compuestas, claves de almacenamiento verificables y RLS forzada.
- [x] B04.4 Implementar el constructor validado de claves de caché tenant/sucursal.
- [x] B04.5 Migrar, probar y documentar la evidencia; no añadir worker, Redis de negocio, archivos binarios ni endpoint de exportación.

## Lote B05

- [x] B05.1 Escribir pruebas rojas para ciclo de estados, acceso por suscripción y cuotas finitas/ilimitadas.
- [x] B05.2 Añadir schema y migración para planes, entitlements, suscripciones, overrides y uso atómico de recursos.
- [x] B05.3 Implementar la máquina de estados con trial de 7 días, gracia de 3 días y alta directa `ACTIVE`.
- [x] B05.4 Implementar lectura de entitlements y consumo condicional de cuotas.
- [x] B05.5 Sembrar el plan `COMPLETO`, migrar y verificar las reglas con PostgreSQL real; no integrar pagos externos.

## Lote B06

- [x] B06.1 Escribir pruebas rojas para auditoría inmutable, idempotencia repetida/conflictiva, outbox y secuencias concurrentes.
- [x] B06.2 Añadir schema y migración RLS para eventos de auditoría, claves idempotentes, outbox y secuencias documentales.
- [x] B06.3 Implementar servicios transaccionales que compongan estos recursos dentro de `TenantDatabase.withScope`.
- [x] B06.4 Verificar concurrencia, RLS, inmutabilidad y migración real; no implementar worker, purgas, SIAT ni proveedores externos.

## Lote C01

- [x] C01.1 Escribir pruebas rojas de catálogo, precios, códigos y aislamiento.
- [x] C01.2 Añadir tablas Drizzle y migración `0006_cool_payback.sql` con FKs compuestas.
- [x] C01.3 Aplicar RLS, membresía de sucursal y privilegios mínimos a las tablas.
- [x] C01.4 Implementar `CatalogService`, búsqueda vigente y homologaciones preparadas.
- [x] C01.5 Ejecutar suite, typecheck, builds, `drizzle-kit check` y migración idempotente.
