# Diseño — fundación FARMAXIA

## Arquitectura

- **Frontend:** Next.js 16 con App Router. Componentes cliente únicamente si necesitan estado o APIs del navegador.
- **Backend:** NestJS 12 sobre Fastify. Las rutas de dominio se versionarán bajo `/api/v1`; health queda fuera.
- **Persistencia:** PostgreSQL 18 es la fuente de verdad. Drizzle gestiona schema/migraciones; Redis no representa saldos, ventas ni movimientos.
- **Aislamiento:** cada request autenticado establece tenant, usuario y sucursal en una transacción; SQL aplica RLS y restricciones entre referencias.
- **Asincronía:** outbox durable en la misma transacción de dominio; el worker procesará SIAT, PDF y notificaciones después de commit.

## Estructura

```text
apps/api        API NestJS/Fastify y pruebas
apps/web        Backoffice y POS Next.js
packages/*      Contratos y configuración compartida
docs/*          Diseño, contratos y evidencia
```

Los módulos de API serán `identity`, `tenancy`, `catalog`, `inventory`, `sales`, `cash`, `documents`, `fiscal` y `audit`. Ningún módulo llama al SIN dentro de una transacción que retenga stock.

## ORM y RLS

Drizzle se usa para acceso tipado y migraciones. Políticas, roles y FKs compuestas que el ORM no exprese de forma fiel se escribirán como SQL revisable. Las pruebas RLS usan el rol de aplicación, nunca el propietario de tablas porque puede eludir las políticas.

## Diseño B02: contexto y relaciones

La migración crea el rol local `farmaxia_app` para desarrollo y concede solo los
privilegios necesarios sobre las tablas del núcleo organizativo. Producción debe
provisionar su equivalente mediante infraestructura segura: la contraseña de
desarrollo no se reutiliza. La API leerá `DATABASE_APP_URL`; `DATABASE_URL` queda
reservada para migraciones.

Cada tabla de tenant tiene `tenant_id`, una restricción única `(tenant_id, id)` y
FK compuestas cuando referencia otro recurso del tenant. Al entrar a una operación
de dominio, `TenantDatabase.withTenant` inicia una transacción y aplica
`set_config('app.tenant_id', tenantId, true)`. Las políticas consultan ese valor;
`true` evita que el contexto se filtre al siguiente uso del pool.

La creación inicial de tenant se realizará por un flujo de plataforma posterior;
no se expondrá como una escritura libre del rol de tenant.

## Diseño B03: dos límites de datos

`farmaxia_auth` lee identidad, membresía, roles y sesiones bajo privilegios
mínimos; `farmaxia_app` sigue atendiendo recursos tenant-scoped mediante RLS. El
servicio de autenticación valida primero la contraseña y luego la membresía
solicitada, por lo que un UUID de tenant/sucursal nunca otorga acceso por sí solo.

La RLS del rol de autenticación limita usuarios al `app.login_email` y sesiones
al `app.refresh_token_hash`, ambos configurados con `set_config(..., true)` en la
misma transacción y derivados por el servidor. Así, el rol no puede enumerar
hashes de contraseñas ni sesiones; sus escrituras de sesión también quedan ligadas
al usuario y tenant del contexto.

## Diseño B04: frontera de recursos internos

`TenantDatabase.withScope` reemplaza la entrada solo por tenant para las
operaciones del rol `farmaxia_app`: abre una transacción y configura tenant,
usuario y sucursal con ámbito local. Las tablas propias de una sucursal aplican
esas tres condiciones mediante RLS; las tablas exclusivamente organizativas siguen
limitadas por tenant si no contienen `branch_id`.

La aplicación usa `withScope` únicamente después de derivar esos valores de
`AuthContext`. El rol de aplicación conserva lectura de la membresía exacta para
comprobar la frontera RLS, pero no recibe permisos de escritura sobre membresías:
un flujo administrativo posterior necesitará un límite de privilegios distinto.

`background_jobs` representa trabajo durable pendiente o terminado, sin ser una
outbox ni ejecutar aún un worker. `tenant_files` representa únicamente metadatos:
el binario no se guarda en PostgreSQL y la clave de almacenamiento debe tener el
prefijo determinista `tenants/{tenantId}/branches/{branchId}/`. Ambas tablas usan
FKs compuestas, `tenant_id`, `branch_id` y RLS forzada.

La caché no recibe una conexión Redis en este lote. Un constructor puro de claves
es la única API permitida: `farmaxia:t:{tenantId}:b:{branchId}:{namespace}:{key}`.
Los consumidores futuros no concatenarán IDs por cuenta propia. Las exportaciones
se modelarán como jobs `EXPORT`; B04 no da acceso HTTP ni guarda reportes reales.

## Diseño B05: suscripciones y cupos

`subscription_plans` conserva el catálogo de planes y el flag `allows_all_features`;
`COMPLETO` parte con ese flag activo. `plan_features` habilita excepciones para los
planes segmentados futuros. `plan_quotas` provee los límites base por recurso y
`subscription_quota_overrides` permite aplicar los límites del trial o contratos
particulares sin modificar el plan.

