# Specification: C02 — Compras y recepción

## C02.1 — Proveedores y órdenes

Un proveedor y una orden DEBEN pertenecer al tenant del contexto. Una orden DEBE
conservar almacén, estado, líneas por presentación, cantidad base y costo decimal
provisional. Las referencias cruzadas tenant/sucursal DEBEN validarse con FKs
compuestas y RLS.

### Scenario: orden aislada

- GIVEN una sucursal autorizada y un proveedor del mismo tenant
- WHEN se crea una orden con sus líneas
- THEN la orden queda asociada al almacén de la sucursal y no acepta una
  presentación de otro tenant

## C02.2 — Recepción idempotente por lote

Una recepción DEBE exigir una clave de idempotencia y conservar proveedor,
orden, almacén, fecha y líneas. Cada línea DEBE tener presentación, lote,
vencimiento, cantidad base y costo decimal. Repetir la misma clave y payload
DEBE devolver la recepción original sin incrementar nuevamente el saldo.

### Scenario: recepción válida

- GIVEN una orden enviada y una línea con lote L1
- WHEN se recibe la mercadería
- THEN se crea o reutiliza L1, aumenta el saldo del almacén y se registra un
  movimiento `RECEIPT` con referencia a la recepción

## C02.3 — Cuenta por pagar básica

Una factura de proveedor DEBE poder vincularse a una recepción y crear una cuenta
por pagar con monto original, saldo pendiente, moneda y vencimiento. C02 no
registra pagos ni concilia bancos.

## C02.4 — Integridad

La cantidad recibida y el costo DEBEN ser positivos. La recepción no DEBE aceptar
un almacén que no pertenece a la sucursal activa. Ninguna operación de C02 DEBE
alterar saldos sin insertar su movimiento de recepción.
