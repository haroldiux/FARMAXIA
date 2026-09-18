# Proposal: C03 — Movimientos y conciliación de inventario

## Intent

Completar el núcleo de inventario con ajustes autorizados y conteos físicos
trazables. Cada variación debe conservar dirección, referencia, auditoría y una
conciliación idempotente, sin seleccionar aún un método de costeo.

## Scope

### In scope

- Dirección `IN`/`OUT` explícita para movimientos y recepción existente.
- Conciliación por lote/almacén con cantidad esperada, contada y diferencia.
- Ajuste atómico que nunca deja saldo negativo ni menor que reservado.
- Idempotencia, auditoría y RLS tenant/sucursal.
- Consulta de saldo por almacén/lote.

### Out of scope

- FEFO, reservas, vencimientos avanzados y cuarentena operativa (C04/C05).
- Método de costeo, promedio/FIFO/ponderado e impuestos (D08).
- Traspasos entre sucursales (F6) y ventas.
- Importación de saldos históricos (D22).

## Rollback

La migración C03 se revierte antes de producir ajustes; no se eliminan
recepciones ni movimientos existentes. Si falla la nueva restricción de saldo,
se detiene el despliegue y se conserva la migración C02 como base operativa.
