# Contratos de API y autorización

Las rutas de dominio se publicarán bajo `/api/v1`. UUID de tenant, sucursal y caja enviados por el cliente son referencias solicitadas, nunca autorización: el backend los contrasta con identidad y membresías de la sesión.

| Elemento | Regla |
| --- | --- |
| Identidad | Sesión autenticada aporta `userId`; backend deriva tenants, roles y sucursales permitidas. |
| Tenant | Una mutación trabaja en un único tenant y establece contexto RLS transaccional. |
| Idempotencia F11 | El cliente Web envía `Idempotency-Key` y el mismo valor en `idempotencyKey`; la confirmación de ventas usa la clave del cuerpo. Misma clave y cuerpo normalizado igual reproduce el resultado; un cuerpo distinto genera conflicto por reutilización de clave. |
| Errores | `{ "error": { "code", "message", "requestId", "details?" } }`; los detalles no filtran otro tenant. |

## Autenticación y contexto

| Ruta | Acceso y contrato |
| --- | --- |
| `POST /api/v1/auth/login` | Pública. Recibe `email`, `password`, `tenantId` y `branchId`; responde `201` con `{ accessToken, expiresInSeconds }` solo tras validar contraseña, usuario activo y membresía exacta. Cualquier fallo responde `401` sin revelar la causa. |
| `POST /api/v1/auth/refresh` | Pública y usa la cookie `farmaxia_refresh`. Revoca el refresh presentado y responde un nuevo access token y cookie; repetir el refresh anterior responde `401`. |
| `POST /api/v1/auth/logout` | Pública y revoca la sesión indicada por cookie; responde `204` y elimina la cookie. |
| `GET /api/v1/auth/me` | Requiere `Authorization: Bearer <accessToken>` y devuelve `userId`, `tenantId`, `branchId` y permisos efectivos. |

El access token dura 15 minutos, está emitido para `farmaxia-api` y tiene audiencia
`farmaxia-web`. El refresh se conserva solo en una cookie `HttpOnly`,
`SameSite=Strict`, limitada a `/api/v1/auth`; en producción también es `Secure`.
Los valores de tenant y sucursal del login son una solicitud de contexto: nunca
autorizan por sí mismos y deben coincidir con la membresía del usuario. Las rutas
son privadas por defecto; una ruta protegida por `@RequirePermissions(...)` exige
todas las autorizaciones declaradas.

## `POST /api/v1/sales/confirm` (F11)

Confirma una venta **no fiscal** pagada en efectivo, tarjeta o QR (F11 + módulo 5 T1; pagos combinados permitidos). Requiere el permiso `sales.confirm`; el backend deriva `tenantId`, `branchId` y `userId` de la sesión autenticada. No acepta `branchId`, `cashRegisterId` ni otro dato del cliente como autorización.

El cliente Web envía el encabezado `Idempotency-Key` y repite ese valor en `idempotencyKey` del cuerpo. La implementación del endpoint toma la clave del cuerpo; el encabezado por sí solo no sustituye `idempotencyKey`. Reutilizar la misma clave con el mismo cuerpo normalizado reproduce el resultado original; reutilizarla con un cuerpo distinto genera un conflicto de idempotencia.

```json
{
  "idempotencyKey": "uuid",
  "cashShiftId": "uuid",
  "warehouseId": "uuid",
  "payments": [
    { "method": "CARD", "amountBob": "10.0000", "reference": "AUTH-123" },
    { "method": "CASH", "amountBob": "20.0000" }
  ],
  "lines": [
    {
      "presentationId": "uuid",
      "quantity": 2,
      "unitPriceBob": "12.5000"
    }
  ]
}
```

| Campo | Regla implementada |
| --- | --- |
| `cashShiftId` | Debe corresponder a un control de caja `OPEN`, asignado al usuario autenticado, dentro del tenant y sucursal de la sesión. |
| `warehouseId` | Debe existir en el tenant/sucursal de la sesión y tener despacho habilitado. |
| `payments` | Entre 1 y 10 pagos `{ method, amountBob, reference? }`. `method` es `CASH`, `CARD` o `QR`; `amountBob` es un decimal mayor que cero. `CARD` y `QR` exigen `reference` (máx. 64 caracteres, registrada manualmente: sin pasarela, decisión provisional D43); `CASH` no admite referencia. |
| Compatibilidad | Si se omite `payments`, se acepta la forma anterior `paymentMethod` + `paidAmountBob` como un único pago. |
| `unitPriceBob` | Cadena decimal no negativa, con hasta cuatro decimales. Los montos se conservan como cadenas decimales exactas; las sumas se calculan con enteros escalados (nunca punto flotante). |
| `lines` | Debe contener entre 1 y 100 líneas; cada `presentationId` debe ser vendible y cada `quantity` un entero positivo seguro. |

La confirmación asigna y consume stock disponible por FEFO (vencimiento ascendente y, ante empate, identificador de lote), sin usar lotes vencidos. Los pagos deben cubrir el total calculado; solo el efectivo puede excederlo y el exceso es el cambio (`changeAmountBob`, nunca mayor que el efectivo entregado). Los pagos `CARD`/`QR` no pueden superar lo que falta por cobrar. Al control de caja solo se suma el efectivo neto (efectivo entregado menos cambio); tarjeta y QR no entran al efectivo esperado. Venta, ítems, pagos, consumo/movimientos de inventario, actualización del control de caja, auditoría y evento outbox se ejecutan de forma transaccional.

La respuesta es un `ConfirmedSale`:

```json
{
  "id": "uuid",
  "saleNumber": "V-MAIN-000001",
  "cashShiftId": "uuid",
  "warehouseId": "uuid",
  "status": "CONFIRMED",
  "totalBob": "25.0000",
  "paidAmountBob": "30.0000",
  "changeAmountBob": "5.0000",
  "payments": [
    { "method": "CARD", "amountBob": "10.0000", "reference": "AUTH-123" },
    { "method": "CASH", "amountBob": "20.0000", "reference": null }
  ],
  "items": [
    {
      "presentationId": "uuid",
      "quantity": 2,
      "quantityBase": 2,
      "unitPriceBob": "12.5000",
      "lineTotalBob": "25.0000",
      "allocations": [
        {
          "batchId": "uuid",
          "lotCode": "LOTE-001",
          "expiresOn": "2026-12-31",
          "quantityBase": 2
        }
      ]
    }
  ]
}
```

