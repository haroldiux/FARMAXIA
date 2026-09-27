# FARMAXIA — Estado de funcionalidades

**Fecha de revisión:** 25 de septiembre de 2026 · actualizado el 27 de septiembre de 2026 (módulos 0 y 1 completados)
**Rama revisada:** `Denil` (commit `240f272`, basado en `main` `38709c8`); módulos 0 y 1 en la rama `denil-core-saas`
**Autor:** Denilson Godoy

## 1. Propósito de este documento

Comparar todas las funcionalidades previstas para el sistema con lo que ya está construido, para confirmar qué falta y en qué orden conviene completarlo.

## 2. Fuentes y método

**Alcance previsto** (qué debería tener el sistema):

- `PharmaCore_Bolivia_Master_Specification.md` — especificación maestra: 13 módulos, matriz de planes y roadmap de 5 sprints.
- `CONTEXTO_CONSOLIDADO.md` — consolida la especificación maestra con `Plan_SaaS_Farmacia_Bolivia.md` y agrega detalles (2FA, crédito, proformas, etc.).

**Estado real** (qué existe hoy), revisado directamente en el código:

- Tablas de base de datos creadas por las migraciones (`apps/api/drizzle/0000` a `0014`).
- Rutas de la API (`apps/api/src/*/*.controller.ts`).
- Pantallas de la web (`apps/web/app`).
- Pruebas automáticas: 71 de 71 pasan (`pnpm --filter @farmaxia/api test`).

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
| 2. Catálogo farmacéutico | 4 | 2 | 4 |
| 3. Inventario, lotes y almacenes | 6 | 2 | 3 |
| 4. Compras y proveedores | 3 | 2 | 4 |
| 5. Punto de venta y caja | 5 | 0 | 10 |
| 6. Facturación SIAT | 0 | 0 | 8 |
| 7. Traspasos entre sucursales | 0 | 0 | 5 |
| 8. Medicamentos controlados (AGEMED) | 0 | 0 | 4 |
| 9. Personal, turnos y comisiones | 0 | 0 | 3 |
| 10. Clientes, fidelización y convenios | 0 | 0 | 5 |
| 11. Analítica | 1 | 0 | 5 |
| 12. API e integraciones | 0 | 1 | 3 |
| **Total** | **41** | **7** | **54** |

**Avance aproximado: ~40%.** La base técnica (multi-empresa con aislamiento por RLS, permisos, auditoría inmutable, idempotencia, FEFO transaccional y pruebas) está completa y sólida. Lo que falta es principalmente funcionalidad de negocio y los módulos regulatorios.

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

- ✅ Productos con nombre comercial y principio activo
- ✅ Listas de precios con vigencias, sin superposición y con prioridad de la sucursal sobre la global
- ✅ Códigos de barras: registro y búsqueda
- ✅ Búsqueda por nombre o principio activo
- 🟡 Presentaciones con factor de conversión (caja / blíster / unidad): la API las crea, la web no
- 🟡 Categorías y tabla de homologación: existen en la API, sin pantalla
- ❌ Ficha sanitaria: concentración, forma farmacéutica, laboratorio, registro sanitario, clasificación de venta
- ❌ Marcas de medicamento controlado y de cadena de frío
- ❌ Códigos del SIN (homologación tributaria)
- ❌ Editar y desactivar productos

### 3. Inventario, lotes y almacenes

- ✅ Lotes con fecha de vencimiento; stock guardado en la unidad mínima
- ✅ Motor FEFO transaccional (primero vence, primero sale) con bloqueo de filas
- ✅ Alertas de vencimiento a 7 / 30 / 90 días
- ✅ Cuarentena, liberación y registro de incidencias de cadena de frío
- ✅ Mermas y bajas con motivo, auditadas
- ✅ Reporte global de existencias (físico, reservado y disponible) de todas las sucursales
- 🟡 Inventario físico / conteo ciego (conciliación): la API existe, sin pantalla
- 🟡 Reservas de stock (FEFO): la API existe, sin pantalla
- ❌ Alta y configuración de almacenes (central, cuarentena, frío)
- ❌ Acta de baja imprimible
- ❌ Alertas automáticas programadas

### 4. Compras y proveedores

- ✅ Registro de proveedores con NIT
- ✅ Órdenes de compra
- ✅ Recepción por lote, sin superar lo ordenado (recepciones parciales)
- 🟡 Facturas de proveedor y cuentas por pagar: se registra la deuda inicial, pero no hay pagos
- 🟡 Órdenes con varios productos: la API lo permite, la pantalla solo admite uno por orden
- ❌ Pagos a proveedores y programación de pagos
- ❌ Costo promedio ponderado (decisión D08 pendiente)
- ❌ Reposición sugerida según el stock
- ❌ Cancelación de órdenes de compra

### 5. Punto de venta (POS) y caja

- ✅ Cajas y turnos con varias personas asignadas y sin superposición de horarios
- ✅ Apertura de turno con fondo inicial
- ✅ Conteo al cierre con cálculo de diferencia
- ✅ Aprobación de diferencias por un supervisor
- ✅ Venta en efectivo (no fiscal) que descuenta stock por FEFO
- ❌ Pagos con tarjeta, QR, crédito y convenio
- ❌ Búsqueda rápida y escaneo de código de barras en la venta
- ❌ Recibo e impresión térmica (58 / 80 mm)
- ❌ Proformas o cotizaciones
- ❌ Anulación de ventas y devoluciones
- ❌ Cambio de lote autorizado (saltar el FEFO con permiso)
- ❌ Movimientos menores de caja (ingresos y egresos de efectivo)
- ❌ Historial y consulta de ventas
- ❌ Exigir receta al vender medicamentos controlados (depende del módulo 8)
- ❌ Interfaz táctil y atajos de teclado

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
| 2 | Catálogo, fraccionamiento e inventario FEFO | 🟡 Falta la ficha sanitaria AGEMED y las alertas programadas |
| 3 | POS y control de turnos | 🟡 Falta receta en controlados, impresión térmica y otros medios de pago |
| 4 | Facturación SIAT | ❌ No iniciado |
| 5 | Traspasos, libro AGEMED, comisiones y matriz ABC | ❌ No iniciado |

## 6. Propuesta de orden para completar el sistema

| Fase | Contenido | Justificación |
|---|---|---|
| 1. Operación básica | POS completo (medios de pago, búsqueda y escaneo, recibo, anulaciones, historial), usuarios y roles, ficha sanitaria del producto | Sin esto el sistema no puede usarse en un mostrador real |
| 2. Completar lo parcial | Pantallas de presentaciones, categorías e inventario físico; pagos a proveedores; órdenes con varios productos; almacenes | Aprovecha la API existente: alto impacto con poco esfuerzo |
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
