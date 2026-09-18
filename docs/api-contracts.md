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
