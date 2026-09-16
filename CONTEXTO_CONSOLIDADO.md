# Contexto consolidado — PharmaCore Bolivia / FARMAXIA

Fecha de lectura: 11 de septiembre de 2026.
Estado SDD: EXPLORE documental. Este archivo reúne el contexto y las diferencias encontradas; no sustituye los documentos originales ni constituye una especificación aprobada para implementar.

**Continuidad al 12/09/2026, revisión 2:** esta exploración se desarrolló en el [plan de implementación para Antigravity](PLAN_IMPLEMENTACION_ANTIGRAVITY.md). El usuario confirmó D01: **el cajero elige entre factura digital y recibo no fiscal en cada venta, sin aprobación adicional**; ambas modalidades descuentan stock y registran cobros. La proforma permanece diferenciada como cotización/reserva. El plan incluye propuesta, especificaciones/diseño iniciales, tareas y otras decisiones pendientes; no se ha iniciado APPLY. Para retomar el trabajo, consultar también el [prompt de inicio](PROMPT_INICIO_ANTIGRAVITY.md). El resto de este archivo conserva los hallazgos de la lectura inicial.

## 1. Intención del proyecto y fuentes

El usuario quiere construir un sistema SaaS multisucursal para farmacias tomando en cuenta todo lo previsto en estos tres documentos:

| Fuente | Función dentro del contexto |
| --- | --- |
| [PharmaCore_Bolivia_Master_Specification.md](PharmaCore_Bolivia_Master_Specification.md) | Documento técnico más desarrollado: módulos, planes, DBML, ejemplos SIAT/FEFO/guard y roadmap de cinco sprints. |
| [Plan_SaaS_Farmacia_Bolivia.md](Plan_SaaS_Farmacia_Bolivia.md) | Visión estratégica, detalle operativo de 13 módulos, planes y alternativas tecnológicas. |
| [Prompt_Agente_Codigo_PharmaSaaS.md](Prompt_Agente_Codigo_PharmaSaaS.md) | Instrucciones de referencia para un futuro agente constructor y entregables técnicos iniciales. |

Los archivos reales están directamente en `C:\PROYECTOS\FARMAXIA`, con guiones bajos en sus nombres. Las rutas inicialmente pegadas con subcarpetas no existen. Al comenzar esta exploración, FARMAXIA contenía únicamente esos tres MD. La tarea está abierta desde SISA, pero estos requisitos pertenecen a FARMAXIA.

Los textos que dicen «implementa» o «empieza proporcionando el esquema» dentro de los prompts son parte del material leído. La solicitud de esta sesión es asimilar y conservar el contexto.

No se establece una precedencia definitiva entre documentos: Master sirve como índice técnico por su amplitud, y las discrepancias se conservan explícitamente.

## 2. Producto y estructura organizativa

Nombre de trabajo en los documentos: **PharmaCore Bolivia**. Carpeta de trabajo documental: **FARMAXIA**. Falta confirmar si el nombre comercial final será alguno de ellos.

Mercado previsto: farmacias independientes, cadenas de farmacias, boticas y droguerías en Bolivia.

La estructura funcional que resulta de los documentos es:

```text
Plataforma SaaS
└── Cliente / tenant: farmacia o cadena
    ├── Suscripción, plan, funciones y cuotas
    ├── Usuarios con roles y acceso autorizado
    ├── Catálogo farmacéutico del cliente
    └── Sucursales
        ├── Almacenes y existencias por lote
        └── Cajas / puntos de venta y turnos
```

Dos sucursales de una misma cadena pertenecen al mismo tenant. Dos clientes independientes deben mantener sus datos aislados. El acceso dentro del tenant también requiere permisos por sucursal y caja.

Los documentos contemplan roles de administrador, regente farmacéutico, encargado de sucursal, cajero/dispensador, almacenero y auditor, además de roles personalizados. La administración del proveedor del SaaS y sus accesos de soporte todavía necesitan una definición detallada.

## 3. Alcance funcional completo recogido