| Situación | Comportamiento implementado |
| --- | --- |
| Datos inválidos | Error de validación para campos requeridos, decimales, cantidades, líneas o pagos inválidos (método desconocido, `CARD`/`QR` sin referencia, pagos que no cubren el total o tarjeta/QR por encima de lo adeudado). |
| Sin `sales.confirm` | Acceso prohibido. |
| Turno ausente, no abierto o no asignado | Conflicto: se requiere un turno abierto asignado al usuario autenticado. |
| Almacén o presentación no disponible | La operación se rechaza cuando el almacén no permite despacho o la presentación no es vendible en el tenant. |
| Inventario insuficiente | Conflicto sin confirmar una venta parcial. |
| Reutilización de `idempotencyKey` | El mismo cuerpo normalizado reproduce la venta; un cuerpo diferente provoca conflicto. |

`saleNumber` es el número legible por sucursal `V-<código de sucursal>-000001`, consecutivo y único por sucursal (secuencia documental `SALE`).

## `GET /api/v1/sales` y `GET /api/v1/sales/{saleId}` (módulo 5 T2)

Historial, detalle y datos del recibo. Permiso nuevo `sales.read` ("Consultar ventas", módulo "Caja y ventas"), sembrado por la migración `0021_sales_history.sql` para Propietario, Regente, Encargado y Cajero de las farmacias existentes y definido en las plantillas de rol de las nuevas.

- **Alcance:** siempre el tenant y la sucursal activa de la sesión. Una venta de otra sucursal o farmacia responde `404`.
- **Quién ve qué:** quien tiene `sales.read` y además `cash.shift.approve` o `catalog.manage` (Propietario, Regente, Encargado) ve todas las ventas de la sucursal. Los demás (por ejemplo, un Cajero con `sales.confirm` + `sales.read`) ven solo las ventas que ellos registraron; ver una venta ajena responde `404`.
- `GET /api/v1/sales` exige `sales.read`. `GET /api/v1/sales/{saleId}` acepta `sales.read` o `sales.confirm` (este último solo para una venta propia, para imprimir el recibo tras cobrar).

`GET /api/v1/sales` admite los filtros `from`/`to` (fechas `YYYY-MM-DD` inclusivas, hora de Bolivia `America/La_Paz`), `cashShiftId`, `cashierId`, `status` (`CONFIRMED` o `VOIDED`), `limit` (1–200, por defecto 50) y `offset`. Orden: más recientes primero. Fecha, UUID o estado inválidos responden `400`.

```json
{
  "items": [
    {
      "id": "uuid",
      "number": "V-MAIN-000002",
      "createdAt": "2026-01-10T15:00:00.000Z",
      "status": "CONFIRMED",
      "cashierId": "uuid",
      "cashierName": "Cajero Dos",
      "cashShiftId": "uuid",
      "totalBob": "25.0000",
      "paidAmountBob": "30.0000",
      "changeAmountBob": "5.0000",
      "paymentMethods": ["CARD", "CASH"]
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0
}
```

`GET /api/v1/sales/{saleId}` devuelve la cabecera (`id`, `number`, `status`, `createdAt`, montos exactos como cadenas), `cashier { id, name }`, `shift { id, registerCode }`, `branch { id, code, name }`, `pharmacy { name, legalName, taxId }`, `warehouse { id, name }`, `items[]` (`productName`, `presentationName`, `quantity`, `quantityBase`, `unitPriceBob`, `lineTotalBob`, `allocations[]` con `lotCode`, `expiresOn`, `quantityBase`) y `payments[]` (`method`, `amountBob`, `reference`, ordenados por método). El recibo imprimible es **no fiscal** (decisión provisional D44): HTML para impresión del navegador en papel térmico de 58 u 80 mm, sin controlador de impresora.

La migración `0021` también separa la política RLS de `sales`: la lectura queda abierta a los miembros de la sucursal (el API restringe a los cajeros a sus ventas) y la escritura sigue limitada al usuario que registró la venta.

**Fuera de alcance:** documentos fiscales, pasarelas y conciliación de tarjeta/QR, pagos a crédito o convenio, devoluciones, cotizaciones, impuestos, promociones, conversiones de moneda, conciliación de pasarelas y liquidación contable.

## `GET /api/v1/sales/lookup` (módulo 5 T3)

Búsqueda compacta del mostrador. Exige `sales.confirm` (módulo `pos`) y se limita al tenant y la sucursal del token.

- Parámetros: `q` (obligatorio, 1–80 caracteres), `warehouseId` (obligatorio, almacén activo de la sucursal; otro almacén responde `404`) y `limit` (1–50, por defecto 20). Entradas inválidas responden `400`.
- Busca, sin distinguir mayúsculas, en nombre del producto, DCI (`genericName`), principio activo, laboratorio y nombre de la presentación; un código de barras exacto se resuelve primero. Solo presentaciones vendibles y activas de productos activos.
- Respuesta `{ items[] }` con `presentationId`, `productId`, `productName`, `presentationName`, `genericName`, `activeIngredient`, `laboratory`, `baseUnitFactor`, `priceBob` (precio vigente de la sucursal o de la lista general, cadena decimal exacta o `null`), `availableBase`, `availableQuantity` (unidades de presentación vendibles ahora: lotes `AVAILABLE`, no vencidos y sin reservas, en el almacén) y `barcode` (el código que coincidió o `null`).

### Precio autoritativo en `POST /api/v1/sales/confirm`

El servidor decide el precio de cada línea dentro de la transacción, con la misma resolución que `GET /api/v1/sales/lookup` (lista de la sucursal sobre la general, vigente ahora, moneda BOB).

- `lines[].unitPriceBob` es opcional. Si se omite se cobra el precio vigente; si se envía y difiere, responde `409` con `{ code: "PRICE_CHANGED", presentationId, currentPriceBob }` y no se mueve stock ni caja.
- Si la presentación no tiene precio vigente responde `409` con `{ code: "PRICE_NOT_FOUND", presentationId }`.
- Los totales, la validación de pagos y los precios guardados en `sale_items` usan el precio resuelto. El hash de idempotencia sigue calculándose sobre la solicitud normalizada del cliente.

## Cambio de lote autorizado (módulo 5 T6)

Por defecto cada línea consume por FEFO. Un usuario con el permiso `sales.fefo.override` («Elegir lote distinto al FEFO»; Propietario, Regente y Encargado, no Cajero) puede fijar el lote. Decisión provisional D47.

