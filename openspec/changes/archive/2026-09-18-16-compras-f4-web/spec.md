# Especificación — Compras F4-WEB

## Requisito F4.1 — Proveedores scoped

El API MUST exponer `GET /api/v1/procurement/suppliers` bajo
`inventory.manage`. La respuesta MUST devolver `{ items }` de proveedores
activos del tenant activo, ordenados por nombre e identificador; el modelo C02
no asigna proveedores a una sucursal.

### Escenario F4.1.1 — Aislamiento y orden

Given proveedores activos en el tenant y otro tenant
When un usuario con `inventory.manage` consulta proveedores
Then recibe solo proveedores visibles de su tenant en orden determinista y sin
exponer datos externos.

### Escenario F4.1.2 — Permiso insuficiente

Given una sesión sin `inventory.manage`
When consulta proveedores
Then el API MUST responder `403` sin filtrar el listado.

## Requisito F4.2 — Órdenes scoped con líneas

El API MUST exponer `GET /api/v1/procurement/purchase-orders` bajo
`inventory.manage`. Debe devolver órdenes de almacenes de la sucursal activa,
proveedor/almacén legibles, estado, fecha y líneas con presentación/producto,
cantidad base y costo unitario.

### Escenario F4.2.1 — Consulta de órdenes

Given órdenes en dos sucursales
When se consulta el listado de la sucursal activa
Then solo se devuelven sus órdenes, con líneas agrupadas y ordenadas por fecha
descendente e identificador descendente.

## Requisito F4.2b — Presentaciones para compra

El API MUST exponer `GET /api/v1/procurement/presentations` bajo
`inventory.manage`, devolviendo presentaciones de productos activos del tenant,
ordenadas por producto y nombre. No debe exponer productos de otro tenant ni
permitir mutación desde esta ruta.

## Requisito F4.3 — Alta de proveedor y orden

El API MUST exponer `POST /api/v1/procurement/suppliers` y
`POST /api/v1/procurement/purchase-orders` bajo `inventory.manage`.
Las mutaciones MUST validar campos existentes del servicio C02, respetar el
scope de tenant/sucursal y devolver el identificador creado.

### Escenario F4.3.1 — Crear proveedor

Given un nombre válido y un NIT opcional
When el usuario registra el proveedor
Then el API crea un proveedor activo y responde `201` con su `id`.

### Escenario F4.3.2 — Crear orden de una línea

Given proveedor, almacén y presentación visibles
When el usuario envía cantidad base positiva y costo decimal válido
Then el API crea una orden `SUBMITTED` con la línea y responde `201` con su
`id`.

## Requisito F4.4 — Vista Web de compras

La ruta `/procurement` MUST requerir sesión y `inventory.manage`, cargar
proveedores/órdenes/contexto de almacenes y mostrar estados de carga, vacío,
error y éxito. La creación de proveedor y orden MUST refrescar los listados y
mostrar errores `401`, `403` o `409` sin perder el formulario.

### Escenario F4.4.1 — Navegación y responsive

Given una sesión autorizada en un viewport móvil o escritorio
When abre Compras desde dashboard
Then la vista mantiene controles etiquetados, foco visible y layout usable sin
scroll horizontal; una sesión no autorizada vuelve a login.

## Requisito F4.5 — Recepción diferida

La vista MUST indicar que la recepción por lote todavía no pertenece a este
lote y no debe inventar cantidades recibidas ni modificar stock.