| Módulo | Funciones previstas |
| --- | --- |
| 0. Core SaaS | Registro y onboarding de farmacias, tenants, planes, suscripciones, cuotas, módulos habilitados, pagos recurrentes por QR/pasarela/transferencia, facturación del servicio y auditoría. |
| 1. Seguridad, usuarios y roles | Autenticación, 2FA opcional, sesiones activas, roles predeterminados y personalizados, permisos y asignación a sucursales/cajas. |
| 2. Catálogo farmacéutico | Nombre comercial y genérico/DCI, principio activo, concentración, forma farmacéutica, laboratorio/marca, clasificación de venta, registro sanitario, refrigeración, homologación SIN y presentaciones con factores de conversión. |
| 3. Inventario, lotes y almacenes | Almacenes por sucursal, central, cuarentena y frío; lotes, fabricación y vencimiento; FEFO; alertas de caducidad; mermas/bajas con acta; inventario físico y conteo ciego. |
| 4. Compras y cuentas por pagar | Proveedores y NIT, órdenes de compra y reposición sugerida, recepción contrastada con factura y lotes, costo promedio ponderado/última compra, deudas y programación de pagos. |
| 5. POS y dispensación | Venta rápida con teclado o pantalla táctil, búsqueda por nombre/principio activo/laboratorio/código, EAN-13/DataMatrix, selección FEFO con cambio autorizado, caja/blíster/unidad, efectivo/tarjeta/QR/crédito/convenio, apertura/arqueo/cierre y diferencias de caja. |
| 6. Facturación SIAT | Modalidades electrónica y computarizada, catálogos SIN, CUFD/CUF, XML y SOAP, datos fiscales del comprador, impresión térmica o A4/Carta con QR, envío por correo, contingencias, sincronización diferida y anulaciones. |
| 7. Traspasos y logística | Reposición desde almacén central u otra sucursal, solicitud, despacho en tránsito, recepción conforme, diferencias y daños durante el traslado. |
| 8. Controlados y regencia | Datos de receta, médico/matrícula, paciente/documento y centro emisor; archivo o retención de receta; registro de movimientos y balances mensuales; libro digital/exportable previsto para fiscalización. |
| 9. Personal, turnos y comisiones | Guardias, turnos de trabajo, incentivos/comisiones por ventas o productos y productividad por dispensador. |
| 10. Clientes, fidelización y convenios | Directorio e historial de compras, puntos, aseguradoras/empresas/sindicatos, crédito por empleado, copagos y facturación centralizada. |
| 11. Analítica | Matriz ABC, rotación, quiebres de stock, días de inventario, margen/rentabilidad por producto/laboratorio/sucursal y tablero ejecutivo; las matrices comerciales también mencionan analítica predictiva. |
| 12. API e integraciones | API REST/GraphQL por decidir, e-commerce, delivery, aplicaciones externas, stock omnicanal y webhooks. |

Fuentes principales: Plan, líneas 45–131; Master, líneas 60–95. El detalle de un módulo no implica que ya exista un esquema de datos o diseño ejecutable para él.

## 4. Reglas técnicas y operativas centrales

1. **Aislamiento de clientes.** PostgreSQL con esquema compartido y `tenant_id` en las tablas de negocio es la dirección más consistente entre los documentos. El plan estratégico menciona schema-per-tenant como alternativa según volumen. El aislamiento se plantea mediante ORM y/o RLS; falta cerrar la elección y su cobertura.
2. **Identidad del tenant.** Subdominio o contexto autenticado/JWT. Master exige verificar `X-Tenant-ID` contra el token. El identificador enviado por el cliente no basta por sí mismo para autorizar acceso.
3. **Suscripciones.** El backend comprueba características contratadas, cuotas y estado de suscripción; no basta con ocultar opciones en la interfaz. El prompt prevé `PLAN_FEATURE_RESTRICTED` con HTTP 403.
4. **Unidad mínima.** El stock se conserva en la menor unidad indivisible. Caja y blíster se convierten mediante factores. Ejemplo documental: 1 caja = 10 blísteres = 100 comprimidos.
5. **Trazabilidad.** Los movimientos de medicamentos deben conservar lote y vencimiento, incluso cuando se fraccionan. La venta debe poder identificar los lotes consumidos.
6. **FEFO.** Priorizar lotes con vencimiento más próximo y stock disponible. Los ejemplos contemplan bloquear stock durante la transacción; las reglas de exclusión, fechas y cambios autorizados requieren especificación completa.
7. **Concurrencia.** Venta, merma y traspaso requieren consistencia transaccional para evitar doble descuento o sobreventa. Los ejemplos usan `SELECT ... FOR UPDATE`.
8. **Ventas y emisión fiscal.** Desacoplar la venta de la integración SIAT para gestionar respuestas externas, contingencias y sincronización. Debe detallarse cómo conservar consistencia e impedir duplicados.
9. **Controlados.** Los documentos exigen respaldar la dispensación con datos de receta, prescriptor y paciente. La matriz comercial distingue niveles de asistencia y libro digital, pero aún debe conciliarse con las reglas operativas aplicables.
10. **Auditoría.** Se pide una bitácora inmutable, mientras los planes proponen retenciones distintas. Falta distinguir retención operativa, fiscal, sanitaria y visibilidad comercial.

Estas son reglas del proyecto extraídas de las fuentes; no son una validación externa de cumplimiento normativo.

## 5. Planes comerciales previstos