- `POST /api/v1/sales/confirm`: `lines[].batchId` (UUID, opcional) y `overrideReason` (obligatorio, 1 a 200 caracteres, cuando alguna línea trae `batchId`). Sin `batchId` el comportamiento no cambia. El hash de idempotencia incluye `batchId` y `overrideReason`.
- Sin el permiso responde `403` con `{ code: "FEFO_OVERRIDE_FORBIDDEN" }`. Sin motivo o con más de 200 caracteres responde `400`.
- El lote debe existir con stock en el almacén de la venta, ser del mismo producto, estar `AVAILABLE` y vigente, y cubrir toda la cantidad de la línea sin contar reservas; si no, `409` con `code` `FEFO_BATCH_NOT_FOUND`, `FEFO_BATCH_MISMATCH`, `FEFO_BATCH_UNAVAILABLE` o `FEFO_BATCH_INSUFFICIENT` (y `batchId`). No se mueve stock ni caja.
- El consumo se registra como en FEFO (`sale_allocations`), así que anulaciones y devoluciones devuelven el stock al lote elegido. Si el lote elegido difiere del que habría elegido FEFO, `sale_items` y `sale_allocations` guardan `fefoOverride = true` (más `fefoOverrideReason` en la línea) y se audita `sales.fefo_override` con `saleItemId`, `presentationId`, `chosenBatchId`, `fefoBatchId` y `reason`.
- Respuesta de la venta y `GET /api/v1/sales/:id`: cada línea trae `fefoOverride` y `fefoOverrideReason`; cada asignación trae `fefoOverride`. El recibo indica el lote elegido manualmente.
- `GET /api/v1/sales/lookup/batches?presentationId=&warehouseId=` (permiso `sales.fefo.override`): lotes `AVAILABLE`, vigentes y con stock sin reservar de la presentación en el almacén, en orden FEFO, con `{ batchId, lotCode, expiresOn, availableBase, fefoSuggested }`; el primero es el sugerido.

## Anulaciones y devoluciones (módulo 5 T5)

Ambas rutas exigen el permiso `sales.void` («Anular ventas y registrar devoluciones»; Propietario, Regente y Encargado, no Cajero), requieren `idempotencyKey` (cuerpo o cabecera) y responden `404` para ventas de otra sucursal u otro tenant. Quien solo tiene visión propia (ver `sales.read`) únicamente alcanza sus ventas. Decisión provisional D46.

Estados de venta: `CONFIRMED` (completada), `PARTIALLY_RETURNED`, `RETURNED`, `VOIDED`. `VOIDED` y `RETURNED` son terminales (también por trigger en base de datos).

### `POST /api/v1/sales/{saleId}/void`

Cuerpo: `{ idempotencyKey, reason }` (`reason` obligatorio, máx. 200).

- Solo si la venta está `CONFIRMED` (sin devoluciones) y el turno de caja de la venta sigue `OPEN`; si no, `409`.
- Atómico: cada cantidad consumida vuelve **al lote original exacto** (movimiento `SALE_VOID` de entrada vinculado a la venta; no se vuelve a ejecutar FEFO), el efectivo esperado del turno baja en el efectivo neto de la venta (efectivo recibido − cambio; `409 CASH_VOID_EXCEEDS_EXPECTED` si quedaría negativo), los pagos CARD/QR quedan marcados como revertidos (manual, sin pasarela) y la venta pasa a `VOIDED` con `voided_at`, `voided_by_user_id` y `void_reason`.
- Respuesta `200`: `{ id, saleNumber, status: "VOIDED", reason, voidedAt, cashReversedBob }`. Auditoría `sales.sale_voided` y evento de outbox del mismo nombre. Un reintento con la misma clave devuelve la misma respuesta.

### `POST /api/v1/sales/{saleId}/returns`

Cuerpo: `{ idempotencyKey, reason, refundMethod: "CASH"|"CARD"|"QR", refundReference?, restock: boolean, lines: [{ saleItemId, quantity }] }`. `quantity` está en unidades de la presentación vendida; `restock` es obligatorio; CARD/QR exigen `refundReference` y CASH no la admite.

- Permitida para ventas `CONFIRMED` o `PARTIALLY_RETURNED`, en cualquier fecha posterior. `quantity` no puede superar lo vendido menos lo ya devuelto de la línea (`409 RETURN_EXCEEDS_SOLD`).
- Reembolso = cantidad × precio unitario guardado (decimal exacto). `CASH` exige que quien registra tenga un turno `OPEN` asignado en la sucursal: baja su efectivo esperado (`409 CASH_REFUND_EXCEEDS_EXPECTED` si lo superaría) y deja un movimiento de caja `OUT` (categoría `OTHER`, motivo «Devolución D-… (venta V-…)») enlazado a la devolución. CARD/QR no tocan la caja.
- `restock: true`: las unidades vuelven a los lotes originales (primero el de mayor vencimiento, sin superar lo que cada lote aportó) con movimientos `SALE_RETURN`; si algún lote destino está en cuarentena, dado de baja o vencido responde `409 RESTOCK_BATCH_NOT_AVAILABLE` y hay que registrar la devolución con `restock: false`. `restock: false` no cambia el stock y se audita.
- Numeración `D-<códigoSucursal>-000001` con la secuencia documental `SALE_RETURN`. Tablas inmutables `sale_returns`, `sale_return_items`, `sale_return_allocations`. El estado de la venta pasa a `PARTIALLY_RETURNED` o `RETURNED`.
- Respuesta `201`: `{ id, returnNumber, saleId, saleNumber, saleStatus, refundMethod, refundReference, refundAmountBob, restock, reason, lines[], createdAt }`. Auditoría y outbox `sales.sale_returned`.

### Lectura

- `GET /api/v1/sales` acepta `status` = `CONFIRMED | VOIDED | PARTIALLY_RETURNED | RETURNED` y cada fila trae `refundedBob`.
- `GET /api/v1/sales/{saleId}` añade `void` (`{ at, byUserId, byName, reason }` o `null`), `returns[]` (número, motivo, método y monto de reembolso, `restock`, líneas), `items[].id`, `items[].returnedQuantity` y `payments[].reversed`.
- `GET /api/v1/sales/summary` es neto: excluye ventas `VOIDED` y `RETURNED` y resta los reembolsos de las `PARTIALLY_RETURNED` en la fecha de la venta (se mantiene la restricción a ventas propias).

## Proformas (módulo 5 T7)

Decisión provisional D48. Una proforma no reserva stock, no toca caja y no es una venta ni una factura. Todas las rutas requieren `sales.confirm` y aíslan por tenant y sucursal (otra sucursal recibe `404`). Migración `0025_sales_quotes.sql`.

