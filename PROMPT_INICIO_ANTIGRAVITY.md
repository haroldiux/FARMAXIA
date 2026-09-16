# Prompt de inicio para Antigravity — FARMAXIA

Abrir primero la carpeta `C:\PROYECTOS\FARMAXIA` en Antigravity y pegar el bloque siguiente. El plan es Markdown normal; no requiere comandos especiales, modelos concretos ni instalar un plugin.

---

Actúa como arquitecto y desarrollador del proyecto **PharmaCore Bolivia / FARMAXIA**, un SaaS multi-tenant y multisucursal para farmacias bolivianas. Quiero implementar el proyecto por fases, conservando el alcance planificado y verificando cada lote.

## Documentos que debes leer

1. `C:\PROYECTOS\FARMAXIA\PLAN_IMPLEMENTACION_ANTIGRAVITY.md`: propuesta, requisitos RF01–RF16, diseño, decisiones D01–D22, tareas y pruebas T01–T27.
2. `C:\PROYECTOS\FARMAXIA\CONTEXTO_CONSOLIDADO.md`: exploración y diferencias de las fuentes iniciales.
3. `C:\PROYECTOS\FARMAXIA\PharmaCore_Bolivia_Master_Specification.md`.
4. `C:\PROYECTOS\FARMAXIA\Plan_SaaS_Farmacia_Bolivia.md`.
5. `C:\PROYECTOS\FARMAXIA\Prompt_Agente_Codigo_PharmaSaaS.md`.

El plan nuevo, revisión 2, incorpora mi requisito de dos modalidades de venta y mi decisión confirmada D01: **el cajero elige factura o recibo en cada venta**. No vuelvas a tratar esa elección como pendiente ni a exigir aprobación adicional. Las demás decisiones marcadas como propuestas no están confirmadas. Los ejemplos de código/DBML antiguos tienen vacíos conocidos y no deben copiarse como implementación definitiva. Ante diferencias, conserva la solicitud más reciente del usuario y registra la decisión necesaria; no elijas silenciosamente una versión contradictoria.

## Requisito principal de ventas

El POS debe presentar al cajero un selector explícito antes de confirmar:

- **Vender con factura digital:** crea una venta, descuenta stock por lotes FEFO, registra el cobro según su estado y emite el documento fiscal mediante la modalidad SIAT configurada.
- **Sin factura — emitir recibo:** crea una venta real, descuenta stock, registra el cobro y genera un recibo no fiscal numerado. No crea CUF/XML fiscal ni solicita emisión al SIN. El cajero usa su permiso normal de venta, sin aprobación adicional del administrador ni guard tributario que decida el comprobante.

Guardar `document_mode` (`FISCAL_INVOICE` o `NON_FISCAL_RECEIPT`), cajero y fecha en la venta/auditoría. El cajero puede cambiar la opción en borrador. La elección no modifica automáticamente el precio del carrito. Los recibos funcionan sin credenciales SIAT; la opción de factura requiere la configuración técnica de su integración. Una configuración incompleta o un fallo no cambia automáticamente la selección del cajero.

Además, **proforma/cotización** como acción auxiliar: no descuenta stock físico ni registra ingresos. Puede reservar disponibilidad si D09 lo incluye. Convertirla a venta consume la reserva y descuenta stock una sola vez.

Registra las ventas terminadas como ventas, y las cotizaciones como proformas. Una venta confirmada con factura conserva su elección y su historial ante una caída del SIN; no la conviertas automáticamente a recibo. Las correcciones documentales se vinculan a la venta existente, sin duplicar stock, cobro o ingresos. La definición funcional de D01 no certifica el tratamiento tributario del negocio.

## Invariantes de construcción

1. Aislar tenants en API, base, jobs, cache, documentos y exportaciones; validar permisos de sucursal por recurso.
2. Validar presentación-producto, cantidades positivas, factores y lotes vendibles. Stock físico en unidades base y asignaciones por lote en una entidad separada.
3. Confirmación de venta, movimientos y registros locales consistentes en transacción; idempotencia para reintentos y doble clic; llamadas SIAT fuera de bloqueos de inventario.
4. Armar precios/totales en backend con aritmética decimal y política de redondeo definida; no confiar en precios ni tenant del navegador.
5. Mantener ventas, pagos, documentos fiscales y documentos comerciales con estados distintos. La proforma no cuenta como ingreso.
6. Impresión, reimpresión, callbacks y correcciones no vuelven a ejecutar la venta. Stock/cobros/reportes deben conciliar.
7. Controlar cuotas también bajo concurrencia; suscripciones/features no eliminan controles fiscales o sanitarios requeridos para una operación habilitada.
8. Incluir todas las ventas, incluso recibos, en auditoría y reportes. No borrar ventas confirmadas ni ocultar operaciones por su modalidad documental.
9. Distinguir contingencia del SIN de operación de una sucursal sin acceso al SaaS. No prometer stock consistente entre dispositivos offline sin diseñar su autoridad y cupos.
10. No mostrar como finalizados facturación, pagos ni homologaciones solo porque existe una pantalla o un PDF.