| Capacidad | Básico / Esencial | Profesional / Crecimiento | Premium / Enterprise |
| --- | --- | --- | --- |
| Sucursales | 1 | Hasta 3 | Ilimitadas |
| Cajas | 1 | Hasta 4 | Ilimitadas |
| Usuarios según matrices | Hasta 2 simultáneos | Hasta 8 | Ilimitados |
| Base operativa | Catálogo, fraccionamiento, FEFO, compras, POS, alertas y reportes básicos | Incluye base operativa | Incluye Profesional |
| SIAT | Add-on en matrices; restringido en prompt | Incluido | Incluido; la matriz destaca contingencia |
| Traspasos | No | Sí | Sí, con aprobación |
| Controlados | Registro manual | Validación asistida | Libro digital completo |
| Personal y CRM | Registro de clientes | Turnos, comisiones, puntos y convenios básicos | Comisiones multinivel y convenios avanzados |
| Analítica/API | Reportes básicos | Reportes de rentabilidad/stock | ABC/predictiva y API/integraciones |
| Retención de auditoría propuesta | 7 días | 30 días | Ilimitada |

La tabla conserva el planteamiento de las fuentes, incluyendo sus diferencias. No se han fijado precios, periodicidad de cobro ni reglas completas de pruebas, impagos, cambio de plan o exceso de cuota.

## 6. Tecnología propuesta y decisiones abiertas

| Área | Lo que proponen los MD | Estado |
| --- | --- | --- |
| Backend | NestJS/TypeScript o FastAPI/Python; el plan también considera Go; módulos desacoplados y DDD | No seleccionado definitivamente. |
| Base de datos | PostgreSQL, `tenant_id`, índices y RLS/ORM; JSONB para algunos datos | Dirección compartida; diseño e invariantes pendientes. |
| Frontend | Angular o Vue.js con Quasar/Vite | No seleccionado definitivamente. |
| POS sin conexión | IndexedDB en frontend | Se menciona, pero no existe protocolo completo de operación/sincronización. |
| SIAT | Servicio desacoplado; el plan propone microservicio Go/Java/Python | Límite del servicio y lenguaje pendientes. |
| Colas/cache | Redis; el plan añade RabbitMQ o Kafka | Tecnología final y garantías de durabilidad/reintento pendientes. |
| Infraestructura | Docker; Kubernetes o Docker Swarm; VPS/cloud y backups cifrados | Propuestas, no decisiones de despliegue cerradas. |

No se adopta aquí el stack de SISA ni de otros proyectos por proximidad de carpetas.

## 7. Material técnico existente y cobertura real

Master contiene un DBML de **17 tablas**: `tenants`, `subscription_plans`, `subscriptions`, `branches`, `warehouses`, `users`, `products`, `product_presentations`, `batches`, `inventory_stocks`, `cash_registers`, `cash_shifts`, `sales`, `sale_items`, `controlled_drug_records`, `siat_daily_codes` y `siat_invoices`.

Incluye también un diagrama de emisión fiscal, un ejemplo de generación de CUF, un procedimiento de contingencia, un servicio FEFO ilustrativo y un guard de suscripción. Son material inicial de diseño, no código probado ni una implementación terminada.

Aunque el apartado se llama «esquema completo», no representa todos los módulos prometidos. Faltan modelos explícitos para compras/proveedores/cuentas por pagar, traspasos, movimientos de inventario/kardex, auditoría, roles y permisos granulares, comisiones, CRM/convenios y otras funciones posteriores.

Hallazgos técnicos de la lectura de Master que deberán tratarse durante SPEC + DESIGN:

- La consulta de presentación del ejemplo FEFO comprueba tenant e ID, pero no su correspondencia con `item.productId`; no muestra validación positiva/entera de la cantidad solicitada.
- FEFO devuelve asignaciones a varios lotes. `sale_items` contiene un solo `batch_id`; falta decidir cómo representar una línea comercial consumida desde varios lotes sin perder el fraccionamiento.
- El guard declara cuotas de sucursales, usuarios y cajas, pero su ejemplo solo implementa la comprobación de sucursales. Contar y crear por separado tampoco resuelve la creación concurrente.
- No se define cómo representar cuotas ilimitadas.
- Las relaciones por UUID y el `tenant_id` repetido no incluyen restricciones compuestas ni políticas concretas que impidan relacionar registros de tenants diferentes.
- `users` tiene una sola sucursal opcional; falta representar y autorizar usuarios con acceso a varias sucursales o a la administración central.
- El servicio FEFO recibe un `QueryRunner`, pero no define por sí solo el inicio, confirmación y reversión de la transacción completa de venta, stock y pagos.
- Los valores monetarios almacenados como decimales se convierten a `Number` en el ejemplo; precisión y redondeo deben especificarse.

Referencias: Master, líneas 109–372, 517–600 y 620–664.