- `POST /api/v1/sales/quotes`: `{ idempotencyKey, lines: [{ presentationId, quantity }], customerName?, customerNote?, validDays? }`. El servidor resuelve el precio vigente de cada línea (no acepta precios del cliente); `409 PRICE_NOT_FOUND` si una línea no tiene precio, `404` si la presentación no está disponible. `customerName` ≤ 120, `customerNote` ≤ 500, `validDays` entero 1–30 (7 por defecto). Número `P-<códigoSucursal>-000001` con la secuencia documental `QUOTE`. Respuesta `201` con el detalle. Auditoría y outbox `sales.quote_created`. Idempotente: la misma clave y carga devuelve la misma proforma; otra carga con la misma clave da `409 IDEMPOTENCY_KEY_REUSED`.
- `GET /api/v1/sales/quotes`: filtros `status` (`OPEN | CONVERTED | CANCELED | EXPIRED`), `from`, `to` (`YYYY-MM-DD`, hora de Bolivia), `limit` (50, máx. 200) y `offset`. Devuelve `{ items[], total, limit, offset }` con `{ id, number, status, createdAt, validUntil, customerName, totalBob, createdByName, convertedSaleId }`.
- `GET /api/v1/sales/quotes/{quoteId}`: detalle con `status`, `validUntil`, `totalBob` (precios de la proforma), `currentTotalBob` (a precios de hoy, `null` si alguna línea ya no tiene precio), `pricesChanged`, `createdBy`, `convertedSaleId`/`convertedSaleNumber`, `branch`, `pharmacy` e `items[]` con `{ presentationId, productName, presentationName, quantity, quotedUnitPriceBob, lineTotalBob, currentUnitPriceBob, currentLineTotalBob, priceChanged }`.
- `POST /api/v1/sales/quotes/{quoteId}/cancel`: `{ idempotencyKey }`; solo desde `OPEN` (si no, `409 QUOTE_NOT_OPEN`). Auditoría y outbox `sales.quote_canceled`.
- Conversión: `POST /api/v1/sales/confirm` acepta `quoteId` opcional. En la misma transacción de la venta la proforma pasa a `CONVERTED` con `converted_sale_id` (auditoría y outbox `sales.quote_converted`). Una proforma convertida, anulada o vencida rechaza toda la venta con `409 QUOTE_NOT_OPEN`; `404` si no existe en la sucursal; `400` si `quoteId` no es un UUID. Las líneas del cobro pueden diferir de la proforma y el precio es siempre el vigente.
- `EXPIRED` no se guarda: una proforma `OPEN` con `validUntil` vencida se muestra y filtra como `EXPIRED`. Las líneas son inmutables y una proforma solo transita `OPEN → CONVERTED | CANCELED` (trigger en base de datos).
- Web: pestaña «Proformas» (`/sales/quotes`, `/sales/quotes/{id}`) con impresión 58 mm, 80 mm o A4 y el texto «Proforma — no es una venta ni una factura · válida hasta <fecha>»; «Convertir en venta» abre `/sales?quoteId=...` y precarga el carrito.

## Proformas, devoluciones y documentos

- Proformas implementadas en el módulo de ventas: ver «Proformas (módulo 5 T7)». Cotizar no crea venta, caja ni stock.
- `POST /api/v1/sales/{id}/returns`: ver «Anulaciones y devoluciones» (módulo 5 T5).
- `GET /api/v1/sales/{id}/documents`: `sales.read` con aislamiento de tenant/sucursal.
- `POST /api/v1/commercial-documents/{id}/reprint`: `documents.reprint`; no muta venta, pago o stock.
- `GET /api/v1/fiscal-documents/{id}/status`: `fiscal.read`; muestra estado real sin inventar aceptación.

Permisos iniciales: `platform.manage`, `tenant.manage`, `users.manage`, `catalog.manage`, `inventory.manage`, `inventory.report.global`, `sales.read`, `sales.confirm`, `sales.void`, `cash.manage`, `cash.shift.approve`, `quotes.manage`, `documents.reprint`, `audit.read`.

## Turnos de caja F6-WEB

Todas las rutas requieren `cash.manage` y usan exclusivamente el tenant y la
sucursal de la sesión.

| Ruta | Contrato |
| --- | --- |
| `GET /api/v1/cash/registers` | Devuelve `{ items }` con las cajas activas de la sucursal, ordenadas por código. |
| `GET /api/v1/cash/eligible-users` | Devuelve únicamente `id` y `displayName` de usuarios activos con membresía en la sucursal. No expone credenciales. |
| `GET /api/v1/cash/shifts` | Lista turnos fechados con caja, intervalo absoluto, estado y personas asignadas. |
| `POST /api/v1/cash/shifts` | Recibe `idempotencyKey`, `cashRegisterId`, `scheduledStartAt`, `scheduledEndAt` y uno o más `userIds`. Crea un turno `SCHEDULED`; la misma clave/cuerpo reproduce el resultado. |

Los intervalos son semiabiertos `[inicio, fin)`: horarios adyacentes están
permitidos y cualquier solapamiento en una misma caja responde
`409 CASH_SHIFT_OVERLAP`. La caja se bloquea dentro de la transacción para
serializar creaciones concurrentes. Este lote no abre ni cierra caja y no
registra importes, ventas o conciliaciones.

## Controles monetarios F7-WEB

Las operaciones conservan el aislamiento tenant/sucursal y usan valores BOB
como cadenas decimales exactas (`numeric(18,4)` en PostgreSQL). El importe
esperado es únicamente el fondo inicial; no se deriva de ventas ni pagos.

| Ruta | Acceso y contrato |
| --- | --- |
| `POST /api/v1/cash/shifts/{id}/open` | Requiere `cash.manage` y asignación activa. Recibe `{ idempotencyKey, openingAmountBob }` y crea un control `OPEN` una sola vez. |
| `POST /api/v1/cash/shifts/{id}/count` | Requiere `cash.manage` y asignación activa. Recibe `{ idempotencyKey, countedAmountBob }`; calcula en SQL `counted - expected`. Cero cierra directamente y cualquier otra diferencia deja `PENDING_APPROVAL`. |
| `POST /api/v1/cash/shifts/{id}/approve` | Requiere `cash.manage` y `cash.shift.approve`. Recibe `{ idempotencyKey, approvalNote? }`; solo un supervisor autorizado cierra un control `PENDING_APPROVAL`. |
| `POST /api/v1/cash/shifts/{id}/movements` | Requiere `cash.manage` y asignación activa; solo en turnos `OPEN`. Recibe `{ idempotencyKey, type: "IN"\|"OUT", amountBob (> 0, hasta 4 decimales), reason (1-200), category? (CHANGE_FUND, EXPENSE, DEPOSIT, OTHER) }`. Ajusta `expectedAmountBob` de forma atómica (IN suma, OUT resta) y responde el movimiento con `expectedAmountBob` resultante. Un OUT mayor al efectivo esperado responde `409 CASH_MOVEMENT_EXCEEDS_EXPECTED` (D49). Turno no abierto o cerrado: `404`/`409`. Genera auditoría `cash.movement_registered` y evento outbox. |
| `GET /api/v1/cash/shifts/{id}/movements` | Requiere `cash.manage` o `cash.shift.approve`. Responde `{ items, summary }` con `openingAmountBob`, `cashSalesBob`, `movementsInBob`, `movementsOutBob` y `expectedAmountBob`. |

