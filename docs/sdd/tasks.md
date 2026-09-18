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

## Lote C02

- [x] C02.1 Escribir pruebas rojas de proveedor, orden, recepción idempotente, lotes, saldo/movimiento y cuenta por pagar.
- [x] C02.2 Añadir schema Drizzle y migración `0007_swift_supernaut.sql` con FKs compuestas.
- [x] C02.3 Aplicar RLS y privilegios mínimos por tenant/sucursal.
- [x] C02.4 Implementar `ProcurementService` para proveedores, órdenes, recepción y cuenta por pagar.
- [x] C02.5 Ejecutar pruebas, typecheck, builds, `drizzle-kit check` y migración idempotente; mantener D08/D22 abiertas.

## Lote C03

- [x] C03.1 Escribir pruebas rojas de dirección, ajuste, reserva, conciliación e idempotencia.
- [x] C03.2 Añadir dirección de movimiento, conciliaciones, FKs/RLS y migración `0008_messy_mauler.sql`.
- [x] C03.3 Implementar `InventoryService` con ajuste atómico, lectura de saldo, auditoría e idempotencia.
- [x] C03.4 Ejecutar suite PostgreSQL real (28 pruebas), typecheck, builds, `drizzle-kit check` y migración idempotente.
- [x] C03.5 Mantener D08/D22 abiertas y documentar evidencia para iniciar C04.

## Lote B07

- [x] B07.1 Crear Dockerfiles reproducibles para API y web.
- [x] B07.2 Añadir servicios API/web, healthchecks y dependencias al Compose.
- [x] B07.3 Ejecutar migraciones desde el arranque de la API.
- [x] B07.4 Construir y verificar los cuatro contenedores con HTTP 200.

## Lote F1-WEB

- [x] F1-WEB.1 Habilitar CORS explícito para el origen web local.
- [x] F1-WEB.2 Implementar login, refresh y logout contra la API existente.
- [x] F1-WEB.3 Implementar dashboard protegido con contexto y permisos efectivos.
- [x] F1-WEB.4 Verificar responsive shell, builds, CORS y stack Docker.

## Lote F2-WEB

- [x] F2-WEB.1 Escribir prueba de listado agrupado por producto/presentación.
- [x] F2-WEB.2 Implementar `CatalogService.listProducts` con búsqueda/paginación.
- [x] F2-WEB.3 Exponer controller/module con permiso `catalog.manage`.
- [x] F2-WEB.4 Implementar `/catalog` y enlazarlo desde el dashboard.
- [x] F2-WEB.5 Verificar suite (29 pruebas), builds, Docker y contratos.

## Lote C04

- [x] C04.1 Escribir pruebas rojas PostgreSQL para FEFO por factor, reservas,
  insuficiencia atómica, concurrencia y ciclo de vida.
- [x] C04.2 Añadir `inventory_reservations`, constraints, migración `0009` y
  RLS/privilegios mínimos.
- [x] C04.3 Implementar `reserveFefo` con locks, idempotencia y auditoría.
- [x] C04.4 Implementar liberar, consumir y expirar sin doble decremento.
- [x] C04.5 Exponer `InventoryController`/`InventoryModule` con
  `inventory.manage` y registrar `DatabaseModule` para servicios scoped.
- [x] C04.6 Verificar suite completa, typecheck, builds, `drizzle-kit check`,
  Docker y smoke HTTP; archivar y publicar.

## Lote C05

- [x] C05.1 Escribir pruebas rojas PostgreSQL para alertas de vencimiento,
  cuarentena/cadena de frío, mermas y operaciones idempotentes.
- [x] C05.2 Añadir `inventory_operation_events`, estados de lote, migración
  `0010`, RLS, privilegios mínimos y modelo DBML.
- [x] C05.3 Implementar alertas scoped, cuarentena/liberación y merma con
  locks, idempotencia y auditoría.
- [x] C05.4 Exponer conteo físico y las operaciones C05 bajo `inventory.manage`.
- [x] C05.5 Verificar suite completa (37 pruebas), typecheck, builds,
  `drizzle-kit check`, migración y Docker; dejar listo para archivar.

## Lote F3-WEB

- [x] F3-WEB.1 Escribir prueba scoped para almacenes y añadir contratos de
  cliente para almacenes, alertas, errores e idempotencia.
- [x] F3-WEB.2 Exponer `GET /api/v1/inventory/warehouses` y completar el
  estado de lote en las alertas C05.
- [x] F3-WEB.3 Implementar `/inventory` con selector de almacén, horizonte,
  alertas FEFO, estados vacíos y acciones confirmadas de cuarentena,
  liberación y merma.
- [x] F3-WEB.4 Enlazar Inventario desde el shell por `inventory.manage`,
  verificar responsive, API/Web y Docker; archivar y publicar.

## Lote F4-WEB

- [x] F4-WEB.1 Escribir prueba scoped para proveedores, presentaciones y
  órdenes con líneas de sucursal.
- [x] F4-WEB.2 Exponer controller/módulo de compras bajo `inventory.manage` y
  conservar el servicio C02 de recepción sin duplicar validación.
- [x] F4-WEB.3 Implementar `/procurement` con alta de proveedor, creación de
  orden de una línea, listados y aviso de recepción diferida.
- [x] F4-WEB.4 Verificar suite completa, builds, Docker, smoke y archivar/
  publicar el change.
