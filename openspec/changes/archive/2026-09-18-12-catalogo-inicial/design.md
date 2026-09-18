# Diseño técnico: Primer módulo de catálogo conectado

`CatalogService.listProducts` ejecuta una consulta agrupada bajo
`TenantDatabase.withScope`, filtra productos activos y agrega presentaciones
como JSON. `CatalogController` expone lectura y altas bajo el guard global de
autenticación y `catalog.manage`; la RLS continúa siendo la frontera final.

La página Next `/catalog` usa el cliente de sesión existente, busca mediante
`authenticatedFetch`, muestra estados vacíos y ofrece el formulario de alta. El
dashboard enlaza el módulo solo cuando la sesión contiene `catalog.manage`.