`GET /api/v1/cash/shifts` puede incluir `control` con estado, importes exactos,
diferencia y actores/fechas. Las operaciones son idempotentes por clave y
serializan sobre el control; todos los cambios generan auditoría. Reutilizar una
clave con otro cuerpo responde `409 IDEMPOTENCY_KEY_REUSED`.

`control` también expone `cashSalesBob`, `movementsInBob` y `movementsOutBob`:
efectivo esperado = fondo inicial + ventas en efectivo + ingresos − egresos, y el
conteo compara contra ese valor. Los movimientos (`cash_movements`) son
inmutables (sin update/delete).

## Catálogo inicial

| Ruta | Acceso y contrato |
| --- | --- |
| `GET /api/v1/catalog/products` | Requiere `catalog.manage` en la sucursal activa. Acepta `search`, `limit` (1–100) y `offset`; devuelve productos activos, principio activo, categoría y presentaciones tenant-scoped. |
| `POST /api/v1/catalog/categories` | Requiere `catalog.manage`. Crea una categoría en el tenant del contexto. |
| `POST /api/v1/catalog/products` | Requiere `catalog.manage`. Crea un producto; `name` es obligatorio y `activeIngredient` opcional. |
| `POST /api/v1/catalog/products/{productId}/presentations` | Requiere `catalog.manage`. Crea una presentación con `name`, `baseUnitFactor` entero positivo e `isSellable`. |

Las rutas no aceptan `tenantId` o `branchId` de autorización desde el cuerpo: el
contexto proviene del access token y las consultas usan RLS.

## Compras F4-WEB

| Ruta | Acceso y contrato |
| --- | --- |
| `GET /api/v1/procurement/suppliers` | Requiere `inventory.manage`. Devuelve `{ items }` de proveedores activos del tenant, ordenados por nombre e ID. El modelo C02 no asigna proveedores a una sucursal. |
| `GET /api/v1/procurement/presentations` | Requiere `inventory.manage`. Devuelve presentaciones de productos activos del tenant para seleccionar líneas de compra; es una lectura y no modifica catálogo. |
| `GET /api/v1/procurement/purchase-orders` | Requiere `inventory.manage`. Devuelve órdenes de almacenes de la sucursal activa, proveedor/almacén, estado, fecha y líneas con producto, presentación, cantidad base y costo unitario. |
| `POST /api/v1/procurement/suppliers` | Requiere `inventory.manage`. Recibe `name` y `taxId` opcional; crea un proveedor activo y devuelve `{ id }`. |
| `POST /api/v1/procurement/purchase-orders` | Requiere `inventory.manage`. Recibe `supplierId`, `warehouseId` y `lines` con presentación, cantidad base entera positiva y costo decimal; crea una orden `SUBMITTED` y devuelve `{ id }`. |
| `POST /api/v1/procurement/receipts` | Requiere `inventory.manage`. Recibe una clave idempotente, orden/proveedor/almacén, fecha de recepción y líneas con presentación, lote, vencimiento, cantidad base y costo. Devuelve `{ receiptId, lineCount }`; una repetición idéntica no duplica inventario. |

F5-WEB permite recepciones parciales: la orden queda `PARTIALLY_RECEIVED` hasta
que todas sus presentaciones completan la cantidad pedida y entonces pasa a
`RECEIVED`. La operación bloquea la orden durante el cálculo acumulado para
evitar sobre-recepción concurrente. Las facturas de proveedor siguen fuera de
este flujo Web.

## Inventario operativo C04/C05

| Ruta | Acceso y contrato |
| --- | --- |
| `GET /api/v1/inventory/warehouses` | Requiere `inventory.manage`. Devuelve `{ items }` con los almacenes visibles de la sucursal activa, ordenados por nombre e identificador; cada elemento incluye `id`, `name` e `isDispatchEnabled`. |
| `POST /api/v1/inventory/reservations/fefo` | Requiere `inventory.manage`. Recibe `idempotencyKey`, `warehouseId`, `presentationId`, `quantityRequested` y `expiresAt`; reserva unidades base completas por vencimiento FEFO. |
| `POST /api/v1/inventory/reservations/{reservationId}/release` | Requiere `inventory.manage`. Recibe una clave de idempotencia y libera la reserva activa; no modifica stock físico. |
| `POST /api/v1/inventory/reservations/{reservationId}/consume` | Requiere `inventory.manage`. Recibe clave, `referenceType` y `referenceId`; consume la reserva, decrementa stock y registra movimiento `OUT`. |
| `POST /api/v1/inventory/reservations/expire` | Requiere `inventory.manage`. Libera todas las reservas activas vencidas visibles en la sucursal y devuelve sus IDs. |
| `GET /api/v1/inventory/expiry-alerts?warehouseId={id}&horizonDays={n}` | Requiere `inventory.manage`. Consulta lotes con existencia física que vencen dentro de 0–365 días; devuelve `EXPIRED`/`DUE_SOON`, `batchStatus`, cantidades física/reservada/disponible y no muta stock. |
| `POST /api/v1/inventory/batches/{batchId}/quarantine` | Requiere `inventory.manage`. Recibe `warehouseId`, `idempotencyKey`, `reasonCode`, `reason` y temperatura opcional/obligatoria para `COLD_CHAIN`; rechaza reservas activas. |
| `POST /api/v1/inventory/batches/{batchId}/release-quarantine` | Requiere `inventory.manage`. Recibe `warehouseId`, `idempotencyKey` y `reason`; solo libera lotes no vencidos. |
| `POST /api/v1/inventory/waste` | Requiere `inventory.manage`. Recibe almacén, lote, `quantityBase`, motivo y clave; registra `WASTE`/`OUT` sobre stock libre. |
| `POST /api/v1/inventory/reconciliations` | Requiere `inventory.manage`. Expone el conteo físico idempotente de C03 con motivo y límite de reservas. |

### Reporte global F9-WEB

`GET /api/v1/inventory/reports/tenant-stock` requiere `inventory.report.global`
y es estrictamente de lectura. Acepta `search`, `limit` (1–100, por defecto 50) y
`offset`; ordena de forma estable por sucursal, almacén, producto y presentación.
Devuelve `{ items, branchSubtotals, tenantTotal, total, limit, offset }`. Cada fila
incluye esa jerarquía y `physical`, `reserved` y `available` como cadenas exactas
de unidades base; `available = physical - reserved`. Los totales se calculan sobre
el conjunto filtrado completo, aunque `items` esté paginado. Solo se incluyen filas
con existencia física positiva y nunca se concede acceso de escritura.

FEFO ignora lotes vencidos, en cuarentena o no disponibles y ordena por
`expires_on ASC, batch_id ASC`. La asignación no devuelve costos y no decide la
política comercial de proformas (D09) ni la valoración de inventario (D08). Las
operaciones C05 registran eventos operativos y auditoría transaccional; no
integran sensores ni notificaciones externas.


