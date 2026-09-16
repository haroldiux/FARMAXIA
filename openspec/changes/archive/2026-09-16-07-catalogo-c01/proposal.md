# Proposal: C01 — Catálogo farmacéutico

## Intent

Crear el núcleo de catálogo que permita identificar productos farmacéuticos por
producto, presentación y código de barras, mantener precios por lista y guardar
homologaciones externas sin afirmar integración regulatoria.

## Scope

### In scope

- Categorías tenant-scoped con marca de producto controlado.
- Productos y presentaciones con factor entero hacia la unidad base.
- Códigos de barras únicos por tenant y búsqueda segura por código.
- Listas de precios globales o por sucursal y vigencias sin cálculos implícitos.
- Homologaciones externas preparadas para códigos SIAT u otra autoridad, sin
  llamadas al proveedor.
- RLS, FKs compuestas y servicios transaccionales probados contra PostgreSQL.

### Out of scope

- Compras, recepción, lotes, saldos y FEFO (C02–C04).
- Venta, caja, reservas y descuentos.
- Validación real SIAT o habilitación de medicamentos controlados (D03/D13).
- Decidir redondeo, costos o impuestos de dinero (D08 permanece abierta).

## Risks and rollback

Las referencias cruzadas tenant/sucursal podrían permitir datos de otra
organización si se escriben solo desde el cliente; se mitigan con FKs compuestas,
RLS y servicios que siempre usan `TenantDatabase.withScope`. Si la migración
resultara incorrecta, se detiene el despliegue y se revierte la migración C01
antes de utilizar sus tablas; no se alteran las tablas de ventas inexistentes.
