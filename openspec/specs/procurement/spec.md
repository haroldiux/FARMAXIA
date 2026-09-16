# Specification: Compras y recepción

## Requirements

### Requirement: Órdenes tenant-scoped

Proveedores y órdenes DEBEN pertenecer al tenant del contexto, conservar almacén,
estado, presentación, cantidad base y costo provisional, y usar FKs compuestas.

### Requirement: Recepción idempotente

Una recepción DEBE registrar lote, vencimiento, cantidad y costo. En una misma
transacción DEBE crear/reutilizar lote, incrementar saldo y registrar movimiento
`RECEIPT`. Repetir la clave no puede duplicar efectos.

### Requirement: Cuenta por pagar básica

Una factura vinculada a recepción DEBE crear un saldo pendiente con moneda y
vencimiento. C02 no procesa pagos ni conciliación.

### Requirement: Costos provisionales

Los costos se conservan como decimales de cuatro posiciones; el método de costeo,
impuestos, redondeo e importación histórica permanecen abiertos en D08/D22.