## Operación de catálogo F8

Todas las rutas de esta sección requieren `catalog.manage`, identidad autenticada y
el alcance tenant/sucursal del access token. Las mutaciones requieren
`Idempotency-Key` o `idempotencyKey`; una repetición idéntica devuelve el resultado
original y una clave con otro cuerpo responde `409 IDEMPOTENCY_KEY_REUSED`.

| Ruta | Contrato |
| --- | --- |
| `GET /api/v1/catalog/price-lists` | Devuelve `{ items }` de listas activas globales y de la sucursal activa; cada lista incluye `id`, `name`, `currency` y `branchId`. |
| `POST /api/v1/catalog/price-lists` | Recibe `name`, `currency` ISO y `branchId` opcional. Una lista de sucursal solo puede referir la sucursal activa; omitirlo crea una lista global. |
| `POST /api/v1/catalog/prices` | Recibe `priceListId`, `presentationId`, `amount` decimal como cadena, `validFrom` y `validTo` ISO opcional. `amount` acepta hasta cuatro decimales y se conserva como `numeric(18,4)`. |
| `POST /api/v1/catalog/barcodes` | Recibe `presentationId` y `barcode`; el código es único por tenant. |
| `GET /api/v1/catalog/barcodes/{barcode}` | Devuelve producto, presentación y precio vigente o `null`. Prioriza la lista de la sucursal activa sobre la global. |

Las vigencias son intervalos semiabiertos `[validFrom, validTo)`: intervalos
adyacentes son válidos y dos intervalos del mismo producto/presentación y alcance
(global o la misma sucursal) responden `409 CATALOG_PRICE_OVERLAP`. Cada mutación
operativa registra auditoría transaccional. Ninguna ruta de F8 crea ventas,
movimientos, FEFO, valoración ni reportes globales de inventario.

## Core SaaS (planes, alta, cobro y plataforma)

Migración `0015_core_saas.sql`. El rol `farmaxia_platform` (`DATABASE_PLATFORM_URL`)
solo lo usan el alta pública y las rutas `/api/v1/platform`; las rutas de una
farmacia siguen bajo `farmaxia_app` y su RLS.

### Control de plan en las rutas de la farmacia

Un guard global corre después de identidad y permisos. Las rutas marcadas con
`@RequireFeature(código)` responden:

| Situación | Respuesta |
| --- | --- |
| Suscripción suspendida, cancelada, prueba vencida o gracia vencida | `402` `{ code: "SUBSCRIPTION_INACTIVE" }` |
| El plan (o un extra) no incluye la funcionalidad | `403` `{ code: "PLAN_FEATURE_RESTRICTED", feature }` |

Catálogo → `catalog`, Inventario → `inventory` (reporte global → `reports.basic`),
Compras → `procurement`, Caja y Ventas → `pos`, Auditoría → `audit`. Las rutas de
suscripción y cobro no se marcan: una farmacia suspendida siempre puede ver su
estado y pagar.

### Alta pública

| Ruta | Contrato |
| --- | --- |
| `GET /api/v1/onboarding/plans` | Pública. Planes visibles con precio, límites (`null` = ilimitado) y funcionalidades. |
| `POST /api/v1/onboarding/register` | Pública, 5 por IP por hora. Recibe `pharmacyName`, `legalName`, `taxId` (solo dígitos), `branchName?`, `ownerName`, `email`, `password` (≥10, letras y números) y `planCode`. Crea farmacia, razón social, sucursal `SUC-001`, almacén, caja `CAJA-01`, dueño con rol `owner`, prueba de 7 días y el primer comprobante. Responde `201` con `tenantId`, `branchId`, `trialEndsAt` y sesión (`accessToken` + cookie de refresh). Correo repetido → `409 EMAIL_TAKEN`. |

### Farmacia

| Ruta | Acceso y contrato |
| --- | --- |
| `GET /api/v1/subscription` | Cualquier sesión. Plan, estado, `hasAccess`, fechas, uso contra límites, funcionalidades (con `addOn`) y comprobantes abiertos. |
| `GET /api/v1/billing/invoices` | `billing.manage`. Comprobantes con sus pagos declarados. |
| `GET /api/v1/billing/invoices/:id` | `billing.manage`. Comprobante con datos del cliente para imprimir. |
| `POST /api/v1/billing/invoices/:id/payments` | `billing.manage`. `method` (`QR` \| `TRANSFER`), `reference`, `amountBob` (hasta 2 decimales), `paidOn` (no futura) y `attachment?` `{ mediaType, base64 }` (PNG/JPG/WEBP/PDF, máx. 2 MB). Queda `PENDING`; uno solo en revisión por comprobante (`409 PAYMENT_ALREADY_PENDING`). |
| `GET /api/v1/audit/events` | `audit.read` + funcionalidad `audit`. Filtros `action`, `from`, `to`, `limit` (≤100), `offset`. Solo devuelve eventos dentro de la retención del plan (7 días, 30 días o todo); la bitácora nunca se borra. |

### Ciclo de cobro

Corre cada `BILLING_CYCLE_INTERVAL_MINUTES` (60; `0` lo desactiva) con advisory lock,
y también a pedido desde el panel. Es idempotente:

1. Emite el comprobante del siguiente periodo mensual 7 días antes de que empiece.
2. Prueba vencida sin pago → `SUSPENDED`.
3. Periodo pagado vencido → `PAST_DUE` con 3 días de gracia; gracia vencida → `SUSPENDED`.
4. Los planes sin costo no se cobran.

Aprobar un pago marca el comprobante `PAID`, extiende `current_period_end` y activa la
suscripción; si estaba suspendida, el nuevo periodo empieza el día de la aprobación.

### Plataforma (`/api/v1/platform`)

Token de operador con audiencia `farmaxia-platform` (8 h), distinto al de farmacia:
ninguno sirve en las rutas del otro.

| Ruta | Contrato |
| --- | --- |
| `POST auth/login`, `GET auth/me` | Correo y contraseña de `platform_operators`. |
| `GET overview` | Suscripciones por estado, ingreso mensual recurrente, pagos por revisar, comprobantes abiertos y últimas altas. |
| `GET tenants?search&status`, `GET tenants/:id` | Listado y detalle (uso, extras, comprobantes, historial). |
| `POST tenants/:id/plan` | `{ planCode }`. Rechaza bajar a un plan cuyos límites ya se superan (`409 PLAN_QUOTA_EXCEEDED`); anula el comprobante abierto y emite uno con el nuevo precio. |
| `POST tenants/:id/status` | `{ action: SUSPEND \| REACTIVATE \| CANCEL }` respetando la máquina de estados. |
| `POST tenants/:id/features` | `{ featureCode, enabled: true \| false \| null }`: extra por farmacia (`null` lo quita). |
| `GET payments?status`, `GET payments/:id/attachment` | Cola de pagos y comprobante adjunto. |
| `POST payments/:id/approve`, `POST payments/:id/reject` | `{ note }` (obligatoria al rechazar). No aprueba montos menores al comprobante. |
| `GET plans`, `PATCH plans/:code`, `GET features` | Planes y precio/visibilidad editables. |
| `POST billing/run-cycle` | Ejecuta el ciclo de cobro. |

