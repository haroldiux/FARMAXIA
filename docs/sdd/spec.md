# Especificación — fundación técnica F1

## S01 — API observable

La API expone `GET /health` sin autenticación y responde HTTP 200 con:

```json
{ "status": "ok", "service": "farmaxia-api" }
```

No expone secretos, versión interna ni información de infraestructura.

## S02 — Aplicación web

La web es Next.js con App Router y TypeScript estricto. Su inicio identifica FARMAXIA como plataforma en preparación y no usa un tenant enviado por navegador como autorización.

## S03 — Configuración segura

Cada aplicación carga variables declaradas. Los ejemplos nunca contienen secretos
productivos utilizables y los entornos locales están ignorados por Git.

## S04 — Desarrollo reproducible

Docker Compose inicia PostgreSQL y Redis locales con volúmenes. No se conecta a servicios externos.

## S05 — Calidad mínima

La prueba del health check se escribe antes de su implementación. Las pruebas y los builds de API y web deben completarse sin errores.

## S06 — estructura organizativa

Una razón social pertenece a un tenant; una sucursal pertenece a una razón social
del mismo tenant; almacenes y cajas pertenecen a una sucursal del mismo tenant. Un
usuario puede tener membresías en varias sucursales de un tenant. Las relaciones
que mezclen tenants deben rechazarse incluso si se conoce un UUID ajeno.

## S07 — aislamiento aplicable

Las tablas de negocio de B02 activan y fuerzan RLS. El rol de aplicación ve y
modifica exclusivamente filas cuyo `tenant_id` coincide con el contexto local de
la transacción. Sin contexto no ve filas. El propietario de migraciones no es el
rol usado en pruebas de aislamiento ni por la aplicación.

## S08 — migraciones reproducibles

La estructura se expresa en schema TypeScript y una migración SQL versionada de
Drizzle. Aplicar la misma migración más de una vez no duplica objetos ni datos.

## S09 — inicio de sesión

`POST /api/v1/auth/login` acepta email, contraseña, tenant y sucursal solicitados.
Emite un access token solo si la contraseña Argon2id es válida, el usuario está
activo y existe una membresía exacta para tenant/sucursal. Una selección ajena no
revela cuál dato falló ni crea una sesión.

## S10 — sesión y refresh

El access token JWT se firma para `farmaxia-api`, tiene audiencia
`farmaxia-web` y dura 15 minutos. El refresh es aleatorio, opaco, HttpOnly,
SameSite=Strict y se persiste como hash. `POST /api/v1/auth/refresh` revoca el
token presentado y entrega otro; logout revoca la sesión actual.

## S11 — identidad y autorización

Las rutas son autenticadas por defecto, salvo las marcadas públicas. Un access
token válido provee `userId`, `tenantId` y `branchId`; no se reemplazan por
cabeceras o cuerpos de petición. `@RequirePermissions` exige el permiso activo
para ese usuario y tenant antes de ejecutar una ruta.

## S12 — privilegio mínimo de identidad

El rol de base de datos de autenticación no puede enumerar usuarios ni sesiones.
Solo puede leer la identidad cuyo email de login estableció la API en la
transacción actual o la sesión cuyo hash de refresh presentó el cliente. Crear una
sesión exige el mismo `userId` y `tenantId` del contexto de servidor.

## S13 — contexto de sucursal aplicable

Las operaciones tenant-scoped del rol de aplicación deben establecer dentro de la
misma transacción `app.tenant_id`, `app.user_id` y `app.branch_id`. Los recursos
operativos de sucursal solo se leen o escriben cuando su tenant y sucursal
coinciden con dicho contexto; sin alguno de esos settings no devuelven filas. El
contexto proviene de identidad autenticada, nunca de una cabecera libre.
El rol de aplicación solo puede leer su propia membresía activa; no puede crear,
modificar ni eliminar membresías para otorgarse acceso.

## S14 — trabajos y archivos aislados

Un trabajo interno durable y el metadato de un archivo pertenecen a tenant y
sucursal, y sus referencias cruzadas deben conservar ese tenant. El rol de
aplicación no puede leer, insertar ni relacionar un trabajo o archivo de otra
sucursal. La clave de almacenamiento de un archivo debe incorporar el tenant y la
sucursal de su fila.

## S15 — namespace de caché y exportaciones

Toda clave de caché se construye mediante una función que exige tenant, sucursal,
namespace y clave local no vacíos; el resultado lleva ambos IDs como prefijo. Una
exportación futura será un `background_job` de tipo `EXPORT` y, si produce un
archivo, lo referirá dentro del mismo tenant y sucursal. B04 no expone todavía una
ruta para solicitar exportaciones.

## S16 — plan y entitlements evolutivos

Existe un plan inicial `COMPLETO`, activo y con todas las funcionalidades
permitidas. El modelo distingue la habilitación global de funciones de los
entitlements explícitos por plan; un plan futuro puede limitar una función sin
duplicar vistas ni flujos de negocio.

