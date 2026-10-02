# FARMAXIA — Estado de funcionalidades

**Fecha de revisión:** 25 de septiembre de 2026 · actualizado el 1 de octubre de 2026 (módulos 0 al 5 completados)
**Rama revisada:** `Denil` (commit `240f272`, basado en `main` `38709c8`); módulos 0 al 3 subidos a `Denil` y módulo 4 sin commit
**Autor:** Denilson Godoy

## 1. Propósito de este documento

Comparar todas las funcionalidades previstas para el sistema con lo que ya está construido, para confirmar qué falta y en qué orden conviene completarlo.

## 2. Fuentes y método

**Alcance previsto** (qué debería tener el sistema):

- `PharmaCore_Bolivia_Master_Specification.md` — especificación maestra: 13 módulos, matriz de planes y roadmap de 5 sprints.
- `CONTEXTO_CONSOLIDADO.md` — consolida la especificación maestra con `Plan_SaaS_Farmacia_Bolivia.md` y agrega detalles (2FA, crédito, proformas, etc.).

**Estado real** (qué existe hoy), revisado directamente en el código:

- Tablas de base de datos creadas por las migraciones (`apps/api/drizzle/0000` a `0025`).
- Rutas de la API (`apps/api/src/*/*.controller.ts`).
- Pantallas de la web (`apps/web/app`).
- Pruebas automáticas: 211 de 211 pasan en 28 archivos (`pnpm --filter @farmaxia/api test`, 1 de octubre de 2026).

**Leyenda:**

| Símbolo | Significado |
|:-:|---|
| ✅ | Implementado y funcionando (API y, cuando corresponde, pantalla) |
| 🟡 | A medias: existe en la API pero sin pantalla, o solo una parte |
| ❌ | No implementado |

## 3. Resumen

| Módulo | ✅ | 🟡 | ❌ |
|---|:-:|:-:|:-:|
| 0. Core SaaS | 13 | 0 | 0 |
| 1. Seguridad y roles | 9 | 0 | 0 |
| 2. Catálogo farmacéutico | 10 | 0 | 0 |
| 3. Inventario, lotes y almacenes | 11 | 0 | 0 |
| 4. Compras y proveedores | 9 | 0 | 0 |
| 5. Punto de venta y caja | 14 | 0 | 2 |
| 6. Facturación SIAT | 0 | 0 | 8 |
| 7. Traspasos entre sucursales | 0 | 0 | 5 |
| 8. Medicamentos controlados (AGEMED) | 0 | 0 | 4 |
| 9. Personal, turnos y comisiones | 0 | 0 | 3 |
| 10. Clientes, fidelización y convenios | 0 | 0 | 5 |
| 11. Analítica | 1 | 0 | 5 |
| 12. API e integraciones | 0 | 1 | 3 |
| **Total** | **67** | **1** | **35** |

**Avance aproximado: ~65%.** La base técnica (multi-empresa con aislamiento por RLS, permisos, auditoría inmutable, idempotencia, FEFO transaccional y pruebas) está completa y sólida. Lo que falta es principalmente funcionalidad de negocio y los módulos regulatorios.

> El porcentaje es orientativo: cuenta funcionalidades, no esfuerzo. Módulos como SIAT pesan mucho más que una pantalla.

## 4. Detalle por módulo

### 0. Core SaaS

- ✅ Multi-empresa (multi-tenant) con aislamiento de datos por Row Level Security en PostgreSQL
- ✅ Jerarquía empresa → razón social → sucursales → almacenes → cajas
- ✅ Estados de suscripción: prueba de 7 días, activa, vencida (3 días de gracia), suspendida y cancelada
- ✅ Bitácora de auditoría inmutable (no se puede modificar ni borrar)
- ✅ Idempotencia (evita operaciones duplicadas) y cola de eventos (outbox)
- ✅ Funcionalidades por plan aplicadas en la API: suscripción inactiva → 402, funcionalidad fuera del plan → 403. Los límites de sucursales, cajas y usuarios se aplican en el alta y al cambiar de plan; también se aplicarán al crear sucursales, cajas y usuarios cuando existan esas pantallas (módulo 1)
- ✅ Catálogo de 22 funcionalidades contratables y extras (add-ons) por farmacia, por ejemplo SIAT en el plan Básico
- ✅ Planes Básico / Profesional / Premium con sus límites; precio y visibilidad editables. "COMPLETO" queda como plan interno sin costo
- ✅ Registro público de farmacias (`/register`): crea farmacia, sucursal, almacén, caja y dueño, con 7 días de prueba e inicio de sesión automático
- ✅ Cobro recurrente: comprobante mensual automático, declaración de pago por QR o transferencia con comprobante adjunto, aprobación del operador, mora con 3 días de gracia y suspensión automática. Pasarela real pendiente de contrato (D25)
- ✅ Comprobantes de cobro numerados (`FX-000001`) e imprimibles; no fiscales hasta SIAT (D26)
- ✅ Panel de plataforma (`/platform`): resumen, farmacias, pagos por revisar, planes, cambios de plan, suspensión y reactivación
- ✅ Pantalla de auditoría (`/audit`) con la retención del plan (7 días / 30 días / todo)

