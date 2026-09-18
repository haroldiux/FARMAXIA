# Propuesta — Inventario operativo C05

## Problema

C04 ya reserva por FEFO, pero el inventario todavía no tiene un flujo
auditable para detectar vencimientos próximos, retirar lotes no vendibles,
registrar mermas ni cerrar conteos físicos autorizados. Sin estos primitives el
stock puede seguir apareciendo disponible aunque exista una incidencia
operativa.

## Resultado deseado

Incorporar un lote operativo que:

- consulte alertas de vencimiento con un horizonte explícito;
- permita poner y sacar lotes de cuarentena con motivo y auditoría;
- registre una merma física sin superar unidades disponibles ni tocar reservas;
- cierre un conteo físico mediante la conciliación idempotente existente;
- mantenga aislamiento tenant/sucursal, RLS y consistencia transaccional.

## Alcance

- Migración/RLS para eventos operativos de inventario y restricciones de estado.
- `InventoryService` con alertas, cuarentena, merma y conteo autorizado.
- Endpoints protegidos por `inventory.manage`.
- Pruebas PostgreSQL reales de vencimientos, aislamiento, concurrencia,
  idempotencia y auditoría.
- Actualización de especificación canónica, DBML, estado y documentación de
  verificación.

## No objetivos

- No implementar ventas, proformas, caja, transferencias ni costeo D08.
- No importar saldos históricos ni cerrar D22.
- No construir todavía una pantalla web de inventario; el endpoint queda listo
  para el lote F3-WEB.
- No convertir alertas en un worker o proveedor de notificaciones externo.

## Capacidades

### Nuevas capacidades

- `inventory-operations`: alertas de vencimiento, cuarentena, mermas y conteos
  físicos autorizados, con alcance por tenant/sucursal.

### Capacidades modificadas

- `inventory`: lotes en cuarentena dejan de ser elegibles para FEFO y los
  movimientos operativos quedan auditados.

## Enfoque

Extender `InventoryService` con transacciones `TenantDatabase.withScope` y
idempotencia para mutaciones. Añadir una tabla de eventos operativos que
registre motivo, cantidades y actor; las alertas se calculan desde lotes y
saldos actuales, sin persistir notificaciones duplicadas. La cuarentena cambia
el estado del lote bajo lock y no permite ocultar stock reservado. La merma
decrementa únicamente stock libre y crea movimiento `OUT`; el conteo reutiliza
la reconciliación atómica de C03 con una autorización explícita.

## Áreas afectadas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `apps/api/src/inventory` | Modificada | Servicio, controller, módulo y pruebas C05. |
| `apps/api/src/database/schema.ts` | Modificada | Tablas/índices/restricciones nuevas. |
| `apps/api/drizzle` | Nueva migración | RLS, privilegios y constraints. |
| `docs/data-model.dbml` | Modificada | Modelo de eventos operativos. |
| `openspec/specs/inventory` | Modificada | Requisitos canónicos C05. |

## Riesgos y mitigaciones

| Riesgo | Probabilidad | Mitigación |
|--------|--------------|------------|
| Merma sobre stock reservado | Media | Lock de saldo y condición `quantity - reserved >= qty`. |
| Cuarentena con reservas activas | Media | Rechazar transición hasta liberar/consumir reservas; no mutar contadores implícitamente. |
| Duplicación por reintentos | Media | Clave de idempotencia por operación y payload conflictivo rechazado. |
| Alertas fuera de alcance | Baja | Todas las consultas filtran tenant y membresía de sucursal mediante `withScope`/RLS. |

## Rollback

Revertir el commit del lote y ejecutar la migración inversa en una ventana
controlada. Antes de eliminar datos, exportar los eventos operativos y
confirmar que no existan consumidores F3-WEB; las tablas nuevas son aditivas y
no requieren borrar movimientos históricos para desactivar el código.

## Dependencias

- PostgreSQL real del Compose y migraciones Drizzle existentes hasta `0009`.
- Permiso `inventory.manage` y servicios transversales B06.
- D09, D08 y D22 permanecen sin resolver.

## Criterios de éxito

- [ ] Las alertas devuelven solo lotes vendibles/no vendibles dentro del
  horizonte solicitado y respetan tenant/sucursal.
- [ ] Cuarentena, merma y conteo son transaccionales, idempotentes y auditables.
- [ ] Ninguna operación crea disponibilidad negativa ni permite FEFO sobre un
  lote cuarentenado.
- [ ] Suite PostgreSQL, typecheck, builds, `drizzle-kit check` y migración
  idempotente pasan; el stack Docker permanece saludable.