## S17 — ciclo de vida de suscripción

Una suscripción nueva puede empezar como `TRIALING` durante exactamente 7 días o
directamente como `ACTIVE`. `PAST_DUE` conserva acceso hasta 3 días después del
vencimiento; después pasa a `SUSPENDED`. Solo una suscripción no cancelada puede
existir por tenant. `CANCELED` conserva datos pero no permite operación. Las
transiciones permitidas son: `TRIALING → ACTIVE|SUSPENDED|CANCELED`,
`ACTIVE → PAST_DUE|CANCELED`, `PAST_DUE → ACTIVE|SUSPENDED|CANCELED` y
`SUSPENDED → ACTIVE|CANCELED`.

## S18 — cuotas atómicas

Las cuotas se miden por `branches`, `users`, `cash_registers` y `storage_bytes`.
Trial aplica respectivamente 1, 5, 1 y 1 GiB; `COMPLETO` tiene límite `NULL`
(ilimitado). El consumo finito se incrementa en una actualización condicional
atómica: nunca puede superar el límite por concurrencia. Las cuotas de prueba se
guardan como overrides de la suscripción, no como reglas ocultas en código.

## S19 — auditoría de solo anexado

Una mutación de dominio puede registrar un evento de auditoría con tenant,
sucursal, usuario actor, acción, tipo e identificador de entidad, payload y fecha.
El rol de aplicación únicamente inserta o consulta los eventos dentro de su
contexto RLS; no puede actualizarlos ni eliminarlos y la base rechaza toda
mutación posterior al insert. B06 no expone borrado, purgas ni reglas de
retención: D12 se resolverá antes de habilitar cualquiera de esas operaciones.

## S20 — idempotencia de confirmaciones

Un servicio común reserva una `Idempotency-Key` opaca no vacía para una operación
y tenant. La clave junto con la operación identifica una sola solicitud: si se
repite el mismo payload canónico devuelve el estado y cuerpo ya almacenados sin
ejecutar el efecto de nuevo; si el payload difiere falla con
`IDEMPOTENCY_KEY_REUSED`. La clave, actor y sucursal proceden de contexto seguro,
nunca de un tenant que el cliente declare libremente.

## S21 — outbox durable sin efectos externos

Dentro de la misma transacción de una mutación se puede anexar un evento outbox
con tenant, sucursal, agregado, tipo y payload. Permanece `PENDING` hasta que un
worker posterior lo procese. B06 no implementa worker, reintentos de publicación,
SIAT, correo ni llamadas a proveedores.

## S22 — secuencias documentales internas

Una secuencia se asigna atómicamente por tenant, sucursal y tipo documental. Dos
peticiones concurrentes no reciben el mismo número. Es una numeración interna de
documentos comerciales; no representa aún numeración, autorización ni aceptación
fiscal.

## S23 — catálogo y presentaciones

El catálogo DEBE mantener categorías y productos del mismo tenant. Una
presentación DEBE pertenecer a su producto mediante FK compuesta y usar un factor
entero positivo hacia la unidad base. La marca de categoría controlada es
informativa hasta resolver D13.

## S24 — códigos de barras

Un código de barras DEBE ser único por tenant y solo devolver presentaciones y
productos activos dentro de la membresía de sucursal del contexto.

## S25 — listas y precios

Una lista DEBE declarar una moneda de tres letras y puede ser global o específica
de la sucursal activa. Los precios conservan hasta cuatro decimales, fechas de
vigencia y no ejecutan redondeo, impuestos ni costos. La búsqueda vigente prioriza
la lista específica de sucursal sobre la global.

## S26 — homologaciones preparadas

El catálogo DEBE guardar autoridad, código externo, descripción y estado por
producto. Registrar la autoridad `SIAT` no llama a servicios externos ni afirma
homologación oficial.

## S27 — proveedores y órdenes de compra

Los proveedores y órdenes DEBEN estar aislados por tenant. Una orden DEBE
conservar almacén, estado, presentación, cantidad base y costo decimal
provisional, con referencias tenant/sucursal protegidas por FKs compuestas y RLS.

## S28 — recepción trazable e idempotente

Una recepción DEBE exigir una clave de idempotencia, lote, vencimiento, cantidad y
costo por línea. Su transacción DEBE crear o reutilizar el lote, incrementar el
saldo del almacén y registrar un movimiento `RECEIPT`; repetir la clave no puede
duplicar ninguno de esos efectos.

## S29 — cuentas por pagar básicas

Una factura de proveedor DEBE poder vincularse a la recepción y crear una cuenta
con monto original, saldo pendiente, moneda y vencimiento. C02 no registra pagos
ni conciliación bancaria.

## S30 — decisiones abiertas

C02 conserva costos como `numeric(18,4)` sin escoger promedio, FIFO, ponderado,
impuestos o redondeo (D08), y no importa saldos históricos (D22). Las reglas de
FEFO, reservas, cuarentena avanzada y mermas quedan para C04/C05.
