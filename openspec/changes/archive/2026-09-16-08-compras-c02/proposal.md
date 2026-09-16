# Proposal: C02 — Compras, recepción y cuentas por pagar básicas

## Intent

Registrar proveedores y órdenes de compra, recibir mercadería por lote y fecha
en un almacén y conservar una cuenta por pagar básica, sin adelantar reglas de
costeo, importación real ni pagos a proveedores.

## Scope

### In scope

- Proveedores y órdenes de compra tenant-scoped.
- Recepciones idempotentes con líneas por presentación, lote, vencimiento,
  cantidad y costo decimal provisional.
- Creación/reutilización de lotes e incremento atómico de saldo por almacén.
- Movimiento `RECEIPT` como registro del incremento; no se permiten ajustes
  directos de saldo desde el servicio.
- Factura de proveedor y cuenta por pagar básica con saldo pendiente.
- RLS, claves compuestas, auditoría/outbox e idempotencia existentes.

### Out of scope

- Método de costeo final, impuestos o redondeo (D08).
- Importación/migración de inventario real (D22).
- FEFO, reservas, cuarentena avanzada, mermas y conteo físico (C04/C05).
- Pagos a proveedor, conciliación bancaria y conectores externos.

## Rollback

Si la migración falla, se revierte antes de habilitar recepción. Las tablas nuevas
son independientes de ventas; el rollback elimina únicamente la migración C02 en
un entorno sin datos productivos.