## 8. Diferencias y decisiones que deben conservarse

| Tema | Diferencia o vacío detectado | Resolución pendiente |
| --- | --- | --- |
| SIAT en Básico | Prompt 16/29 restringe; Plan 168 y Master 87 permiten add-on. | Definir la matriz comercial final y cómo se habilitan add-ons. |
| Contingencias | Requisito general del módulo SIAT, pero la matriz las destaca en Premium. | Definir cobertura por plan y su relación con los requisitos fiscales aplicables. |
| Límites de usuarios/cajas | Las matrices hablan de simultaneidad; las reglas técnicas cuentan recursos registrados. | Separar usuarios registrados, sesiones concurrentes, cajas registradas y cajas activas. |
| Estados de suscripción | Plan: `active`, `grace_period`, `suspended`; narrativa Master: `active`, `trialing`, `past_due`, `suspended`; DBML añade `canceled` y omite `suspended`; guard solo permite `active`/`trialing`. | Definir máquina de estados, transiciones y operaciones permitidas. |
| Aislamiento | ORM o RLS; el plan también propone alternativa por esquema. | Elegir estrategia y cubrir relaciones, tareas en segundo plano y almacenamiento de archivos. |
| Stock y Redis | Plan menciona bloqueos Redis; prompt y Master desarrollan bloqueo transaccional en DB. | Definir responsabilidad de cada componente y fuente autoritativa del stock. |
| Operación offline | IndexedDB en POS y contingencia SIAT aparecen como propuestas separadas. | Distinguir caída del SIN, caída de internet en sucursal e indisponibilidad del propio SaaS; definir sincronización y conflictos. |
| Auditoría | Se pide inmutabilidad y se comercializan retenciones de 7/30 días/ilimitada. | Definir clases de registros y política de conservación antes de implementar eliminación. |
| Libro y recetas | Se mezclan «oficial», digital, exportable y niveles comerciales. | Verificar formatos y requisitos aplicables antes de afirmar aceptación oficial. |
| Stack | Se ofrecen varios frameworks, brokers y modelos de despliegue. | Selección explícita con diseño técnico, sin inferirla del ejemplo de código. |
| Costeo | Compras promete costo promedio; el ejemplo FEFO calcula costo a partir de precios de cada lote. | Separar política de salida física FEFO de la política contable de valoración. |
| Devoluciones y correcciones | Hay anulaciones fiscales, pero el circuito integral venta/pago/lote/caja/devolución no está desarrollado. | Completar escenarios y criterios verificables. |
| Cobertura del roadmap | 13 módulos, pero cinco sprints solo desglosan una parte. | Mantener el backlog completo y definir cortes de entrega. |
| Orden de implementación | El prompt incrustado pide FEFO en la fase inmediata; el roadmap lo ubica en Sprint 2. | Unificar el orden del backlog según dependencias. |

## 9. Roadmap que ya está planteado

El documento Master propone esta secuencia, todavía sin duración, estimación ni criterios completos de aceptación:

1. **Núcleo:** backend, PostgreSQL/Redis, tenants, planes, sucursales, almacenes, usuarios, contexto del tenant, guard, autenticación y RBAC.
2. **Catálogo e inventario:** productos, presentaciones, lotes, stock, FEFO transaccional y alertas de vencimiento.
3. **POS y caja:** apertura/arqueo/cierre, venta transaccional, recetas para controlados e impresión térmica.
4. **SIAT:** ambiente de pruebas, SOAP, CUFD, CUF, XML y contingencias.
5. **Operación avanzada:** traspasos, libro de controlados, comisiones y matriz ABC.

Referencia: Master, líneas 673–707. La estructura multisucursal aparece desde el núcleo; el flujo operativo de traspasos se desarrolla después. No hay un MVP formal con límites y criterios de aceptación; no debe asumirse que cinco sprints cubren todo el alcance comercial.

## 10. Estado de esta exploración y continuidad

Se leyeron y cruzaron las tres fuentes y se conservó el contexto en Engram bajo el proyecto `farmaxia`. Este archivo es el resultado documental de EXPLORE. No se modificaron los originales ni se generó código de producción.

La revisión fue documental. Las afirmaciones sobre normativa, plazos, CUF, procedimientos SIAT y aceptación del libro digital no se comprobaron todavía contra fuentes oficiales vigentes; deben verificarse al especificar esos módulos. En particular, no asumir como validado el plazo de 48 horas mencionado en Master.

El siguiente paso del ciclo SDD es PROPOSE: delimitar una primera entrega verificable y conservar los demás módulos en el alcance global. Después corresponden SPEC + DESIGN, TASKS, APPLY, VERIFY independiente y ARCHIVE. Las diferencias señaladas deben resolverse antes de codificar los comportamientos afectados.