### 1. Seguridad, usuarios y roles

- ✅ Inicio de sesión solo con correo y contraseña (Argon2id + JWT); la farmacia y la sucursal se eligen después si hay varias. Límite de 10 intentos cada 15 minutos
- ✅ Sesiones con renovación rotativa y cierre de sesión; cambio de sucursal sin volver a ingresar
- ✅ Permisos granulares verificados en el servidor; un usuario desactivado pierde los permisos al instante
- ✅ Acceso limitado a las sucursales asignadas a cada usuario
- ✅ Roles de cada farmacia con nombre y descripción; el antiguo "admin" pasó a Propietario
- ✅ Pantalla `/users` para crear usuarios, asignar roles y sucursales, desactivar, restablecer contraseña y quitar 2FA, respetando el límite de usuarios del plan
- ✅ Roles predefinidos: Propietario, Regente farmacéutico, Encargado de sucursal, Cajero y Almacenero
- ✅ Roles personalizados, sin escalada de permisos y con al menos un Propietario activo
- ✅ Verificación en dos pasos (TOTP con código QR) y gestión de sesiones activas en `/account` (Mi cuenta), más cambio de contraseña

### 2. Catálogo farmacéutico

- ✅ Productos con nombre comercial, genérico (DCI) y principio activo
- ✅ Listas de precios con vigencias, sin superposición y con prioridad de la sucursal sobre la global
- ✅ Códigos de barras: registro desde el detalle de cada presentación y búsqueda
- ✅ Búsqueda por nombre, genérico, principio activo, laboratorio o código de barras, con filtros por categoría, controlados, cadena de frío y desactivados
- ✅ Presentaciones con factor de conversión (caja / blíster / unidad): alta, renombrar, vender o no, desactivar. El factor no se edita (D35)
- ✅ Pantalla de categorías (`/catalog/categories`): alta, renombrar, marcar controlada y desactivar. La homologación con el SIN se cubre con los códigos SIN de la ficha
- ✅ Ficha sanitaria: concentración, forma farmacéutica, laboratorio, registro sanitario y clasificación de venta (lista provisional, D32)
- ✅ Marcas de medicamento controlado (por producto o categoría) y de cadena de frío con rango de temperatura. Aún no bloquean la venta (D34, módulo 8)
- ✅ Códigos del SIN (actividad, producto y unidad de medida) guardados en la ficha; se validarán con SIAT (D33)
- ✅ Editar la ficha con historial de cambios en Auditoría, y desactivar/reactivar productos sin perder su historial

### 3. Inventario, lotes y almacenes

- ✅ Lotes con fecha de vencimiento; stock guardado en la unidad mínima
- ✅ Motor FEFO transaccional (primero vence, primero sale) con bloqueo de filas
- ✅ Alertas de vencimiento a 7 / 30 / 90 días
- ✅ Cuarentena, liberación y registro de incidencias de cadena de frío
- ✅ Mermas y bajas con motivo y destino (destrucción, devolución, otro), auditadas
- ✅ Reporte global de existencias (físico, reservado y disponible) de todas las sucursales
- ✅ Inventario físico con conteo ciego (`/inventory/counts`): se cuenta sin ver el stock, se envía a revisión con diferencias y un responsable con permiso `inventory.count.approve` aprueba el ajuste (D37)
- ✅ Reservas de stock (FEFO): pantalla `/inventory/reservations` para verlas y liberarlas. La venta POS aún descuenta directo (D09)
- ✅ Alta y configuración de almacenes (`/inventory/warehouses`): general, central, cuarentena (nunca despacha) y cadena de frío; editar, quitar despacho y desactivar sin stock
- ✅ Acta de baja imprimible (`/inventory/waste-acts`): numeración `AB-<sucursal>-000001` por sucursal, datos de la farmacia, costo y firmas (formato provisional, D38)
- ✅ Alertas automáticas programadas: la API revisa vencimientos cada hora (30 días de anticipación), avisa en el resumen y en Inventario, y cierra la alerta cuando el lote ya no tiene stock

### 4. Compras y proveedores

