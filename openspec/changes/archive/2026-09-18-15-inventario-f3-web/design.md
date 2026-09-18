# Diseño — Vista operativa de inventario F3-WEB

## API

`InventoryService.listWarehouses(scope)` ejecutará una lectura dentro de
`TenantDatabase.withScope`, filtrando `tenant_id`, `branch_id`, `is_active` y
ordenando por nombre e ID. `InventoryController` añadirá el GET antes de las
rutas mutantes. La respuesta será `{ items: [{ id, name, isDispatchEnabled }] }`
para permitir evolución sin romper el cliente.

## Cliente web

`apps/web/app/lib/inventory.ts` contendrá los tipos `Warehouse` y `ExpiryAlert`,
un `inventoryApi` pequeño y funciones de parseo de error. No se duplicará la
lógica de tokens: todas las llamadas pasarán por `authenticatedFetch`.

## Página

`InventoryPage` será un Client Component por necesitar sesión, selección y
acciones. Su estado se dividirá en:

- `session`, `warehouses`, `selectedWarehouseId`, `horizonDays`;
- `alerts`, `loading`, `actionKey`, `error`, `notice`.

La carga usará un contador de request para ignorar respuestas obsoletas cuando
el usuario cambie filtros rápido. La acción se abre en un panel inline asociado
al lote y se cierra tras éxito; no habrá modales de portal ni dependencias
externas.

## Visual y responsive

Se reutilizarán `paper`, `navy`, `blue`, `orange`, `green` y los paneles del
catálogo. En desktop habrá encabezado, selector, resumen textual y tabla; a
640px la tabla se renderizará como filas apiladas con acciones a ancho completo.
Los estados usarán el mismo lenguaje visual de `center-state`, `form-error` y
`form-success`.

## Navegación

El elemento Inventario del `DashboardShell` será `Link` solo si la sesión tiene
`inventory.manage`; los demás usuarios verán el estado `Próximo`, sin revelar
datos del módulo. La página seguirá enlazando al resumen y conservará logout.

## Verificación

TDD se aplicará al GET con prueba roja PostgreSQL y luego verde. La UI se
verificará con typecheck, build, Compose y smoke HTTP; al no existir harness
visual en el paquete web, se documenta esa validación estructural y se evita
afirmar una prueba de navegador no ejecutada.
