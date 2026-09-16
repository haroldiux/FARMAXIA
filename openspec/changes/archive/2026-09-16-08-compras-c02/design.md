# Diseño técnico: C02 — Compras y recepción

## Persistencia

Se añadirán `suppliers`, `purchase_orders`, `purchase_order_items`,
`goods_receipts`, `goods_receipt_items`, `inventory_batches`,
`inventory_balances`, `inventory_movements`, `supplier_invoices` y `payables`.
Todas las tablas llevan `tenant_id`; las tablas de almacén usan FK compuesta con
`warehouses`. RLS exige una membresía de sucursal activa y las mutaciones solo se
exponen mediante servicios scoped.

`inventory_balances` es un contador por almacén/lote. Una recepción incrementa el
contador con `UPDATE ... quantity_base + requested` dentro de la transacción y
siempre inserta un `inventory_movements` de tipo `RECEIPT`. C03 podrá añadir
otros tipos sin permitir ajustes silenciosos.

## Servicio

`ProcurementService` crea proveedores/órdenes y ejecuta `receive` mediante el
`IdempotencyService` B06. La acción inserta recepción y líneas, crea o reutiliza
el lote por `(tenant, presentation, lot_code)`, actualiza balance y registra el
movimiento. Devuelve el ID de recepción y el saldo resultante.

Los costos se guardan como `numeric(18,4)` y se validan como decimales positivos,
pero C02 no escoge promedio, FIFO, ponderado ni redondeo: esa decisión continúa
en D08. No se importan datos históricos y D22 continúa abierta.
