# Propuesta — Inventario operativo C04

## Problema

C03 persiste movimientos, saldos por lote y conciliaciones, pero todavía no
existe una operación transaccional que seleccione lotes por FEFO ni que
aparte disponibilidad para operaciones futuras. La venta y la proforma aún no
son parte de este lote.

## Resultado deseado

Incorporar un motor de inventario operativo que:

- convierta cantidades comerciales a unidades base mediante la presentación;
- seleccione lotes vendibles por vencimiento más próximo y desempate estable;
- reserve unidades sin disminuir el stock físico;
- libere, consuma o expire reservas de forma idempotente y auditable;
- mantenga aislamiento tenant/sucursal y sea seguro ante concurrencia.

## Alcance

- Migración/RLS para `inventory_reservations`.
- `InventoryService` con FEFO, reserva, liberación, consumo y expiración.
- Endpoints protegidos por `inventory.manage` para el primitive operativo.
- Pruebas PostgreSQL reales de FEFO, insuficiencia atómica, replay,
  concurrencia lógica, liberación, consumo y vencimiento.
- La futura proforma/venta decide cómo invocar estos primitives.

## No objetivos

- No implementar ventas, proformas, caja ni asignaciones de líneas de venta.
- No cerrar D08 (costeo) ni D09 (política comercial de proformas/reservas).
- No habilitar productos controlados, cuarentena avanzada, mermas o
  importación histórica (C05/C06/D13/D22).

## Riesgos y mitigaciones

- **Doble reserva:** filas de saldo se bloquean en orden FEFO dentro de una
  transacción y toda la operación usa idempotencia.
- **Disponibilidad fantasma:** `reserved_base` se incrementa junto con cada
  reserva; si no hay capacidad suficiente, toda la transacción se revierte.
- **Reserva abandonada:** la expiración libera el contador y deja auditoría.
- **Decisión de producto pendiente:** no se crea flujo de proforma ni TTL
  implícito; el caller entrega explícitamente `expiresAt`.
