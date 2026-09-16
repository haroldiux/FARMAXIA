# PLAN ESTRATÉGICO Y ESPECIFICACIÓN TÉCNICA: SAAS FARMACÉUTICO BOLIVIA
**Proyecto:** PharmaCore Bolivia (SaaS Multi-tenant)  
**Mercado Objetivo:** Farmacias independientes, cadenas de farmacias, boticas y droguerías en Bolivia.

---

## 1. CONTEXTO REGULATORIO Y NORMATIVO EN BOLIVIA

### 1.1. Regulación Sanitaria (AGEMED / Ministerio de Salud)
- **Trazabilidad y Control de Lotes:** Registro obligatorio de Número de Lote, Laboratorio Fabricante y Fecha de Vencimiento en cada ingreso y egreso de almacén.
- **Medicamentos Psicotrópicos y Estupefacientes (Lista I, II, III y IV):**
  - Venta obligatoria respaldada por Receta Médica Archivada o Receta Retenida.
  - Registro de datos del médico prescriptor (Nombre, Matrícula Profesional del Colegio Médico / M.S.D., Fecha de emisión).
  - Libro oficial de control de psicotrópicos foliado digitalmente (Ingresos, Egresos, Saldos y balances mensuales para fiscalización).
- **Fraccionamiento y Unidades de Venta:**
  - Venta en presentaciones completas (Caja) o fraccionadas (Blíster, Sobres, Ampollas o Comprimidos individuales) conservando trazabilidad de lote y fecha de vencimiento.
- **Cadena de Frío:** Registro de requerimiento de refrigeración (2°C - 8°C) y advertencias en el catálogo.

### 1.2. Regulación Tributaria (Servicio de Impuestos Nacionales - SIN)
- **Modalidades de Facturación en Línea (RND 102100000011 y actualizaciones):**
  - Facturación Electrónica en Línea (Firma Digital X.509) o Facturación Computarizada en Línea (Token/Hash del SIN).
  - Sincronización continua de Catálogos Oficiales del SIN (Actividades económicas, Códigos de productos SIN, Códigos de unidades de medida, Países, Tipos de documento: CI, NIT, CEX, Pasaporte, etc.).
  - Gestión del ciclo de vida del CUFD (Código Único de Facturación Diaria) y generación de CUF (Código Único de Factura).
  - Emisión de representación gráfica en rollo/térmica (80mm/58mm) o página completa (A4/Carta) con Código QR reglamentario y leyenda oficial tributaria.
  - **Manejo de Contingencias / Eventos Significativos:** Capacidad de operación offline ante corte de internet o caída del servidor del SIN (emisión con CAFC o en modalidad diferida) y paqueteo/envío masivo en el plazo reglamentario.

---

## 2. ARQUITECTURA DE SOFTWARE Y MULTI-TENANCY

### 2.1. Modelo Multi-tenant
- **Aislamiento a nivel de Base de Datos:**
  - Estrategia: *Shared Database, Shared Schema con Row-Level Security (RLS)* o *Schema-per-Tenant* según volumen. Para SaaS rentable en farmacias pequeñas/medianas, se utiliza columna discriminadora `tenant_id` indexada en todas las tablas con políticas automáticas en el ORM / RLS de PostgreSQL.
- **Identificación de Tenant:**
  - Vía subdominio (`farmaciabolivar.tusistema.com`) o cabecera HTTP (`X-Tenant-ID` / token JWT claims).

### 2.2. Capa de Feature Flags y Control de Cuotas (Plan Guard)
- Middleware centralizado que evalúa antes de cada acción:
  1. ¿El módulo está habilitado en el plan del tenant? (`has_feature('siat_online')`)
  2. ¿El tenant excede su límite de cuota? (`branch_count < max_branches`, `user_count < max_users`).
  3. Estado de la suscripción (`active`, `grace_period`, `suspended`).

---

## 3. DESGLOSE MODULAR DEL SISTEMA

### MÓDULO 0: Multi-tenancy & Suscripciones (Core SaaS)
- Registro, autoservicio y onboarding de farmacias.
- Gestión de planes, pagos recurrentes (QR Simple, pasarelas de pago, transferencia con comprobante) y facturación del SaaS.
- Bitácora de auditoría inmutable (Audit Trail) para trazabilidad legal.

### MÓDULO 1: Seguridad, Usuarios y Roles (RBAC)
- Autenticación multifactor (2FA opcional) y control de sesiones activas.
- Roles predeterminados y personalizados: Administrador General, Regente Farmacéutico, Encargado de Sucursal, Cajero/Dispensador, Almacenero, Auditor.
- Asignación estricta de usuarios a sucursales y cajas físicas.

