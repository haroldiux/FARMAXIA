# Specification: C01 — Catálogo farmacéutico

## C01.1 — Categorías y productos

El sistema DEBE almacenar categorías y productos dentro de un tenant. Una
categoría MAY marcarse como controlada, pero esa marca no habilita dispensación.
Un producto DEBE conservar nombre, ingrediente activo opcional y estado activo.

### Scenario: aislamiento del catálogo

- GIVEN una sesión de usuario autorizada en tenant T1 y sucursal B1
- WHEN crea o consulta un producto
- THEN solo puede afectar filas de T1 y su categoría pertenece al mismo tenant

## C01.2 — Presentaciones y unidad base

Una presentación DEBE pertenecer al mismo tenant y producto, tener nombre único
dentro del producto y un `base_unit_factor` entero mayor que cero. Solo las
presentaciones vendibles se podrán marcar `is_sellable`; la venta queda fuera de
C01.

### Scenario: factor válido

- GIVEN un producto farmacéutico
- WHEN se registra una caja con factor 20
- THEN la presentación conserva factor 20 y no se convierte a decimal o dinero

## C01.3 — Códigos de barras

Un código DEBE pertenecer a una presentación y ser único dentro del tenant. La
búsqueda por código DEBE respetar RLS y devolver la presentación activa junto con
su producto; un código inexistente devuelve vacío.

## C01.4 — Precios y listas

Una lista DEBE declarar moneda ISO de tres letras y puede ser global o de una
sucursal. Un precio DEBE usar decimal exacto de hasta cuatro posiciones, fecha de
inicio y una fecha final posterior opcional. La selección de precio prioriza la
lista de la sucursal sobre la global y la vigencia más reciente. C01 no decide
redondeo, costos ni impuestos.

## C01.5 — Homologaciones preparadas

Una homologación DEBE guardar autoridad, código externo, descripción opcional y
estado, ligada al producto y tenant. Guardar `SIAT` como autoridad no realiza
ninguna llamada, firma ni validación: D03 permanece abierta.
