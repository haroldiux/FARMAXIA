# Registro de decisiones — FARMAXIA

Complementa `PLAN_IMPLEMENTACION_ANTIGRAVITY.md`. Una decisión abierta bloquea solo las tareas que la consumen.

| ID | Estado | Responsable | Elección vigente / motivo | Tareas afectadas |
| --- | --- | --- | --- | --- |
| D01 | Confirmada · 2026-09-12 | Producto | El cajero elige factura digital o recibo no fiscal por venta, sin aprobación adicional. Requisito explícito. | V03, V05, T09, T10 |
| D02 | Confirmada · 2026-09-15 | Producto/Técnico | Monorepo pnpm + TypeScript: Next.js 16/React, NestJS 12/Fastify, PostgreSQL 18, Drizzle, Redis y Docker Compose. | A01, B01–B07 |
| D03 | Abierta externa | Tributario/Técnico | El núcleo expone `FiscalProvider`; adaptador SIAT real espera modalidad, contrato y credenciales del emisor. | F01–F05, T08, T15–T17 |
| D04 | Confirmada para piloto · 2026-09-15 | Producto/Tributario | Un tenant tiene una razón social/NIT activa y varias sucursales. Se conserva entidad para evolución multiemisor. | A01, A02, B02, F01 |
| D05 | Confirmada · 2026-09-15 | Técnico | Base compartida con `tenant_id`, FKs compuestas, contexto transaccional y RLS. Drizzle gestiona migraciones; el rol app no es propietario ni usa `BYPASSRLS`. | A02, B04, T01, T02 |
| D06 | Reemplazada por D23 · 2026-09-26 | Producto | Lanzamiento con un único plan `COMPLETO`, todas las funciones habilitadas. La segmentación futura se hará por entitlements, sin crear productos separados ahora. | B05, T03, T23 |
| D07 | Reemplazada por D24 · 2026-09-26 | Producto/Técnico | Trial: 1 sucursal, 5 usuarios, 1 caja activa y 1 GB. Plan `COMPLETO`: esos recursos ilimitados (`NULL`). El modelo conserva cuotas por recurso para futuros planes. | B05, T03 |
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
| D23 | Confirmada · 2026-09-26 | Producto (Denilson) | Planes Básico, Profesional y Premium con los límites y funcionalidades de la matriz maestra. Precios iniciales 150/350/700 BOB al mes, editables desde el panel de plataforma. `COMPLETO` queda como plan interno sin costo. | Core SaaS, B05 |
| D24 | Confirmada · 2026-09-26 | Producto (Denilson) | La prueba de 7 días usa los límites del plan elegido al registrarse (antes: cuotas propias de trial, D07). | Core SaaS, B05 |
| D25 | Confirmada · 2026-09-26 | Producto (Denilson) | Cobro manual: la farmacia declara el pago (QR o transferencia, con comprobante opcional) y un operador lo aprueba. La pasarela real queda para cuando exista contrato; el método `GATEWAY` está reservado. | Core SaaS |
| D26 | Confirmada · 2026-09-26 | Producto (Denilson) | Comprobante de cobro no fiscal con numeración correlativa `FX-000001` hasta que exista la facturación SIAT (D03). | Core SaaS, F01 |
| D27 | Confirmada · 2026-09-26 | Producto (Denilson) | Registro público de farmacias con 7 días de prueba; límite de 5 registros por IP por hora. | Core SaaS |
| D28 | Confirmada · 2026-09-27 | Producto (Denilson) | Login con correo y contraseña; la farmacia y la sucursal se eligen tras validar la contraseña. El identificador (slug) o UUID de farmacia sigue aceptándose. | Módulo 1 |
| D29 | Confirmada · 2026-09-27 | Producto (Denilson) | Roles predefinidos por farmacia: Propietario, Regente, Encargado, Cajero y Almacenero (no editables) + roles personalizados. Sin escalada de permisos y con al menos un Propietario activo. | Módulo 1 |
| D30 | Confirmada · 2026-09-27 | Producto/Técnico | 2FA opcional con app de autenticación (TOTP). Si alguien pierde el teléfono, un administrador de su farmacia le quita el 2FA. | Módulo 1 |
| D31 | Confirmada · 2026-09-27 | Técnico | Las cuentas son globales por correo; nombre, estado, contraseña y 2FA solo se administran en la farmacia dueña (`home_tenant_id`). | Módulo 1 |
| D32 | Pendiente · revisar con Harold (regencia) | Producto/Regencia | Clasificación de venta provisional: Venta libre, Bajo receta, Receta retenida y Controlado. Falta confirmar la lista oficial y qué exige cada una al vender. | Módulo 2, módulo 8 |
| D33 | Pendiente · revisar con Harold (tributario) | Tributario/Técnico | Los códigos SIN (actividad, producto y unidad de medida) se guardan solo con dígitos, sin validarlos contra los catálogos del SIN. Depende de D03. | Módulo 2, módulo 6 |
| D34 | Pendiente · revisar con Harold (regencia) | Regencia | Los medicamentos controlados se marcan en la ficha (por producto o categoría) pero aún no bloquean la venta ni piden receta; eso llega con el módulo 8 (D13). | Módulo 2, módulo 8 |
| D35 | Confirmada · 2026-09-27 | Técnico | El factor de conversión de una presentación no se edita (el stock y las ventas dependen de él): se crea otra presentación y se desactiva la anterior. Los productos no se borran, se desactivan. | Módulo 2 |
| D36 | Pendiente · revisar con Harold (regencia) | Regencia | Forma farmacéutica en texto libre con sugerencias; falta decidir si se usa la lista oficial de AGEMED. | Módulo 2 |
| D37 | Pendiente · revisar con Harold (producto/regencia) | Producto/Regencia | Inventario físico: conteo ciego, un conteo en curso por almacén y aprobación con el permiso `inventory.count.approve` (Propietario, Regente, Encargado). Al aprobar se ajusta el stock **actual** a lo contado: se recomienda contar sin ventas en ese almacén. Falta decidir si debe aprobar alguien distinto de quien contó y si se exige bloquear ventas durante el conteo. | Módulo 3 |
| D38 | Pendiente · revisar con Harold (regencia) | Regencia | Acta de baja con formato provisional: número `AB-<sucursal>-000001`, razón social, NIT, lote, cantidad, costo, motivo, destino (destrucción, devolución, otro) y firmas de almacén, regente y testigo. Falta confirmar el formato que exige AGEMED/SEDES y si se agrupan varias bajas en una sola acta. | Módulo 3 |
| D39 | Confirmada · 2026-09-27 | Técnico | Tipos de almacén: General, Central, Cuarentena (nunca despacha) y Cadena de frío. Un almacén no se borra; se desactiva solo sin stock, reservas ni conteos en curso. Alertas automáticas cada hora con 30 días de anticipación (configurables). Las reservas se ven y liberan desde la web, pero la venta POS sigue descontando directo hasta resolver D09. | Módulo 3 |

## Regla de actualización

Al cerrar una decisión, registrar fecha, responsable, alternativa, motivo y tareas afectadas. Las decisiones tributarias, sanitarias y de pagos externos no se cierran con datos sintéticos.