## Forma de trabajar

Sigue **EXPLORE → PROPOSE → SPEC + DESIGN → TASKS → APPLY → VERIFY → ARCHIVE** y las instrucciones locales aplicables. Ya existe planificación inicial; primero valida el estado real, resuelve las decisiones necesarias y completa sus contratos. No reinicies desde cero ni cambies decisiones ya confirmadas sin motivo documentado.

La propuesta técnica del plan es NestJS/TypeScript + Vue 3/Quasar + PostgreSQL, Redis, almacenamiento privado y Docker. **D02 sigue pendiente**: si la elección aún no está confirmada, presenta ese punto antes de crear un proyecto dependiente de ese stack. No cambies de tecnología a mitad de una fase.

Trabaja por tareas con sus IDs. Implementa lotes pequeños y usa TDD para dinero, stock, idempotencia, estados, aislamiento y permisos. Verifica migraciones y transacciones con PostgreSQL real. Prueba fallos/reintentos externos y completa las pruebas oficiales SIAT aplicables. Utiliza revisión independiente cuando haya revisores disponibles.

Pregunta únicamente por decisiones no inferibles que afecten el siguiente trabajo. Puedes continuar con documentación, contratos o pruebas independientes mientras una decisión esté pendiente. No solicites de nuevo decisiones ya confirmadas. No marques una tarea como completa sin evidencia de su criterio de aceptación.

Conserva el alcance total de los 13 módulos y el corte del piloto definido. No conviertas las entregas posteriores en exclusiones permanentes. Si D10 requiere offline en el piloto, adelanta O03/O04 y ajusta dependencias y estimación antes de prometer una fecha.

No alteres implícitamente credenciales, sesiones, configuración global ni `.codegraph`. No tomes archivos/configuración de SISA. Configura nuevos servicios del proyecto mediante el proceso autorizado y nunca incluyas secretos en prompts o commits. Una publicación en producción requiere la autorización correspondiente y evidencia de preparación.

## Primera ejecución solicitada

1. Inspecciona FARMAXIA y los documentos; indica qué existe y qué sigue pendiente, sin confundir planes con código.
2. Crea `REGISTRO_DECISIONES.md` con D01–D22, estado, responsable, elección, motivo y tareas afectadas. Marca D01 como confirmada: el cajero decide el comprobante sin aprobación adicional. Usa las respuestas ya disponibles para las demás y deja claramente abiertas las restantes.
3. Crea `ESTADO_IMPLEMENTACION.md` con fase actual, tareas, evidencia, bloqueos concretos y próxima tarea.
4. Trabaja en F0, tareas A01–A04: delimita el piloto, cierra las decisiones de base posibles y completa modelo/contratos/pruebas. Las decisiones de entregas posteriores no bloquean innecesariamente el núcleo.
5. Cuando las decisiones de base y contratos necesarios estén resueltos, empieza el primer lote de F1 siguiendo sus dependencias. No saltes directamente al servicio FEFO del prompt antiguo.

Al cerrar cada lote, informa:

- IDs y comportamiento implementado.
- Archivos modificados.
- Pruebas ejecutadas y resultados reales.
- Decisiones pendientes que afectan al próximo lote.
- Próxima tarea y condición para comenzar.

Si faltan datos o credenciales SIAT de un tenant real, desarrolla y prueba la integración fiscal con datos sintéticos y simuladores claramente identificados. No inventes credenciales ni respuestas del SIN. Esa dependencia afecta a la emisión de facturas; el circuito de recibos se desarrolla y prueba independientemente.

---

Este prompt sirve para una ejecución posterior en Antigravity. En la entrega de este archivo solo se ha realizado planificación; no se ha iniciado implementación ni desplegado el sistema.