`tenant_subscriptions` tiene un único registro no cancelado por tenant y fechas
explícitas de inicio, trial y gracia. Un servicio puro valida la máquina de
estados y calcula esas fechas en UTC. El módulo de pagos futuro invocará las
transiciones; B05 no se conecta a un proveedor de cobro.

`tenant_resource_usage` almacena contadores por tenant/recurso. Para un límite
finito, el servicio inserta el contador si falta y ejecuta un `UPDATE` que solo
incrementa cuando `used_units + requested_units <= limit`; la fila bloqueada por
PostgreSQL evita que dos solicitudes simultáneas excedan el cupo. Un `NULL`
significa ilimitado, no cero.

Las contraseñas se hashéan con Argon2id (`m=19456`, `t=2`, `p=1`). Los refresh
tokens son 32 bytes aleatorios, se guarda SHA-256 y se rotan; el JWT solo contiene
identidad y contexto validado, no una lista de permisos que pueda quedar obsoleta.
Los permisos se consultan por rol dentro del tenant. Un guard global autentica y
un guard de permisos opera solo cuando la ruta declara requisitos.

## Diseño B06: escritura transversal confiable

`audit_events` es una bitácora tenant/sucursal con trigger que rechaza `UPDATE` y
`DELETE`. `AuditService.recordInTransaction` recibe el cliente ya delimitado por
`TenantDatabase.withScope`, por lo que una mutación de dominio podrá grabar su
evidencia dentro de la misma transacción sin confiar en IDs de tenant del cuerpo.

`idempotency_records` tiene una restricción única por tenant, operación y clave.
`IdempotencyService.execute` calcula SHA-256 de una representación JSON canónica,
crea el registro y guarda el resultado antes del commit. Un conflicto de clave
devuelve el resultado persistido solo si el hash coincide; si no, eleva el error
de contrato `IDEMPOTENCY_KEY_REUSED`.

`outbox_events` se anexa a través de `OutboxService.enqueueInTransaction`. No hay
consumer en B06: la tabla conserva `PENDING`, intentos y fecha de disponibilidad
para el worker posterior. `document_sequences` usa `INSERT ... ON CONFLICT ...
DO UPDATE ... RETURNING` para entregar un número único por tenant, sucursal y
tipo sin depender de una secuencia global ni de una numeración fiscal.

## Diseño C01: catálogo tenant-scoped

Las tablas `product_categories`, `products`, `product_presentations`,
`product_barcodes`, `price_lists`, `presentation_prices` y
`product_homologations` usan claves y FKs compuestas por tenant. Sus políticas
RLS exigen que el usuario tenga membresía en la sucursal activa; el catálogo
puede ser compartido por varias sucursales sin aceptar un `tenantId` libre.

`CatalogService` concentra las escrituras transaccionales y la búsqueda por
código de barras. La búsqueda filtra producto/presentación activos y usa una
consulta lateral para escoger el precio vigente más reciente, priorizando una
lista de la sucursal sobre una global. Los valores monetarios permanecen como
decimales de PostgreSQL; las reglas de costo y redondeo se reservan para D08.

## Diseño C02: recepción con saldo y movimiento

`ProcurementService.receive` ejecuta la acción mediante el servicio de idempotencia
de B06. En una única transacción inserta `goods_receipts` y sus líneas, crea o
reutiliza `inventory_batches`, incrementa `inventory_balances` y añade un
`inventory_movements` de tipo `RECEIPT`. La recepción valida que el proveedor y
almacén coincidan con la orden y que la cantidad acumulada no supere lo pedido.

Los costos se persisten como decimales de cuatro posiciones sin cálculo de costo
de inventario. `supplier_invoices` y `payables` conservan únicamente el saldo
inicial; pagos y conciliación esperan un lote posterior.

## Diseño C03: conciliación atómica

`InventoryService.reconcile` ejecuta una operación idempotente dentro de
`TenantDatabase.withScope`: bloquea el saldo, inserta la conciliación, calcula
la diferencia y aplica un `UPDATE` condicional que conserva las reservas. Si la
diferencia no es cero añade un movimiento `ADJUSTMENT` con dirección explícita;
si es cero conserva únicamente la evidencia. La auditoría se escribe en la
misma transacción. `inventory_reconciliations` usa FKs compuestas y RLS de
tenant/sucursal. C03 no selecciona método de costeo ni importa saldos.

## Diseño B07: ejecución local en contenedores

Cada aplicación tiene un Dockerfile con contexto raíz del workspace, instalación
reproducible mediante pnpm y Node 22. API conserva Drizzle para ejecutar
`db:migrate` antes de arrancar NestJS. Web compila con `output: "standalone"` y
su runtime solo copia el servidor y estáticos de Next. Compose conecta la API a
`postgres`/`redis` por DNS interno, publica 3001/3000 al host y usa healthchecks
para ordenar el arranque.

## Diseño F1-WEB: shell autenticada

Next.js incorpora `LoginForm`, un cliente de sesión basado en
`NEXT_PUBLIC_API_URL` y `DashboardShell` protegido por `/auth/me`. El access
token vive en `sessionStorage`; el refresh y logout usan `credentials: include`
para conservar la cookie HttpOnly del backend. La UI presenta contexto y
permisos reales, mientras los módulos sin rutas de dominio permanecen marcados
como próximos.