Toda acción de operador queda en `platform_audit_events` (inmutable).

## Usuarios, roles y seguridad (módulo 1)

Migración `0016_identity_management.sql`. El rol `farmaxia_identity`
(`DATABASE_IDENTITY_URL`) administra usuarios, roles y accesos de una sola farmacia
(`app.tenant_id`); `farmaxia_app` sigue sin poder escribir usuarios, roles ni membresías.

### Inicio de sesión

`POST /api/v1/auth/login` recibe `email`, `password` y, opcionalmente, `tenant`
(identificador o UUID), `tenantId` y `branchId`. Primero valida la contraseña; recién
entonces resuelve farmacia y sucursal entre las membresías del usuario:

| Resultado | Respuesta |
| --- | --- |
| Una sola sucursal posible | `201` `{ accessToken, expiresInSeconds }` y cookie de refresh (igual que antes) |
| Varias sucursales o farmacias | `200` `{ requires: "BRANCH", options: [{ tenantId, tenantSlug, tenantName, branchId, branchCode, branchName }] }` |
| 2FA activo | `200` `{ requires: "TOTP", challengeToken }` (5 min, audiencia `farmaxia-2fa`, no sirve como sesión) |
| Datos incorrectos | `401` sin revelar la causa |
| Más de 10 intentos por IP y correo en 15 min | `429 TOO_MANY_LOGIN_ATTEMPTS` |

`POST /api/v1/auth/login/totp` `{ challengeToken, code }` completa el paso 2FA. Un
código aceptado no se puede reutilizar.

### Mi cuenta (cualquier sesión)

| Ruta | Contrato |
| --- | --- |
| `GET auth/account` | Nombre, correo, farmacia (nombre e identificador), sucursal, 2FA y sucursales disponibles. `GET auth/me` no cambia. |
| `POST auth/switch-branch` | `{ branchId }` de la misma farmacia: nueva sesión y cierra la actual. |
| `POST auth/password` | `{ currentPassword, newPassword }` (≥10, letras y números). Cierra las demás sesiones. |
| `POST auth/2fa/setup`, `auth/2fa/enable`, `auth/2fa/disable` | TOTP (RFC 6238, 6 dígitos, 30 s). El secreto se guarda cifrado con AES-256-GCM (`AUTH_ENCRYPTION_KEY` o, si falta, `AUTH_JWT_SECRET`). Desactivar exige la contraseña. |
| `GET auth/sessions`, `POST auth/sessions/:id/revoke`, `POST auth/sessions/revoke-others` | Sesiones activas con dispositivo, IP, farmacia y sucursal. Una sesión cerrada deja de renovarse; su access token vence en ≤15 min. |

Un usuario desactivado o sin acceso a la sucursal recibe permisos vacíos al instante,
aunque su access token siga vigente.

### Administración (`users.manage`)

| Ruta | Contrato |
| --- | --- |
| `GET users`, `POST users`, `PATCH users/:id` | Alta con rol(es) y sucursal(es); consume la cuota `users` del plan (`409 PLAN_QUOTA_EXCEEDED`). Desactivar libera el lugar y cierra sus sesiones en la farmacia. |
| `POST users/:id/password`, `POST users/:id/2fa/reset` | Solo para cuentas de esta farmacia (`home_tenant_id`). |
| `GET roles`, `POST roles`, `PATCH roles/:id`, `DELETE roles/:id` | Roles personalizados. Los predefinidos (`is_system`) no se modifican (`409 SYSTEM_ROLE`); un rol con usuarios no se elimina (`409 ROLE_IN_USE`). |
| `GET permissions`, `GET branches` | Catálogo de permisos con nombre y módulo; sucursales de la farmacia. |

Reglas: nadie otorga permisos que no tiene ni administra a alguien con más permisos
(`403 INSUFFICIENT_PRIVILEGES`); siempre queda un Propietario activo (`409 LAST_OWNER`);
nadie se desactiva ni cambia sus propios roles; nombre, estado y contraseña de una cuenta
solo se cambian en su farmacia dueña (`403 USER_MANAGED_ELSEWHERE`).

Roles predefinidos por farmacia: Propietario (todos los permisos), Regente farmacéutico,
Encargado de sucursal, Cajero y Almacenero (ver `apps/api/src/identity/role-templates.ts`).

## Catálogo farmacéutico: ficha, categorías y presentaciones (módulo 2)

Migración `0017_catalog_sanitary_profile.sql`. Las rutas siguen bajo
`/api/v1/catalog`, con la funcionalidad de plan `catalog` y el permiso `catalog.manage`
(la lectura también la permite `sales.confirm`). Toda alta o cambio queda en la bitácora.

| Ruta | Contrato |
| --- | --- |
| `GET products` | Filtros `search` (nombre, genérico, principio activo, laboratorio o código de barras exacto), `categoryId`, `controlled`, `coldChain`, `includeInactive`. Cada producto trae su ficha resumida, si es controlado (por el producto o su categoría) y sus presentaciones activas. |
| `GET products/:id` | Ficha completa, categoría, presentaciones (también las desactivadas) con códigos de barras y precio vigente de la sucursal. |
| `POST products`, `PATCH products/:id` | Ficha: `name`, `genericName`, `activeIngredient`, `concentration`, `pharmaceuticalForm`, `laboratory`, `categoryId`, `sanitaryRegistration`, `saleClassification` (`OTC` \| `PRESCRIPTION` \| `RETAINED_PRESCRIPTION` \| `CONTROLLED`), `isControlled`, `requiresColdChain` (+ `coldChainMinCelsius`/`coldChainMaxCelsius`, 2–8 °C por defecto), `sinActivityCode`, `sinProductCode`, `sinUnitCode` (solo dígitos). `PATCH` acepta `isActive` para desactivar o reactivar; la bitácora guarda qué campos cambiaron (antes y después). |
| `GET categories`, `POST categories`, `PATCH categories/:id` | Nombre único por farmacia (`409`). Marcar una categoría como controlada marca a sus productos; una desactivada no se asigna a productos nuevos. |
| `POST products/:id/presentations`, `PATCH presentations/:id` | Nombre único por producto; se editan `name`, `isSellable`, `isActive`. El factor no se modifica (`409 FACTOR_IMMUTABLE`). |
| `GET options` | Clasificaciones de venta, sugerencias de forma farmacéutica y rango de frío por defecto. |