### MÓDULO 2: Catálogo Farmacéutico & Productos
- Maestro de fármacos: Nombre comercial, Nombre genérico (DCI), Principio activo, Concentración, Forma farmacéutica (tableta, jarabe, ungüento, etc.), Laboratorio / Marca.
- Clasificación de venta: Venta Libre, Bajo Receta, Controlado (Psicotrópico/Estupefaciente), Cadena de Frío.
- Homologación con Códigos SIN (Actividad y Producto/Servicio SIN).
- Unidades de medida y jerarquía de fraccionamiento:
  - Factor de conversión (Ej: 1 Caja = 10 Blísters = 100 Comprimidos).
  - Stock base almacenado en la menor unidad divisible.

### MÓDULO 3: Inventario, Lotes y Almacenes
- Control Multi-almacén (por sucursal, almacén central, cuarentena, bodega de frío).
- Gestión de Lotes obligatoria: Código de lote, fecha de fabricación, fecha de caducidad, registro sanitario AGEMED.
- Algoritmo de despacho **FEFO (First Expired, First Out)** para priorizar medicamentos más próximos a vencer.
- Alertas tempranas de caducidad (configurables a 180, 90, 60 y 30 días).
- Bajas y mermas por rotura, daño o vencimiento (con acta de destrucción).
- Toma de inventario físico y conciliación periódica (conteo ciego).

### MÓDULO 4: Compras y Cuentas por Pagar (Proveedores)
- Directorio de proveedores (Laboratorios, Droguerías, Importadoras con NIT y datos de contacto).
- Órdenes de compra sugeridas por cálculo de punto de reposición / stock mínimo.
- Recepción de mercadería con verificación física contra factura comercial de proveedor y registro directo de lotes/vencimientos.
- Costeo: Manejo de Costo Promedio Ponderado (CPP) y Costo de Última Compra.
- Programación de pagos y control de deudas con droguerías/proveedores.

### MÓDULO 5: Punto de Venta (POS) y Dispensación
- Interfaz ultra rápida y adaptable a pantallas táctiles o teclado numérico directo.
- Búsqueda inteligente de medicamentos por: Nombre comercial, Principio activo, Laboratorio, o escáner de Código de Barras (EAN-13 / DataMatrix).
- Selector automático de lote (sugerencia FEFO) con opción de override autorizado.
- Dispensación por unidades, blísters o cajas con cálculo automático de precios.
- Modos de venta: Contado, Tarjeta, QR Simple interoperable Bolivia, Crédito / Convenio empresarial.
- Control de caja por turnos: Apertura, ingresos/egresos menores, arqueo ciego, cierre y conciliación de diferencias.

### MÓDULO 6: Facturación en Línea SIAT (SIN Bolivia)
- Integración completa con el Sistema de Facturación en Línea del SIN:
  - Sincronización diaria de CUFD.
  - Generación de CUF con algoritmo estándar tributario.
  - Validación de NIT/CI en línea contra el padrón nacional.
  - Generación de XML firmado (para modalidad electrónica) o empaquetado (para computarizada).
  - Comunicación con web services SOAP del SIN.
  - Emisión de facturas con código QR y envío automático por correo electrónico al cliente.
  - Módulo de Contingencias y Sincronización diferida ante caídas del SIN o internet.
  - Anulación de facturas según plazos tributarios vigentes.

### MÓDULO 7: Traspasos y Logística Interna (Multi-Sucursal)
- Solicitud de reabastecimiento de sucursal hacia almacén central u otra sucursal.
- Flujo de tres pasos: Solicitud -> Despacho en tránsito -> Recepción y conformidad.
- Control de diferencias o medicamentos dañados durante el transporte.

### MÓDULO 8: Medicamentos Controlados y Regencia Sanitaria (AGEMED)
- Validación forzada de datos de receta antes de autorizar la venta de un psicotrópico:
  - Matrícula del médico, Nombre del médico, Nombre del paciente, N° de cédula del paciente, Centro de salud emisor.
- Libro Oficial de Psicotrópicos digitalizado listo para imprimir o exportar en el formato exigido por las Jefaturas de Farmacias departamentales (SEDES / AGEMED).
- Balance mensual automático de sustancias controladas.

### MÓDULO 9: Recursos Humanos, Turnos y Comisiones
- Control de turnos de trabajo y guardias de farmacia (Farmacias de Turno nocturno).
- Esquema de incentivos y comisiones para dispensadores/vendedores (por volumen de venta o por medicamentos de marca propia/laboratorios estratégicos).
- Auditoría de productividad por dispensador.

### MÓDULO 10: Clientes, Fidelización y Convenios (CRM)
- Directorio de clientes con historial de compras de medicamentos frecuentes.
- Programa de acumulación de puntos por compras.
- Manejo de convenios corporativos (Aseguradoras, Empresas privadas, Sindicatos):
  - Límites de crédito por empleado.
  - Facturación centralizada al convenio o copago directo en caja.

### MÓDULO 11: Analítica de Negocio y Reportes Avanzados
- Clasificación de inventario mediante Matriz ABC (según valor y volumen de rotación).
- Reporte de quiebre de stock y días de inventario restante.
- Reporte de rentabilidad y margen bruto por línea farmacéutica, laboratorio o sucursal.
- Tablero ejecutivo en tiempo real para dueños de farmacia (ventas, cobranzas, alertas de vencimiento).

