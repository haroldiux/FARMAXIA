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

F11 confirma una venta **no fiscal y solo en efectivo**. Requiere el permiso `sales.confirm`; el backend deriva `tenantId`, `branchId` y `userId` de la sesión autenticada. No acepta `branchId`, `cashRegisterId` ni otro dato del cliente como autorización.

El cliente Web envía el encabezado `Idempotency-Key` y repite ese valor en `idempotencyKey` del cuerpo. La implementación del endpoint toma la clave del cuerpo; el encabezado por sí solo no sustituye `idempotencyKey`. Reutilizar la misma clave con el mismo cuerpo normalizado reproduce el resultado original; reutilizarla con un cuerpo distinto genera un conflicto de idempotencia.

```json
{
  "idempotencyKey": "uuid",
  "cashShiftId": "uuid",
  "warehouseId": "uuid",
  "paymentMethod": "CASH",
  "paidAmountBob": "25.0000",
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
| `paymentMethod` | Solo admite `CASH`. |
| `paidAmountBob`, `unitPriceBob` | Son cadenas decimales no negativas, con hasta cuatro decimales. Se conservan como cadenas decimales exactas, sin conversión a punto flotante. |
| `lines` | Debe contener entre 1 y 100 líneas; cada `presentationId` debe ser vendible y cada `quantity` un entero positivo seguro. |

La confirmación asigna y consume stock disponible por FEFO (vencimiento ascendente y, ante empate, identificador de lote), sin usar lotes vencidos. El importe pagado debe coincidir exactamente con el total calculado. Venta, ítems, pago en efectivo, consumo/movimientos de inventario, actualización del control de caja, auditoría y evento outbox se ejecutan de forma transaccional.

La respuesta es un `ConfirmedSale`:

```json
{
  "id": "uuid",
  "cashShiftId": "uuid",
  "warehouseId": "uuid",
  "status": "CONFIRMED",
  "paymentMethod": "CASH",
  "totalBob": "25.0000",
  "paidAmountBob": "25.0000",
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
| Datos inválidos | Error de validación para campos requeridos, decimales, cantidades, líneas o un método de pago distinto de `CASH`. |
| Sin `sales.confirm` | Acceso prohibido. |
| Turno ausente, no abierto o no asignado | Conflicto: se requiere un turno abierto asignado al usuario autenticado. |
| Almacén o presentación no disponible | La operación se rechaza cuando el almacén no permite despacho o la presentación no es vendible en el tenant. |
| Inventario insuficiente | Conflicto sin confirmar una venta parcial. |
| Reutilización de `idempotencyKey` | El mismo cuerpo normalizado reproduce la venta; un cuerpo diferente provoca conflicto. |

**Fuera del alcance de F11:** documentos fiscales, pagos con tarjeta o QR, devoluciones, cotizaciones, impuestos, promociones, conversiones de moneda, conciliación de pasarelas y liquidación contable.

## Proformas, devoluciones y documentos

- `POST /api/v1/quotes` y `POST /api/v1/quotes/{id}/convert`: permiso `quotes.manage` / `sales.confirm`; cotizar no crea venta, caja ni stock.
- `POST /api/v1/sales/{id}/returns`: permiso `sales.return`; espera políticas D14/D18 y compensa una vez.
- `GET /api/v1/sales/{id}/documents`: `sales.read` con aislamiento de tenant/sucursal.
- `POST /api/v1/commercial-documents/{id}/reprint`: `documents.reprint`; no muta venta, pago o stock.
- `GET /api/v1/fiscal-documents/{id}/status`: `fiscal.read`; muestra estado real sin inventar aceptación.

Permisos iniciales: `platform.manage`, `tenant.manage`, `users.manage`, `catalog.manage`, `inventory.manage`, `inventory.report.global`, `sales.read`, `sales.confirm`, `cash.manage`, `cash.shift.approve`, `quotes.manage`, `documents.reprint`, `audit.read`.

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

`GET /api/v1/cash/shifts` puede incluir `control` con estado, importes exactos,
diferencia y actores/fechas. Las operaciones son idempotentes por clave y
serializan sobre el control; todos los cambios generan auditoría. Reutilizar una
clave con otro cuerpo responde `409 IDEMPOTENCY_KEY_REUSED`.

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