Reglas: la venta `CONTROLLED` implica `isControlled`; un producto o presentación
desactivado no se vende, no se reserva, no aparece para compras ni en la lectura de
códigos de barras, pero conserva su historial.

## Inventario: almacenes, inventario físico, actas de baja y alertas (módulo 3)

Migración `0018_inventory_operations.sql`. Rutas bajo `/api/v1/inventory`, con la
funcionalidad de plan `inventory` y el permiso `inventory.manage`; todo cambio queda en
la bitácora. Los datos son siempre de la sucursal activa.

| Ruta | Contrato |
| --- | --- |
| `GET warehouses` | (Existente) Almacenes **activos** de la sucursal; ahora incluye `warehouseType`. Lo usan inventario y ventas. |
| `GET warehouses/details?includeInactive=true` | Almacenes con `warehouseType` (`GENERAL` \| `CENTRAL` \| `QUARANTINE` \| `COLD`), `isDispatchEnabled`, `isActive`, lotes con stock, unidades y reservadas. |
| `POST warehouses`, `PATCH warehouses/:id` | `name` (único por sucursal, `409`), `warehouseType`, `isDispatchEnabled`, `isActive` (solo en `PATCH`). Cuarentena nunca despacha (`400` si se pide). No se desactiva con stock, reservas o un conteo en curso (`409`). Un almacén inactivo no aparece en ventas ni en la reserva FEFO. |
| `GET counts?status=` · `GET counts/:id` | Conteos físicos (`OPEN` \| `SUBMITTED` \| `APPROVED` \| `CANCELED`), número `INV-<sucursal>-000001`. Mientras está `OPEN` el stock esperado va en `null` (conteo ciego). |
| `POST counts` | `{ warehouseId, notes? }`. Toma todos los lotes con stock del almacén. Un solo conteo `OPEN`/`SUBMITTED` por almacén (`409`). |
| `PUT counts/:id/lines` | `{ lines: [{ batchId, countedQuantity \| null }] }`, solo en `OPEN`. |
| `POST counts/:id/submit` | Exige todas las líneas contadas (`409 Faltan N lotes`); fija el stock esperado y muestra diferencias. |
| `POST counts/:id/approve` | Permiso adicional `inventory.count.approve`. Ajusta cada lote a lo contado contra el stock actual (conciliación con `count_id`, movimiento `ADJUSTMENT`). Si un lote quedaría por debajo de sus reservas, no ajusta nada (`409`). |
| `POST counts/:id/cancel` | Anula un conteo `OPEN` o `SUBMITTED` sin mover stock. |
| `POST waste` | (Existente) acepta `disposalMethod` (`DESTRUCTION` \| `SUPPLIER_RETURN` \| `OTHER`) y devuelve `actNumber` (`AB-<sucursal>-000001`, correlativo por sucursal; un reintento idempotente no consume número). |
| `GET waste-acts` · `GET waste-acts/:id` | Actas de baja; el detalle trae razón social, NIT, sucursal, lote, cantidad, costo unitario y total para imprimir. |
| `GET reservations?status=` | Reservas FEFO de la sucursal con producto, lote y vencimiento. Se liberan con la ruta existente `POST reservations/:id/release`. |
| `GET alerts?includeAcknowledged=` · `POST alerts/:id/acknowledge` | Alertas automáticas `EXPIRING` / `EXPIRED` con la cantidad actual del lote. Marcar como revisada no la borra. |

Alertas programadas: la API revisa los vencimientos al arrancar y cada
`INVENTORY_ALERT_INTERVAL_MINUTES` (60 por defecto; `0` lo apaga) con el rol de
plataforma. Crea una alerta por lote y almacén con stock que vence dentro de
`INVENTORY_ALERT_HORIZON_DAYS` (30) o ya venció, sin duplicarlas, y la cierra cuando el
lote se queda sin stock o pasa de "por vencer" a "vencido".

CORS: la API ahora acepta `PUT`, `PATCH` y `DELETE` desde la web (antes Fastify solo
permitía `GET`, `HEAD` y `POST` y el navegador bloqueaba las ediciones).

## Compras: órdenes, pagos, costos y reposición (módulo 4)

Migración `0019_procurement_payments.sql`. Rutas bajo `/api/v1/procurement`, funcionalidad de plan
`procurement` y permiso `inventory.manage`; registrar pagos y programarlos exige además el permiso
nuevo `payables.manage` («Registrar pagos a proveedores», Propietario y Encargado).

| Ruta | Contrato |
| --- | --- |
| `POST purchase-orders` | (Existente) acepta varias líneas; la web ya las envía. |
| `GET purchase-orders` | Cada línea incluye `receivedBase`; la orden incluye `closeReason` y `closedAt`. |
| `POST purchase-orders/:id/cancel` | `{ reason }` (3–255). `SUBMITTED` → `CANCELED`; `PARTIALLY_RECEIVED` → `CLOSED` (cierra el saldo; lo recibido se mantiene). Otra situación → `409`. Una orden cancelada o cerrada ya no se recibe. Auditoría `procurement.purchase_order_canceled` / `_closed`. |
| `GET costs` | Costo promedio ponderado vigente por presentación (`averageUnitCost`, `lastUnitCost`). Se recalcula en cada recepción (D40). |
| `GET reorder-suggestions?coverageDays=30` | Por presentación vendida en la sucursal: vendido en 30 días, promedio diario, stock libre en almacenes de despacho, pendiente en órdenes abiertas, días que alcanza, cantidad sugerida, costo promedio, costo estimado y último proveedor. `coverageDays` 7–120. |
| `GET payables` | Cuentas por pagar con saldo, pagado, estado (`OPEN`, `PARTIAL`, `OVERDUE`, `PAID`), tramo de la agenda (`overdue`, `thisWeek`, `next30`, `later`, `paid`) según la fecha programada o el vencimiento, y totales pendientes por tramo y moneda. |
| `GET payables/:id/payments` | Historial de pagos de la cuenta. |
| `POST payables/:id/payments` | `{ idempotencyKey, amount, paidOn, method: CASH\|TRANSFER\|CHECK\|QR\|OTHER, reference?, notes? }`. Nunca más que el saldo (`409`); un reintento con la misma clave devuelve el mismo pago. Actualiza saldo y estado; auditoría `procurement.supplier_payment_registered`. |
| `PATCH payables/:id/schedule` | `{ scheduledOn: "AAAA-MM-DD" \| null }` fija o quita la fecha planificada; no aplica a cuentas pagadas. |
