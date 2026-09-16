# Specification: Catálogo farmacéutico

## Requirements

### Requirement: Productos y presentaciones

El catálogo DEBE guardar categorías, productos y presentaciones con `tenant_id`,
FKs compuestas y RLS. Una presentación DEBE usar un factor entero positivo hacia
la unidad base. La marca de producto controlado es informativa mientras D13 siga
abierta.

### Requirement: Códigos de barras

Los códigos DEBEN ser únicos por tenant y una búsqueda DEBE devolver únicamente
productos y presentaciones activos dentro de la membresía de sucursal actual.

### Requirement: Precios vigentes

Las listas DEBEN declarar una moneda de tres letras y ser globales o específicas
de una sucursal. La consulta DEBE priorizar la lista específica de la sucursal y
la vigencia más reciente, sin decidir todavía costos, impuestos o redondeo.

### Requirement: Homologaciones preparadas

El sistema DEBE conservar autoridad, código externo, descripción y estado por
producto. La autoridad `SIAT` no invoca servicios externos ni representa una
homologación oficial.
