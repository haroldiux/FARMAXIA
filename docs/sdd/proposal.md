# Propuesta — fundación del piloto FARMAXIA

## Problema

FARMAXIA contiene planificación pero no una aplicación. El piloto necesita una base que permita construir módulos de farmacia sin perder aislamiento multi-tenant, consistencia de inventario ni la elección de comprobante por el cajero.

## Resultado

Crear un monorepo TypeScript con una interfaz Next.js y una API NestJS sobre Fastify. La API será un monolito modular; PostgreSQL será la fuente de verdad y una outbox publicará efectos externos. El primer lote entrega base verificable, no funcionalidades de farmacia simuladas.

## Alcance

- Estructura reproducible de frontend, API y paquetes compartidos.
- Estándares de TypeScript, calidad, pruebas, variables de entorno y Docker local.
- Contratos, modelo y decisiones para iniciar F1.

## Riesgos y no objetivos

No se emite factura ni se usan credenciales SIAT. No se implementan pagos externos, operación offline, recetas, carga de inventario ni producción. La RLS se valida contra PostgreSQL real antes de afirmar aislamiento efectivo.

## Lote B02 — estructura organizativa aislada

Crear la persistencia mínima del piloto: tenants, razón social, sucursales,
almacenes, cajas, usuarios y membresías de sucursal. El objetivo observable es que
un rol de aplicación solo pueda leer y escribir su tenant, y que las referencias
de otra organización sean rechazadas en la base de datos. Quedan fuera el login,
las sesiones, RBAC completo, cuotas y cualquier operación de venta.

## Lote B03 — identidad, sesiones y permisos

Incorporar login local, JWT de acceso breve, sesión de refresco rotativa y RBAC por
tenant. La sucursal seleccionada por el cliente se acepta únicamente si una
membresía del usuario la autoriza. Esta entrega no incluye recuperación de
contraseña, SSO, MFA/TOTP, administración de usuarios ni interfaces de login.

## Lote B04 — límites de recursos tenant/sucursal

Extender la frontera ya creada para que los recursos internos que generen efectos
asíncronos también pertenezcan a una sucursal concreta. El lote agrega contexto
transaccional de tenant, usuario y sucursal; metadatos RLS para trabajos durables y
archivos; y una única construcción validada de claves de caché. No implementa un
worker, Redis como fuente de verdad, carga/descarga de archivos, exportaciones de
negocio ni outbox: esas capacidades requieren módulos consumidores posteriores.

## Lote B05 — plan, suscripción y cuotas

Implementar un único plan inicial `COMPLETO` con todas las funciones permitidas y
cuotas explícitamente ilimitadas. El modelo almacena entitlements y límites por
recurso para segmentar planes posteriores sin bifurcar la aplicación. Las
suscripciones pueden iniciar en trial de 7 días o directamente activas; una deuda
mantiene acceso por 3 días antes de suspender. No integra cobros, pasarelas ni
pantallas de facturación: los cambios de estado son operaciones internas hasta que
exista ese módulo.

## Lote B06 — servicios transversales confiables

Incorporar los componentes que protegen las mutaciones de dominio posteriores:
auditoría de solo anexado, idempotencia por tenant y operación, outbox durable y
secuencias documentales internas por sucursal. No se borra información auditada,
no se ejecuta un worker ni se publica un evento a terceros. La retención legal por
clase sigue siendo una decisión externa (D12), por lo que tampoco se implementan
expiración ni purgas.

## Lote C01 — catálogo farmacéutico

Crear el catálogo tenant-scoped de productos, categorías, presentaciones, códigos
de barras, listas/precios y homologaciones externas preparadas. C01 no implementa
compras, lotes, FEFO, ventas, validación SIAT ni dispensación controlada.

## Lote C02 — compras, recepción y cuentas por pagar

Registrar proveedores y órdenes, recibir mercadería por lote y vencimiento en un
almacén y crear cuentas por pagar básicas. Los costos se almacenan como decimales
provisionales; no se decide todavía el método de costeo/importación de D08/D22,
ni se integran pagos a proveedores.
