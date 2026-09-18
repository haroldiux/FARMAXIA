# Propuesta — Vista operativa de inventario F3-WEB

## Problema

C05 dejó contratos de inventario listos, pero el backoffice todavía no ofrece
una vista para que una sucursal seleccione su almacén, revise vencimientos y
ejecute acciones operativas. El contexto de sesión no incluye `warehouseId`,
por lo que el cliente no puede resolverlo de forma segura sin un contrato de
lectura scoped.

## Resultado deseado

Conectar una vista Next.js `/inventory` que:

- cargue únicamente almacenes de la sucursal activa;
- muestre alertas de vencimiento con cantidades físicas, reservadas y libres;
- permita cuarentenar/liberar lotes y registrar mermas desde acciones explícitas;
- exponga estados de carga, vacío, error, éxito y sesión sin inventar métricas;
- respete `inventory.manage`, refresh de sesión, responsive design y Docker.

## Alcance

- Endpoint `GET /api/v1/inventory/warehouses` scoped y protegido.
- Cliente tipado de inventario en la web y ruta `/inventory`.
- Selector de almacén y horizonte 7/30/90 días.
- Tabla responsive de alertas con acciones C05 y confirmación antes de mutar.
- Pruebas API del listado de almacenes, typecheck/build y verificación de
  Compose/smoke HTTP.

## No objetivos

- No implementar ventas, proformas, transferencias, sensores ni notificaciones.
- No añadir métricas agregadas que el API no entregue.
- No cerrar D08, D09 ni D22.
- No reemplazar el shell de autenticación ni crear un segundo sistema de sesión.

## Capacidades

### Nuevas capacidades

- `inventory-web`: vista operativa autenticada para alertas y acciones C05.

### Capacidades modificadas

- `inventory`: lectura scoped de almacenes disponibles para la sucursal activa.

## Enfoque

Añadir `listWarehouses` en `InventoryService` y un `GET` en el controller,
reutilizando `withScope`, RLS y `inventory.manage`. En Next se creará un cliente
pequeño que usa `authenticatedFetch`, carga almacenes y luego alertas del
almacén seleccionado. La UI seguirá los tokens y componentes visuales actuales,
con acciones modales inline que envían idempotency keys generadas en el cliente
y recargan la consulta tras éxito.

## Áreas afectadas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `apps/api/src/inventory` | Modificada | Lectura de almacenes y ruta GET. |
| `apps/api/test/inventory.spec.ts` | Modificada | Prueba de scope y disponibilidad de almacenes. |
| `apps/web/app/inventory` | Nueva | Página funcional de inventario. |
| `apps/web/app/lib/inventory.ts` | Nueva | Contratos y cliente HTTP tipado. |
| `apps/web/app/components/dashboard-shell.tsx` | Modificada | Enlace activo a Inventario cuando exista permiso. |
| `apps/web/app/globals.css` | Modificada | Layout responsive y estados de la vista. |

## Riesgos y mitigaciones

| Riesgo | Probabilidad | Mitigación |
|--------|--------------|------------|
| El usuario no tiene almacenes visibles | Media | Estado vacío explícito; no se inventa un ID. |
| Reintento de acción operativa | Media | Idempotency key única por intento y recarga posterior. |
| Acción sobre lote stale | Media | El API vuelve a validar estado/saldo; la UI muestra el error sin ocultarlo. |
| Pantalla no usable en móvil | Baja | Tabla se transforma en tarjetas y pruebas de build responsive. |

## Rollback

Revertir el commit del lote. El endpoint de almacenes es aditivo y puede
retirarse sin afectar C05 ni datos persistidos; la ruta web puede ocultarse del
shell mientras se conserva el API.

## Dependencias

- API C05 publicada (`8c46fe6`) y permiso `inventory.manage`.
- Sesión existente `/api/v1/auth/me` y refresh HttpOnly.
- Compose local con API y Web saludables.

## Criterios de éxito

- [ ] Un usuario con `inventory.manage` ve solo almacenes de su sucursal.
- [ ] La pantalla carga alertas y presenta estados loading/empty/error/success.
- [ ] Cuarentena, liberación y merma se confirman, envían idempotencia y
  actualizan la tabla sin recarga completa.
- [ ] Typecheck/build web y API, pruebas PostgreSQL y smoke Docker pasan.
