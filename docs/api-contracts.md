# Contratos de API y autorización

Las rutas de dominio se publicarán bajo `/api/v1`. UUID de tenant, sucursal y caja enviados por el cliente son referencias solicitadas, nunca autorización: el backend los contrasta con identidad y membresías de la sesión.

| Elemento | Regla |
| --- | --- |
| Identidad | Sesión autenticada aporta `userId`; backend deriva tenants, roles y sucursales permitidas. |
| Tenant | Una mutación trabaja en un único tenant y establece contexto RLS transaccional. |
| Idempotencia | `Idempotency-Key` es obligatoria en confirmaciones. Misma clave y cuerpo igual devuelve resultado original; cuerpo distinto devuelve `409 IDEMPOTENCY_KEY_REUSED`. |
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

## `POST /api/v1/sales/confirmations`

**Permiso:** `sales.confirm` en sucursal, almacén y caja, con turno abierto.

```json
{
  "branchId": "uuid",
  "warehouseId": "uuid",
  "cashRegisterId": "uuid",
  "documentMode": "FISCAL_INVOICE",
  "lines": [{ "presentationId": "uuid", "quantity": 2 }],
  "payments": [{ "method": "CASH", "amount": "25.00" }]
}
```

`documentMode` admite exclusivamente `FISCAL_INVOICE` y `NON_FISCAL_RECEIPT`. Ambas confirman una venta y movimiento físico una sola vez. Fiscal valida configuración y crea evento outbox; recibo solo crea documento comercial. La respuesta identifica venta, asignaciones por lote, pagos y documento; una venta fiscal nunca cambia automáticamente a recibo.

Errores previstos: `400 VALIDATION_FAILED`, `403 FORBIDDEN`, `409 INSUFFICIENT_STOCK`, `409 CASH_SHIFT_REQUIRED`, `409 IDEMPOTENCY_KEY_REUSED`, `422 FISCAL_CONFIGURATION_REQUIRED`.

## Proformas, devoluciones y documentos

- `POST /api/v1/quotes` y `POST /api/v1/quotes/{id}/convert`: permiso `quotes.manage` / `sales.confirm`; cotizar no crea venta, caja ni stock.
- `POST /api/v1/sales/{id}/returns`: permiso `sales.return`; espera políticas D14/D18 y compensa una vez.
- `GET /api/v1/sales/{id}/documents`: `sales.read` con aislamiento de tenant/sucursal.
- `POST /api/v1/commercial-documents/{id}/reprint`: `documents.reprint`; no muta venta, pago o stock.
- `GET /api/v1/fiscal-documents/{id}/status`: `fiscal.read`; muestra estado real sin inventar aceptación.

Permisos iniciales: `platform.manage`, `tenant.manage`, `users.manage`, `catalog.manage`, `inventory.manage`, `sales.read`, `sales.confirm`, `cash.manage`, `quotes.manage`, `documents.reprint`, `audit.read`.

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

FEFO ignora lotes vencidos, en cuarentena o no disponibles y ordena por
`expires_on ASC, batch_id ASC`. La asignación no devuelve costos y no decide la
política comercial de proformas (D09) ni la valoración de inventario (D08). Las
operaciones C05 registran eventos operativos y auditoría transaccional; no
integran sensores ni notificaciones externas.