- ✅ Registro de proveedores con NIT
- ✅ Órdenes de compra
- ✅ Recepción por lote, sin superar lo ordenado (recepciones parciales)
- ✅ Facturas de proveedor y cuentas por pagar con saldo, estado (pendiente, pago parcial, vencida, pagada) y pagos registrados
- ✅ Órdenes con varios productos desde la pantalla, con costo promedio sugerido, total estimado y avance de lo recibido por línea
- ✅ Pagos a proveedores (`/procurement/payables`): parciales o totales, sin pasarse del saldo, con método, referencia, historial y auditoría. Permiso nuevo «Registrar pagos a proveedores» (D41)
- ✅ Programación de pagos: agenda de vencidas, esta semana, próximos 30 días y más adelante, con fecha planificada por factura
- ✅ Costo promedio ponderado por presentación, recalculado en cada recepción y sugerido al armar órdenes (D40, pendiente de confirmar)
- ✅ Reposición sugerida (`/procurement/reorder`): según la venta de 30 días, el stock libre y lo ya pedido; crea la orden con un clic (D42)
- ✅ Cancelación de órdenes sin recepciones y cierre del saldo pendiente de las parciales, con motivo y auditoría

### 5. Punto de venta (POS) y caja

- ✅ Cajas y turnos con varias personas asignadas y sin superposición de horarios
- ✅ Apertura de turno con fondo inicial
- ✅ Conteo al cierre con cálculo de diferencia
- ✅ Aprobación de diferencias por un supervisor
- ✅ Venta (no fiscal) que descuenta stock por FEFO; el precio lo fija siempre el servidor según la lista de precios vigente y se rechaza la venta si no hay precio
- ✅ Pagos con efectivo, tarjeta y QR, combinables en una misma venta, con cálculo de vuelto. Tarjeta y QR se registran con número de referencia, sin pasarela (D43)
- ❌ Pagos a crédito y por convenio (dependen de clientes y convenios, módulo 10)
- ✅ Búsqueda rápida (nombre, genérico, principio activo, laboratorio o código de barras) con precio y stock disponible, y lector de código de barras que agrega el producto al carrito
- ✅ Recibo no fiscal imprimible en papel térmico de 58 / 80 mm desde el navegador, con número de venta `V-<sucursal>-000001` (D44)
- ✅ Proformas (`/sales/quotes`): numeradas `P-<sucursal>-000001`, válidas 7 días (1 a 30), imprimibles, sin apartar stock ni mover caja; se convierten en venta con el precio vigente (D48)
- ✅ Anulación de ventas (solo con el turno de la venta abierto: el stock vuelve a los mismos lotes y el efectivo sale de la caja) y devoluciones parciales o totales en cualquier fecha, con reembolso en efectivo, tarjeta o QR, numeradas `D-<sucursal>-000001` y con opción de reponer o no al stock. Permiso nuevo «Anular ventas y registrar devoluciones» (D46)
- ✅ Cambio de lote autorizado: quien tiene el permiso «Elegir lote distinto al FEFO» puede elegir otro lote disponible con un motivo obligatorio; queda en la auditoría y en el recibo (D47)
- ✅ Movimientos de caja (ingresos y egresos de efectivo) en turnos abiertos, con motivo y categoría, inmutables y auditados; ajustan el efectivo esperado al cierre. Un egreso no puede superar el efectivo esperado (D49)
- ✅ Historial de ventas (`/sales/history`) con filtros por fecha, turno, cajero y estado, y detalle de cada venta con lotes consumidos y pagos. El cajero ve solo sus ventas; Propietario, Regente y Encargado ven toda la sucursal (D45)
- ❌ Exigir receta al vender medicamentos controlados (depende del módulo 8)
- ✅ Pantalla de mostrador táctil y atajos de teclado (F2 buscar, F4 pago, F9 confirmar, Esc limpiar)

### 6. Facturación SIAT (Servicio de Impuestos Nacionales)

- ❌ Cliente SOAP hacia los ambientes de pruebas y producción del SIN
- ❌ Renovación diaria del CUFD
- ❌ Generación del CUF (Módulo 11, base 16)
- ❌ Armado y firma del XML de la factura
- ❌ Representación gráfica con QR (térmica y carta) y envío por correo
- ❌ Modo contingencia (fuera de línea) y sincronización diferida
- ❌ Anulación de facturas
- ❌ Sincronización de catálogos del SIN

> Requiere elementos externos al código: credenciales del SIN, certificado digital y asesoría tributaria (decisión D03).

### 7. Traspasos entre sucursales

- ❌ Solicitud de mercadería a otra sucursal o al almacén central
- ❌ Despacho (mercadería en tránsito)
- ❌ Recepción con verificación física
- ❌ Registro de diferencias y daños durante el traslado
- ❌ Flujo de aprobación (plan Premium)

### 8. Medicamentos controlados (AGEMED / regencia)