### MÓDULO 12: API Pública, Integraciones y E-Commerce
- API REST/GraphQL para conexión con tienda virtual de la farmacia o app móvil de delivery.
- Sincronización en tiempo real de stock para ventas omnicanal.
- Webhooks de notificación para eventos (factura emitida, stock crítico).

---

## 4. ESTRUCTURA DE PAQUETES Y MODELO DE SUSCRIPCIÓN (TIERS)

```
+---------------------------------------------------------------------------------------+
|                                    NIVELES SAAS                                       |
+-----------------------------------+-----------------------------------+---------------+
|       PLAN BÁSICO                 |         PLAN PROFESIONAL          |  PLAN PREMIUM |
|   "Farmacia Esencial"             |     "Crecimiento y Sucursales"    | "Corporativo" |
+-----------------------------------+-----------------------------------+---------------+
| • 1 Sucursal                      | • Hasta 3 Sucursales              | • Sucursales  |
| • 2 Usuarios simultáneos          | • Hasta 8 Usuarios                |   ilimitadas  |
| • 1 Punto de Venta (Caja)         | • Hasta 4 Cajas simultáneas       | • Usuarios    |
| • Catálogo y Fraccionamiento      | • Todo lo del Plan Básico         |   ilimitados  |
| • Lotes y Vencimientos (FEFO)     | • Facturación SIAT SIN Bolivia    | • Cajas ilim. |
| • Compras y Proveedores           | • Traspasos entre sucursales      | • Todo Pro    |
| • POS con control de caja         | • Control de turnos y guardias    | • Libro AGEMED|
| • Recibos / Notas de venta        | • Control de recetas psicotrópicas|   oficial dig.|
| • Alertas de vencimiento          | • Comisiones de venta al personal | • Analítica   |
| • Reportes básicos diarios        | • Fidelización (Puntos / Clientes)|   Matriz ABC  |
|                                   | • Reportes de rentabilidad y stock| • Convenios   |
|                                   | • Soporte prioritario             | • API / Apps  |
+-----------------------------------+-----------------------------------+---------------+
```

### Tabla Comparativa de Límites y Módulos

| Funcionalidad / Módulo | Plan Básico | Plan Profesional | Plan Premium / Corp |
|---|:---:|:---:|:---:|
| **Número de Sucursales** | 1 | Hasta 3 | Ilimitadas |
| **Cajas simultáneas** | 1 | Hasta 4 | Ilimitadas |
| **Inventario por Lotes y Vencimientos (FEFO)** | Sí | Sí | Sí |
| **Fraccionamiento (Caja, Blíster, Unidad)** | Sí | Sí | Sí |
| **Compras y Proveedores** | Sí | Sí | Sí |
| **Facturación SIAT Bolivia (SIN)** | Opcional (Add-on) | Sí (Incluido) | Sí (Incluido + Contingencias) |
| **Traspasos de mercadería** | No | Sí | Sí (Con flujo de aprobación) |
| **Control de Recetas Psicotrópicas** | Registro manual | Sí (Validación) | Sí (Libro AGEMED Completo) |
| **Manejo de Turnos y Guardias** | No | Sí | Sí |
| **Comisiones por ventas a empleados** | No | Sí | Sí (Multinivel) |
| **Fidelización / Puntos / Clientes** | Solo registro | Sí | Sí (Segmentado) |
| **Convenios Empresariales / Créditos** | No | Básico | Avanzado (Factura global) |
| **Matriz ABC y Analítica Predictiva** | No | No | Sí |
| **Acceso a API Pública / Integraciones** | No | No | Sí |
| **Auditoría completa (Audit Trail)** | Básica (7 días) | Media (30 días) | Ilimitada |

---

## 5. RECOMENDACIÓN DE STACK TECNOLÓGICO

- **Backend:** Node.js (NestJS / TypeScript) o Go o Python (FastAPI). Arquitectura modular desacoplada con Domain-Driven Design (DDD).
- **Base de Datos:** PostgreSQL con soporte de RLS (Row Level Security) y tipos JSONB para payloads del SIN.
- **Frontend Web (Backoffice & POS):** Angular o Vue.js (Quasar / Vite) con soporte para IndexedDB (operación offline en POS).
- **Servicio SIAT Bolivia:** Microservicio en Go, Java o Python para manejo de firmas digitales XML DSig, canonización y comunicación SOAP con los servidores del SIN.
- **Cache & Message Broker:** Redis (para bloqueo concurrente de stock en ventas simultáneas) y RabbitMQ / Kafka para colas de facturación y auditoría.
- **Despliegue e Infraestructura:** Docker, Kubernetes / Docker Swarm en VPS (Hetzner, AWS, DigitalOcean) con backups automáticos encriptados.
