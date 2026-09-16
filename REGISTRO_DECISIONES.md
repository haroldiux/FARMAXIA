# Registro de decisiones — FARMAXIA

Complementa `PLAN_IMPLEMENTACION_ANTIGRAVITY.md`. Una decisión abierta bloquea solo las tareas que la consumen.

| ID | Estado | Responsable | Elección vigente / motivo | Tareas afectadas |
| --- | --- | --- | --- | --- |
| D01 | Confirmada · 2026-09-12 | Producto | El cajero elige factura digital o recibo no fiscal por venta, sin aprobación adicional. Requisito explícito. | V03, V05, T09, T10 |
| D02 | Confirmada · 2026-09-15 | Producto/Técnico | Monorepo pnpm + TypeScript: Next.js 16/React, NestJS 12/Fastify, PostgreSQL 18, Drizzle, Redis y Docker Compose. | A01, B01–B07 |
| D03 | Abierta externa | Tributario/Técnico | El núcleo expone `FiscalProvider`; adaptador SIAT real espera modalidad, contrato y credenciales del emisor. | F01–F05, T08, T15–T17 |
| D04 | Confirmada para piloto · 2026-09-15 | Producto/Tributario | Un tenant tiene una razón social/NIT activa y varias sucursales. Se conserva entidad para evolución multiemisor. | A01, A02, B02, F01 |
| D05 | Confirmada · 2026-09-15 | Técnico | Base compartida con `tenant_id`, FKs compuestas, contexto transaccional y RLS. Drizzle gestiona migraciones; el rol app no es propietario ni usa `BYPASSRLS`. | A02, B04, T01, T02 |
| D06 | Confirmada · 2026-09-16 | Producto | Lanzamiento con un único plan `COMPLETO`, todas las funciones habilitadas. La segmentación futura se hará por entitlements, sin crear productos separados ahora. | B05, T03, T23 |
| D07 | Confirmada · 2026-09-16 | Producto/Técnico | Trial: 1 sucursal, 5 usuarios, 1 caja activa y 1 GB. Plan `COMPLETO`: esos recursos ilimitados (`NULL`). El modelo conserva cuotas por recurso para futuros planes. | B05, T03 |
| D08 | Abierta | Producto/Tributario/Técnico | BOB inicial; no se usará `number` para dinero. Redondeo y costos antes de F2. | C01–C04, V03 |
| D09 | Abierta | Producto | Proforma no mueve stock ni caja; reserva/vencimiento deben aprobarse antes de habilitarse. | V06, T11, T12 |
| D10 | Confirmada para piloto · 2026-09-15 | Producto/Técnico | Piloto con backend accesible; contingencia SIAT aparte; no hay venta offline SaaS inicial. | A01, V03, O03, T26 |
| D11 | Confirmada · 2026-09-16 | Producto/Técnico | Estados `trialing` (7 días), `active`, `past_due` (3 días de gracia), `suspended`, `canceled`. Un alta pagada o contractual puede iniciar directamente en `active`. | B05, T23 |
| D12 | Abierta externa | Tributario/Regencia/Técnico | Auditoría inmutable desde F1; retención por clase antes de eliminación/producción. | B06, H03 |
| D13 | Abierta externa | Regencia | Productos controlados deshabilitados hasta especificar recetas, adjuntos, retención y reportes. | R01–R04, T20 |
| D14 | Abierta | Producto/Tributario/Técnico | Efectivo, tarjeta y QR con estados explícitos; proveedor/conciliación antes de pagos reales. | V04, V07, T19, T25 |
| D15 | Abierta | Producto/Regencia | Traspasos esperan reglas de aprobación, recepción parcial y diferencias. | M01–M04, T21 |
| D16 | Abierta | Producto/Técnico | Docker Compose para desarrollo; hosting, backup, RPO/RTO y presupuesto antes de piloto. | B01, H01–H04, T24 |
| D17 | Abierta | Producto/Técnico | Plantillas de documento independientes de hardware hasta prueba con impresora/periféricos reales. | V05, F05 |
| D18 | Abierta externa | Tributario/Técnico | Correcciones se vinculan a venta original y nunca repiten movimientos. Casos autorizados pendientes. | V07, F04, T18 |
| D19 | Abierta | Producto | Nombre operativo FARMAXIA; identidad visual antes de UI de producción. | UI F1–F3 |
| D20 | Abierta | Producto/Regencia/Técnico | Privacidad y datos mínimos antes de CRM, recetas adjuntas o convenios. | G01–G04 |
| D21 | Abierta | Producto/Técnico | Instrumentar métricas ahora; objetivos de carga antes de piloto. | H02 |
| D22 | Abierta externa | Producto/Regencia | Migración real espera catálogo, lotes, vencimiento, costos y conciliación firmados. | C03, C06 |

## Regla de actualización

Al cerrar una decisión, registrar fecha, responsable, alternativa, motivo y tareas afectadas. Las decisiones tributarias, sanitarias y de pagos externos no se cierran con datos sintéticos.