- ❌ Registro de receta: médico, matrícula, paciente, documento y centro emisor
- ❌ Archivo o retención de la receta
- ❌ Movimientos y balances mensuales de controlados
- ❌ Libro digital de psicotrópicos exportable para fiscalización

### 9. Personal, turnos y comisiones

- ❌ Guardias nocturnas y turnos de trabajo (distintos de los turnos de caja, que sí existen)
- ❌ Comisiones por venta o por producto (multinivel en Premium)
- ❌ Productividad por dispensador

### 10. Clientes, fidelización y convenios

- ❌ Directorio de clientes e historial de compras
- ❌ Puntos de fidelidad
- ❌ Convenios con aseguradoras, empresas y sindicatos
- ❌ Crédito por empleado y copagos
- ❌ Facturación centralizada de convenios

### 11. Analítica

- ✅ Reporte global de existencias
- ❌ Matriz ABC de rotación
- ❌ Rotación y días de inventario
- ❌ Quiebres de stock y alertas de desabastecimiento
- ❌ Margen y rentabilidad por producto, laboratorio y sucursal
- ❌ Tablero ejecutivo y analítica predictiva

### 12. API pública e integraciones

- 🟡 Cola interna de eventos (outbox), base para webhooks
- ❌ API pública para terceros
- ❌ Integración con e-commerce y apps de delivery
- ❌ Webhooks en tiempo real y stock omnicanal

## 5. Avance según el roadmap de la especificación maestra

| Sprint | Contenido | Estado |
|---|---|---|
| 1 | Núcleo, multi-tenancy, suscripciones, autenticación y RBAC | ✅ Casi completo (falta resolver la empresa por subdominio) |
| 2 | Catálogo, fraccionamiento e inventario FEFO | ✅ Completo (ficha sanitaria, almacenes, conteo físico, actas y alertas programadas); la lista oficial AGEMED queda en D32 y D36 |
| 3 | POS y control de turnos | ✅ Completo (pagos combinados, recibo térmico, anulaciones, devoluciones, proformas, movimientos de caja). Quedan crédito/convenio (módulo 10) y receta en controlados (módulo 8) |
| 4 | Facturación SIAT | ❌ No iniciado |
| 5 | Traspasos, libro AGEMED, comisiones y matriz ABC | ❌ No iniciado |

## 6. Propuesta de orden para completar el sistema

| Fase | Contenido | Justificación |
|---|---|---|
| 1. Operación básica ✅ | POS completo (medios de pago, búsqueda y escaneo, recibo, anulaciones, historial), usuarios y roles, ficha sanitaria del producto | Sin esto el sistema no puede usarse en un mostrador real |
| 2. Completar lo parcial ✅ | Pantallas de presentaciones, categorías e inventario físico; pagos a proveedores; órdenes con varios productos; almacenes | Aprovecha la API existente: alto impacto con poco esfuerzo |
| 3. Cumplimiento legal | Controlados (AGEMED) y facturación SIAT | Obligatorio para operar en Bolivia |
| 4. Multi-sucursal y planes | Traspasos; planes Básico / Profesional / Premium aplicados en el servidor | Necesario para cadenas de farmacias y para cobrar por plan |
| 5. Crecimiento | Clientes y convenios, comisiones, analítica, onboarding y cobro del SaaS | Valor agregado sobre una operación ya estable |
| 6. Integraciones | API pública, delivery y webhooks | Solo plan Premium |

## 7. Decisiones pendientes que bloquean funcionalidades

Tomadas de `REGISTRO_DECISIONES.md`:

| Decisión | Tema | Bloquea |
|---|---|---|
| D03 | Proveedor y datos para la facturación SIAT | Módulo 6 completo |
| D08 | Método de costeo (promedio ponderado o última compra) | Costeo en compras y márgenes en analítica |
| D09 | Reglas de reserva de stock en proformas y ventas | Proformas en el POS |
| D22 | Importación de catálogo y stock inicial | Puesta en marcha con datos reales |

## 8. Preguntas para validar

1. ¿Es correcto considerar la especificación maestra (`PharmaCore_Bolivia_Master_Specification.md`) como el alcance completo del proyecto, o hay funcionalidades que se deban quitar o agregar?
2. ¿El orden propuesto en la sección 6 es adecuado, o conviene priorizar el cumplimiento legal (AGEMED y SIAT) antes que completar el POS?
3. Para SIAT, ¿se debe integrar con el ambiente de pruebas del SIN o basta con simular la emisión?
4. ¿Qué criterio usar en D08 (costo promedio ponderado o costo de última compra)?
5. ¿Los módulos de Premium (analítica predictiva, API pública, delivery) forman parte del alcance esperado o quedan como trabajo futuro?
