# Especificación — Vista operativa de inventario F3-WEB

## F3.1 — Almacenes scoped

El backend DEBE exponer `GET /api/v1/inventory/warehouses` bajo
`inventory.manage`. La respuesta DEBE contener `id`, `name` e
`isDispatchEnabled` únicamente de almacenes activos de `scope.branchId` y del
tenant autenticado. Sin bearer o sin permiso la respuesta DEBE ser 401/403.

**Escenario: almacenes de la sucursal**

- **Dado** un usuario miembro de una sucursal con almacenes en dos sucursales
- **Cuando** consulta el endpoint con su access token
- **Entonces** recibe solo los almacenes de la sucursal del token.

## F3.2 — Carga de inventario

`/inventory` DEBE exigir sesión y permiso `inventory.manage`. Al montar, la
vista DEBE cargar almacenes, seleccionar el primero de forma determinista y
consultar `expiry-alerts` con horizonte inicial de 30 días. El usuario DEBE
poder cambiar almacén y horizonte 7, 30 o 90; cada cambio DEBE reemplazar la
consulta anterior y mostrar loading sin mezclar resultados.

La pantalla DEBE mostrar por alerta lote, fecha, estado, unidades físicas,
reservadas y libres. Un listado vacío DEBE explicar que no hay vencimientos en
el horizonte, sin mostrar ceros inventados.

## F3.3 — Acciones operativas

Cada lote `AVAILABLE` DEBE ofrecer cuarentena y merma; cada lote
`QUARANTINED` DEBE ofrecer liberación. La UI DEBE pedir motivo y confirmar
antes de enviar. Las mutaciones DEBEN incluir un `idempotencyKey` nuevo por
intento, respetar `inventory.manage`, mostrar éxito/error y recargar las alertas
del almacén seleccionado. Los errores 401 DEBEN redirigir al login mediante el
cliente de sesión existente; 403 y conflictos DEBEN quedar visibles.

## F3.4 — Accesibilidad y responsive

La vista DEBE usar labels asociados, botones con texto, `role="alert"` para
errores y `role="status"` para éxitos/carga. En viewport estrecho la tabla DEBE
convertirse en tarjetas legibles sin scroll horizontal obligatorio.

## Fuera de alcance

F3-WEB no implementa alta de almacenes, ventas, proformas, transferencias,
sensores, notificaciones ni dashboards financieros. No modifica los estados de
suscripción ni las decisiones D08/D09/D22.
