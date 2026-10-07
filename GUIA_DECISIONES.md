# FARMAXIA — Guía para revisar las decisiones pendientes

**Fecha:** 7 de octubre de 2026 · **Autor:** Denilson Godoy

FARMAXIA tiene todos sus módulos funcionando salvo la facturación SIAT (módulo 6), y quedan 62 decisiones sin cerrar. Conviene revisarlas en tres rondas, de la que más destraba a la que menos.

1. **Ronda 1, bloqueantes (10 decisiones en 8 temas):** sin respuesta, la funcionalidad no se puede construir. Incluye la facturación SIAT, que es lo más grande que falta.
2. **Ronda 2, reglas de negocio (con Harold):** ya están implementadas de forma provisional. Solo hay que confirmar o corregir la regla.
3. **Ronda 3, técnicas (con el docente):** también funcionan. Solo necesitan visto bueno.

El detalle de cada decisión está en [`REGISTRO_DECISIONES.md`](REGISTRO_DECISIONES.md). Una decisión provisional que se confirma no cambia código; una que se corrige sí.

## Ronda 1: decisiones que bloquean funcionalidades

Estas van primero porque, sin respuesta, la funcionalidad no existe. D03 es externa: no se decide en una reunión, requiere un trámite ante Impuestos Nacionales.

| Decisión | Pregunta concreta | Qué destraba | Quién responde |
| --- | --- | --- | --- |
| D03 | ¿Con qué modalidad de facturación SIAT se emite, y quién aporta el contrato y las credenciales del emisor? | Módulo 6 completo: CUFD, CUF, XML firmado, QR, contingencia, anulación, catálogos del SIN | Docente + trámite externo |
| D09 y D48 | ¿Las proformas deben reservar stock? ¿Por cuántos días? Hoy no reservan y valen 7 días. | Reservas reales desde el POS; requisito previo de D81 | Docente |
| D08 y D40 | ¿El costo es promedio ponderado (como hoy) o última compra? ¿Por farmacia o por sucursal? ¿El IVA forma parte del costo? | Costeo de compras y márgenes de analítica (D72) | Harold (tributario) |
| D22 | ¿Cómo se cargan el catálogo, los lotes y el stock inicial de una farmacia real? | Puesta en marcha con datos reales | Docente + farmacia piloto |
| D81 | ¿Los pedidos de tienda en línea o delivery crean ventas, o solo reservan stock? | Integración con e-commerce y delivery (depende de D09 y D03) | Docente |
| D82 | ¿Con qué apps de delivery o plataformas de e-commerce se integra, y con qué contratos? | Integración con un proveedor concreto | Docente |
| D83 | ¿La API pública solo lee datos (como hoy) o también puede escribir clientes, pedidos o stock? | API pública de escritura | Docente |
| D16 | ¿Dónde se aloja el sistema, con qué copias de seguridad y con qué presupuesto? | Piloto en una farmacia real | Docente |

## Ronda 2: reglas de negocio con Harold

Todas ya funcionan con una regla provisional. Para cada grupo basta con preguntar si la regla actual es correcta y, si no, cuál es la correcta. Están ordenadas por riesgo: primero lo sanitario y lo tributario.

| Orden | Tema | Decisiones | Pregunta clave |
| --- | --- | --- | --- |
| 1 | Controlados y recetas | D13, D32, D34, D36, D57, D58, D59, D60 | ¿La clasificación de venta, la receta archivada y el libro de controlados cumplen lo que exigen AGEMED y SEDES? |
| 2 | Ventas y caja (POS) | D14, D17, D18, D43, D44, D45, D46, D47, D49 | ¿Son correctas las reglas de pagos combinados, recibo no fiscal, anulaciones, devoluciones y cambio de lote fuera de FEFO? |
| 3 | Inventario | D37, D38 | ¿Quién aprueba un conteo físico y qué formato debe tener el acta de baja? |
| 4 | Compras y proveedores | D41 | ¿Un pago a proveedor en efectivo debe salir de la caja? ¿Hacen falta notas de crédito? |
| 5 | Clientes, puntos y convenios | D66, D67, D68, D69, D70, D71 | ¿Son correctos el valor del punto (1 punto cada 10 Bs, 1 punto = 0,10 Bs), los límites de convenio y el estado de cuenta mensual? |
| 6 | Personal y comisiones | D61, D62, D63, D64, D65 | ¿La comisión se calcula sobre la venta neta? ¿Qué significa «multinivel» para la farmacia? |
| 7 | Analítica | D72, D73, D74, D75, D76 | ¿Son útiles los cortes de la matriz ABC (80 % / 95 %) y el umbral de cobertura baja (7 días)? |

## Ronda 3: decisiones técnicas con el docente

Son elecciones de diseño ya implementadas y probadas. Se pueden aprobar en bloque; solo una corrección implica cambiar código.

| Tema | Decisiones | Qué se eligió (resumen) |
| --- | --- | --- |
| Facturación (base técnica) | D33, D50, D51, D52 | El sistema deja preparada la factura sin emitirla hasta tener SIAT; los códigos del SIN se guardan sin validar. Se cierran junto con D03. |
| Traspasos entre sucursales | D15, D53, D54, D55, D56 | Aprobación obligatoria solo en Premium, recepción parcial permitida, stock en tránsito calculado y permisos por rol. |
| API pública y webhooks | D77, D78, D79, D80 | Claves de solo lectura por sucursal, límite de 120 consultas por minuto, webhooks firmados con HMAC y hasta 8 reintentos. |
| Seguridad, privacidad y operación | D12, D20, D21 | Auditoría inmutable sin política de retención todavía, datos personales mínimos y métricas sin objetivos de carga. |
| Identidad visual | D19 | Nombre FARMAXIA confirmado; falta aprobar la identidad visual definitiva. |

## Cómo registrar las respuestas

Cada respuesta se anota en la fila de su decisión en `REGISTRO_DECISIONES.md`, como pide la regla de actualización de ese archivo.

1. Cambiar el estado a «Confirmada · fecha» o anotar la corrección pedida.
2. Escribir quién decidió y el motivo en una línea.
3. Si la regla cambia, crear una tarea para ajustar el código de los módulos afectados (columna «Tareas afectadas»).

Las decisiones tributarias, sanitarias y de pagos externos no se cierran con datos de prueba: necesitan datos reales firmados.
