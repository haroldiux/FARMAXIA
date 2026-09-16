# PROMPT TÉCNICO PARA AGENTE DE CÓDIGO (AI TECH LEAD & DEVELOPER)

Copia y pega íntegramente el siguiente bloque de texto en tu agente de código (Claude Code, Cursor, Copilot, Antigravity, OpenCode u otro asistente de programación):

```markdown
Actúa como un Arquitecto de Software Senior y Tech Lead Full-Stack especializado en sistemas SaaS multi-tenant para el sector salud y retail en Bolivia.

Vamos a construir un sistema SaaS denominado "PharmaCore Bolivia", diseñado para la gestión integral de farmacias, cadenas de boticas y droguerías en el mercado boliviano.

### 1. OBJETIVO DEL SISTEMA
El software debe permitir operar farmacias bajo normativas estrictas de Bolivia:
1. Normativa Sanitaria (AGEMED): Trazabilidad total de Lotes, Vencimientos bajo política FEFO (First Expired, First Out), fraccionamiento de fármacos (Caja -> Blíster -> Unidad) y control de medicamentos psicotrópicos con recetas archivadas.
2. Normativa Tributaria (SIN - Servicio de Impuestos Nacionales): Facturación en Línea (Modalidades Electrónica en Línea y Computarizada en Línea), gestión de CUFD, generación de CUF, homologación de catálogos SIN y manejo de contingencias offline.
3. Arquitectura SaaS Modular por Niveles (Tiers):
   - BASIC (Mono-sucursal, POS rápido, inventario FEFO, compras, recibos).
   - PROFESSIONAL (Multi-sucursal hasta 3, Facturación SIAT SIN, traspasos, turnos de caja, control de recetas, comisiones).
   - PREMIUM / ENTERPRISE (Sucursales ilimitadas, Libro digital oficial AGEMED, Analítica Matriz ABC, convenios empresariales, API pública).

---

### 2. REGLAS DE ARQUITECTURA TÉCNICA
1. Multi-Tenancy Aislado:
   - Estrategia: Base de datos compartida con columna `tenant_id` en todas las tablas de negocio.
   - Seguridad: El contexto del tenant debe extraerse del JWT o subdominio y aplicarse de forma transparente en cada consulta (ORM middleware o Row-Level Security en PostgreSQL).
   - En ninguna circunstancia un tenant puede ver o modificar datos de otro.

2. Feature Flags y Cuotas de Suscripción (Subscription Guard):
   - Crea un decorador/middleware (`@RequireFeature('FEATURE_NAME')` y `@CheckQuota('RESOURCE_NAME')`).
   - Si un tenant en el plan BASIC intenta crear una 2da sucursal o emitir factura SIAT, el backend debe responder con un error `403 Forbidden - PLAN_FEATURE_RESTRICTED` con detalles para actualización de plan.

3. Manejo de Stock y Concurrencia:
   - Toda transacción de stock (venta, merma, traspaso) debe manejar transacciones de base de datos con aislamiento estricto (o SELECT ... FOR UPDATE) para evitar condiciones de carrera en ventas simultáneas de un mismo lote.
   - El inventario físico se maneja en la unidad mínima indivisible. Toda presentación (caja, blíster) calcula su stock multiplicando por su factor de conversión.

4. Facturación SIAT Bolivia:
   - Desacopla la lógica de facturación mediante un patrón Strategy o Event-Driven, permitiendo que la venta se guarde localmente y la emisión SIAT proceda de manera síncrona o asíncrona (contingencia).

---

### 3. FASE 1: ENTREGABLES REQUERIDOS
Por favor genera la base arquitectural del proyecto con el siguiente nivel de detalle:

1. ESQUEMA DE BASE DE DATOS (DBML o SQL para PostgreSQL):
   - `tenants`, `subscriptions`, `plans`, `features`.
   - `branches` (sucursales), `warehouses` (almacenes), `users`, `roles`, `permissions`.
   - `products`, `product_presentations` (fraccionamiento), `batches` (lotes y vencimiento), `inventory_stocks`.
   - `sales`, `sale_items`, `cash_registers` (cajas), `cash_shifts` (turnos).
   - `controlled_drug_records` (registro de receta médica AGEMED).
   - `siat_invoices`, `siat_cufd`, `sin_catalog_mappings`.

2. IMPLEMENTACIÓN DEL GUARD DE SUSCRIPCIONES:
   - Modelo de datos de suscripción y límites (`max_branches`, `max_cash_registers`, `features_list`).
   - Middleware o decorador en código backend (ejemplo en NestJS / TypeScript o FastAPI / Python) que intercepte peticiones y verifique permisos de suscripción y límites de cuota antes de ejecutar la acción.

3. SERVICIO DE DISPENSACIÓN POS CON ALGORITMO FEFO:
   - Código del servicio de venta que reciba un carrito con medicamentos y cantidades, seleccione automáticamente los lotes más próximos a vencer (`batches` ordenados por `expiration_date ASC` con `stock > 0`), reserve/descuente el stock en la menor unidad y registre la trazabilidad en `sale_items`.
   - Manejo de excepción cuando el stock de los lotes no cubra la cantidad solicitada.

4. FLUJO DE FACTURACIÓN SIAT:
   - Estructura del payload para generación de factura y cálculo del Código Único de Factura (CUF) según especificación del SIN de Bolivia.

Empieza proporcionando el esquema de base de datos completo y la arquitectura de verificación de suscripciones.
```
