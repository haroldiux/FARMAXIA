# Contexto actual de FARMAXIA

**Fecha de actualización:** 22 de septiembre de 2026  
**Rama actual:** `codex/f9-global-inventory-report`  
**Repositorio:** `https://github.com/haroldiux/FARMAXIA`

## 1. Resumen ejecutivo

FARMAXIA es un sistema multi-tenant para la operación de farmacias, con API
NestJS/Fastify, aplicación Web Next.js, PostgreSQL con RLS, Redis y Docker
Compose. La base técnica, autenticación, permisos, suscripciones, catálogo,
compras, recepción, inventario, caja y reportes operativos ya están
implementados en distintos lotes.

La regla de trabajo vigente es **Organic Driven Development (ODD)** con TDD
estricto cuando se implementan funcionalidades: RED → GREEN → REFACTOR. Cada
lote sustancial se documenta en `odd/tasks/`, se espeja en Engram y se entrega
en commits convencionales por unidad de trabajo.

## 2. Stack y arquitectura

- **Web:** Next.js, React, TypeScript.
- **API:** Node.js, NestJS con Fastify.
- **Persistencia:** PostgreSQL, Drizzle ORM/migraciones SQL.
- **Seguridad:** JWT de corta duración, refresh rotativo, Argon2id, RBAC,
  permisos explícitos y Row-Level Security.
- **Infraestructura local:** Docker Compose con API, Web, PostgreSQL y Redis.
- **Aislamiento:** contexto transaccional tenant/usuario/sucursal mediante
  `TenantDatabase.withScope`.
- **Integridad transversal:** auditoría inmutable, idempotencia, outbox y
  secuencias documentales.

## 3. Trabajo realizado

### Fundación y dominio

- Workspace pnpm, TypeScript compartido, API/Web y Docker Compose.
- Tenants, sucursales, almacenes, cajas, membresías y RLS.
- Autenticación, refresh/logout, roles, permisos y dashboard protegido.
- Estados de suscripción: `TRIALING` de 7 días, alta directa `ACTIVE`, gracia
  de 3 días para `PAST_DUE`, y bloqueo en `SUSPENDED`/`CANCELED`.
- Auditoría, idempotencia, outbox y secuencias.

### Inventario y compras

- Catálogo base y catálogo operativo.
- Proveedores, órdenes, recepción parcial/final, lotes, saldos y cuentas por
  pagar persistidas.
- Movimientos, conciliaciones, ajustes, FEFO, reservas, vencimientos,
  cuarentena, cadena de frío, mermas y conteos autorizados.
- Política de inventario confirmada: FEFO para dispensación física y costo
  promedio ponderado móvil para valoración/COGS, conservando costos por lote.

### Lotes Web publicados

- **F5:** recepción Web por lotes e idempotencia.
- **F6:** turnos configurables por caja, usuario y horario sin solapamientos.
- **F7:** apertura/cierre monetario con estados `OPEN`, `PENDING_APPROVAL` y
  `CLOSED`, diferencias exactas y aprobación supervisada.
- **F8:** listas de precios, precios fechados sin solapamientos por alcance,
  precedencia sucursal/global y códigos de barras.
- **F9:** reporte global de inventario multi-sucursal, solo lectura, con permiso
  `inventory.report.global`, RLS SELECT-only, filas jerárquicas por sucursal →
  almacén → producto → presentación, subtotales y total tenant.

## 4. Ramas y commits publicados

| Lote | Rama | Commit principal |
| --- | --- | --- |
| F5 | `codex/f5-web-receiving` | `4f91e64` |
| F6 | `codex/f6-web-cash-shifts` | `f135c1c` |
| F7 | `codex/f7-cash-controls` | `90e1f59` |
| F8 | `codex/f8-catalog-operations` | `66855fa` |
| F9 | `codex/f9-global-inventory-report` | `2893a1b` |

Los commits documentales de publicación de F8 y F9 son `8eaf9ff` y `7af2fa2`.
Las ramas F8 y F9 ya están publicadas en `origin`.

## 5. Verificación actual

### Verificado

- Typecheck y build de API.
- Typecheck/build de Web.
- `drizzle-kit check` con `DATABASE_URL` configurado.
- `git diff --check`.
- Revisión estática independiente de F8 y F9 sin bloqueos críticos.

### Pendiente por infraestructura

- Suite de integración PostgreSQL/RLS de F8 y F9.
- Smoke completo de Docker Compose.

En las últimas verificaciones, PostgreSQL en `localhost:5433` rechazó la
conexión y el motor Linux de Docker Desktop no estaba disponible. Estos son
bloqueos de entorno, no resultados funcionales aprobados.

El directorio `.codegraph/` permanece sin seguimiento intencionalmente.

## 6. Decisiones confirmadas

- Los intervalos de precios de la misma presentación y alcance no pueden
  solaparse; los intervalos adyacentes sí son válidos.
- Un precio de sucursal prevalece sobre el precio global.
- El reporte global de inventario es un lote separado de catálogo y usa un
  permiso global dedicado.
- La valorización de inventario no se mezcla con el reporte operativo F9.
- No se implementan todavía pagos, conciliación bancaria, impuestos,
  redondeos fiscales ni integración SIAT.

## 7. Pendiente inmediato

### F10 recomendado: facturas de proveedores y cuentas por pagar básicas

La persistencia y el servicio de creación de facturas/cuentas por pagar ya
existen dentro de Procurement, pero todavía falta exponerlos por API y Web.
El alcance recomendado es:

- alta de factura vinculada a recepción;
- listado de facturas y saldos abiertos/vencidos;
- importes como cadenas decimales exactas;
- vista Web de carga y aging básico;
- sin pagos, liquidaciones parciales, conciliación bancaria, impuestos,
  valoración, importaciones ni exportaciones.

### Decisión pendiente para F10

Definir si las cuentas por pagar serán **centralizadas a nivel tenant** o
**propias de cada sucursal**. Las tablas actuales no tienen `branch_id`, por lo
que la recomendación inicial es centralizar la administración financiera.

### Verificación pendiente de F9

Cuando PostgreSQL y Docker estén disponibles, ejecutar nuevamente la suite
focalizada, validar las políticas RLS de lectura cross-branch y realizar smoke
HTTP de API/Web.

## 8. Archivos de referencia

- `ESTADO_IMPLEMENTACION.md` — estado resumido por lote.
- `docs/sdd/tasks.md` — tareas históricas y lotes funcionales.
- `docs/api-contracts.md` — contratos HTTP y permisos.
- `docs/test-matrix.md` — matriz de pruebas.
- `odd/tasks/f8-catalog-operations.md` — alcance/evidencia de F8.
- `odd/tasks/f9-global-inventory-report.md` — alcance/evidencia de F9.
- `apps/api/src/inventory/` — servicios, controlador y reportes de inventario.
- `apps/api/src/procurement/` — proveedores, recepción, facturas y cuentas por
  pagar.

