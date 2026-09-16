# PHARMACORE BOLIVIA: MASTER ARCHITECTURE & IMPLEMENTATION SPECIFICATION
**Sistema SaaS Integral de Gestión Farmacéutica Multi-Tenant para Bolivia**  
*Documentación Técnica Unificada y Guía de Construcción para Agentes de Código y Equipos de Desarrollo*

---

## ÍNDICE GENERAL
1. [Contexto y Normativa en Bolivia (AGEMED y SIN SIAT)](#1-contexto-y-normativa-en-bolivia)
2. [Arquitectura SaaS y Multi-Tenancy](#2-arquitectura-saas-y-multi-tenancy)
3. [Estructura de Módulos y Matriz de Suscripción (Tiers)](#3-estructura-de-módulos-y-matriz-de-suscripción-tiers)
4. [Esquema Completo de Base de Datos (DBML)](#4-esquema-completo-de-base-de-datos-dbml)
5. [Especificación Técnica de Facturación SIAT SIN Bolivia](#5-especificación-técnica-de-facturación-siat-sin-bolivia)
6. [Algoritmo de Dispensación FEFO y Fraccionamiento](#6-algoritmo-de-dispensación-fefo-y-fraccionamiento)
7. [Subscription Guard y Feature Flags](#7-subscription-guard-y-feature-flags)
8. [Roadmap de Implementación y Tareas por Sprints](#8-roadmap-de-implementación-y-tareas-por-sprints)
9. [Prompt Maestro para Agentes de Código](#9-prompt-maestro-para-agentes-de-código)

---

## 1. CONTEXTO Y NORMATIVA EN BOLIVIA

### 1.1. Regulación Sanitaria (AGEMED / Ministerio de Salud)
- **Trazabilidad y Control Obligatorio de Lotes:** Todo ingreso y egreso de fármacos debe asociarse al número de lote del laboratorio fabricante y su fecha de vencimiento.
- **Medicamentos Controlados (Psicotrópicos y Estupefacientes - Listas I a IV):**
  - Venta obligatoriamente respaldada por Receta Médica Archivada o Receta Retenida.
  - Registro de datos del médico prescriptor (Nombre completo, Matrícula Profesional otorgada por el Ministerio de Salud / Colegio Médico, Cédula de Identidad y fecha de emisión).
  - Libro Oficial digitalizado de Psicotrópicos foliado (registro de ingresos, egresos, saldos actuales y balances mensuales requeridos por el SEDES / AGEMED).
- **Fraccionamiento de Unidades:**
  - Capacidad de venta en caja completa, blíster o comprimido/ampolla individual.
  - Todo fraccionamiento debe conservar la trazabilidad del lote y la fecha de caducidad.
- **Cadena de Frío:** Registro de requerimiento de refrigeración controlada (2°C a 8°C) con alertas visuales de manejo en inventario.

### 1.2. Regulación Tributaria (Servicio de Impuestos Nacionales - SIN)
- **Modalidades de Facturación en Línea (RND 102100000011 y anexos):**
  - Facturación Electrónica en Línea (con Firma Digital X.509) o Facturación Computarizada en Línea (con Token/Hash emitido por el SIN).
  - Sincronización continua de Catálogos Oficiales del SIN (Actividades económicas, Códigos de productos/servicios SIN, Unidades de medida, Tipos de documento de identidad: CI, NIT, CEX, Pasaporte, etc.).
  - Gestión del ciclo de vida del CUFD (Código Único de Facturación Diaria) diario por punto de venta.
  - Generación algorítmica del CUF (Código Único de Factura) con cálculo de dígito Módulo 11 y codificación Base 16.
  - Impresión de Representación Gráfica en rollo térmico (80mm / 58mm) o página completa (A4 / Carta) con Código QR normativo y leyenda oficial.
  - **Manejo de Eventos Significativos / Contingencia Offline:** Capacidad de emitir fuera de línea ante cortes de internet o indisponibilidad del servidor del SIN, empaquetamiento masivo y sincronización diferida en un plazo máximo de 48 horas.

---

## 2. ARQUITECTURA SAAS Y MULTI-TENANCY

### 2.1. Estrategia Multi-Tenant
- **Aislamiento a nivel de Datos:** Esquema compartido con discriminador `tenant_id` (UUIDv4) indexado en todas las tablas de negocio. Se aplican políticas automáticas en el ORM o PostgreSQL Row-Level Security (RLS) para garantizar que ninguna petición acceda a datos ajenos.
- **Resolución de Tenant:**
  - Vía subdominio: `{tenant}.pharmacore.bo`
  - Vía cabecera HTTP: `X-Tenant-ID` verificado contra el token JWT del usuario autenticado.

### 2.2. Capa de Control de Suscripción (Plan Guard)
- Middleware o Interceptor que evalúa en cada mutación de datos:
  1. ¿El tenant tiene activada la característica requerida? (`has_feature('siat_online')`)
  2. ¿El tenant supera el límite contratado? (`count(branches) < max_branches`, `count(users) < max_users`, `count(cash_registers) < max_cash_registers`).
  3. Estado de la suscripción: `active`, `trialing`, `past_due` o `suspended`.

---

## 3. ESTRUCTURA DE MÓDULOS Y MATRIZ DE SUSCRIPCIÓN (TIERS)

### 3.1. Catálogo de Módulos
1. **Core SaaS:** Gestión de tenants, suscripciones, facturación del SaaS y bitácora de auditoría inmutable.
2. **Seguridad y RBAC:** Roles (Admin, Regente Farmacéutico, Encargado, Cajero, Almacenero), permisos granulares y sesiones.
3. **Catálogo & Fraccionamiento:** Maestro de fármacos, presentaciones, principios activos, códigos SIN y factores de conversión.
4. **Inventario & Lotes (FEFO):** Multi-almacén, fechas de caducidad, semáforo de vencimiento, mermas y toma de inventario físico.
5. **Punto de Venta (POS):** Venta rápida por teclado/código de barras, modos de cobro (Efectivo, QR Simple, Tarjetas), arqueo ciego de caja por turnos.
6. **Compras & Proveedores:** Órdenes de reposición, costeo promedio, cuentas por pagar a droguerías y recepción de lotes.
7. **Facturación SIAT SIN:** Emisión de facturas electrónicas/computarizadas, CUFD, CUF, contingencia offline y sincronización diferida.
8. **Traspasos Logísticos:** Solicitud, despacho en tránsito y recepción conforme entre sucursales y almacenes.
9. **Medicamentos Controlados (AGEMED):** Registro obligatorio de recetas archivadas y generación del Libro Digital de Psicotrópicos.
10. **Turnos y Comisiones:** Control de guardias nocturnas, cálculo de comisiones de venta para dispensadores y productividad.
11. **Fidelización & Convenios (CRM):** Historial por paciente, puntos acumulados, convenios con aseguradoras y cuentas corrientes corporativas.
12. **Analítica & Matriz ABC:** Clasificación de rotación ABC, rotación de stock, márgenes de ganancia y alertas de desabastecimiento.
13. **API Pública & Delivery:** Integración con e-commerce, apps de delivery externas y webhooks en tiempo real.

### 3.2. Matriz Comparativa de Planes (Tiers)

| Capacidad / Módulo | Plan BÁSICO ("Esencial") | Plan PROFESIONAL ("Crecimiento") | Plan PREMIUM ("Enterprise") |
| :--- | :---: | :---: | :---: |
| **Sucursales permitidas** | 1 sucursal fija | Hasta 3 sucursales | Ilimitadas |
| **Puntos de Venta (Cajas)** | 1 caja activa | Hasta 4 cajas simultáneas | Ilimitadas |
| **Usuarios simultáneos** | Hasta 2 usuarios | Hasta 8 usuarios | Ilimitados |
| **Inventario por Lotes y FEFO** | Sí | Sí | Sí |
| **Fraccionamiento (Caja/Blíster/Unidad)**| Sí | Sí | Sí |
| **Compras y Proveedores** | Sí | Sí | Sí |
| **Facturación SIAT SIN Bolivia** | Opcional (Add-on) | Sí (Incluido) | Sí (Incluido + Modo Contingencia) |
| **Traspasos entre sucursales** | No | Sí | Sí (Con flujo de aprobación) |
| **Control de Recetas Psicotrópicas** | Registro manual | Sí (Validación asistida) | Sí (Libro AGEMED Completo) |
| **Manejo de Turnos y Guardias** | No | Sí | Sí |
| **Comisiones de venta a personal** | No | Sí | Sí (Multinivel) |
| **Fidelización y Convenios** | Solo registro de cliente | Sí (Puntos y convenios básicos)| Sí (Convenios con copago/factura global) |
| **Analítica ABC y Predictiva** | No | No | Sí |
| **API Pública / Integraciones** | No | No | Sí |
| **Retención de Auditoría** | 7 días | 30 días | Histórico ilimitado |

---

## 4. ESQUEMA COMPLETO DE BASE DE DATOS (DBML)

A continuación se detalla la definición del modelo relacional en formato **DBML**, compatible con dbdocs.io, dbdiagram.io y compilable a sentencias DDL de PostgreSQL:

```dbml
Project PharmaCore_Bolivia {
  database_type: 'PostgreSQL'
  Note: 'Esquema relacional multi-tenant para farmacias con regulación boliviana (SIN SIAT y AGEMED)'
}

Table tenants {
  id uuid [pk, default: `gen_random_uuid()`]
  legal_name varchar(200) [not null]
  trade_name varchar(200) [not null]
  nit varchar(30) [unique, not null]
  subdomain varchar(60) [unique, not null]
  contact_email varchar(120) [not null]
  contact_phone varchar(30)
  status varchar(20) [not null, default: 'active'] // active, suspended, canceled
  created_at timestamptz [default: `now()`]
  updated_at timestamptz [default: `now()`]
}

Table subscription_plans {
  id uuid [pk, default: `gen_random_uuid()`]
  code varchar(30) [unique, not null] // BASIC, PRO, ENTERPRISE
  name varchar(100) [not null]
  max_branches int [not null, default: 1]
  max_cash_registers int [not null, default: 1]
  max_users int [not null, default: 2]
  features_json jsonb [not null] // Lista de flags activos
  monthly_price numeric(12,2) [not null]
  annual_price numeric(12,2) [not null]
  is_active boolean [default: true]
}

Table subscriptions {
  id uuid [pk, default: `gen_random_uuid()`]
  tenant_id uuid [not null, ref: > tenants.id]
  plan_id uuid [not null, ref: > subscription_plans.id]
  status varchar(20) [not null, default: 'trialing'] // active, past_due, trialing, canceled
  current_period_start timestamptz [not null]
  current_period_end timestamptz [not null]
  cancel_at_period_end boolean [default: false]
  created_at timestamptz [default: `now()`]
}

Table branches {
  id uuid [pk, default: `gen_random_uuid()`]
  tenant_id uuid [not null, ref: > tenants.id]
  code varchar(20) [not null] // Ej: SUC-001
  sin_branch_code int [not null, default: 0] // 0 = Casa Matriz
  name varchar(150) [not null]
  address varchar(255) [not null]
  city varchar(100) [not null]
  phone varchar(30)
  is_active boolean [default: true]
  created_at timestamptz [default: `now()`]

  indexes {
    (tenant_id, code) [unique]
    (tenant_id, sin_branch_code) [unique]
  }
}

Table warehouses {
  id uuid [pk, default: `gen_random_uuid()`]
  tenant_id uuid [not null, ref: > tenants.id]
  branch_id uuid [not null, ref: > branches.id]
  name varchar(100) [not null]
  type varchar(30) [not null, default: 'dispensation'] // central, dispensation, quarantine
  is_active boolean [default: true]
}

Table users {
  id uuid [pk, default: `gen_random_uuid()`]
  tenant_id uuid [not null, ref: > tenants.id]
  branch_id uuid [ref: > branches.id]
  username varchar(50) [not null]
  email varchar(120) [not null]
  password_hash text [not null]
  full_name varchar(150) [not null]
  ci varchar(30) [not null]
  role varchar(30) [not null] // admin, pharmacist, cashier, inventory_manager
  is_active boolean [default: true]
  created_at timestamptz [default: `now()`]

  indexes {
    (tenant_id, username) [unique]
    (tenant_id, email) [unique]
  }
}

Table products {
  id uuid [pk, default: `gen_random_uuid()`]
  tenant_id uuid [not null, ref: > tenants.id]
  commercial_name varchar(200) [not null]
  generic_name varchar(200)
  active_ingredient text
  concentration varchar(100)
  pharmaceutical_form varchar(100)
  laboratory varchar(100)
  barcode varchar(50)
  requires_prescription boolean [default: false]
  is_controlled boolean [default: false] // Psicotrópicos AGEMED
  requires_cold_chain boolean [default: false]
  sin_product_code varchar(30) [not null]
  sin_activity_code varchar(30) [not null]
  base_unit_name varchar(30) [not null, default: 'unidad']
  is_active boolean [default: true]
  created_at timestamptz [default: `now()`]

  indexes {
    (tenant_id, barcode)
    (tenant_id, commercial_name)
  }
}

Table product_presentations {
  id uuid [pk, default: `gen_random_uuid()`]
  tenant_id uuid [not null, ref: > tenants.id]
  product_id uuid [not null, ref: > products.id]
  presentation_name varchar(50) [not null] // Caja, Blíster, Unidad
  units_multiplier int [not null] // Ej: Caja=100, Blíster=10, Unidad=1
  barcode varchar(50)
  sale_price numeric(12,2) [not null]
  is_default boolean [default: false]
}

Table batches {
  id uuid [pk, default: `gen_random_uuid()`]
  tenant_id uuid [not null, ref: > tenants.id]
  product_id uuid [not null, ref: > products.id]
  batch_number varchar(80) [not null]
  manufacture_date date
  expiration_date date [not null]
  sanitary_registry varchar(80)
  cost_price numeric(12,4) [not null] // Costo de compra unitario en base_unit
  created_at timestamptz [default: `now()`]

  indexes {
    (tenant_id, product_id, batch_number) [unique]
    (tenant_id, expiration_date)
  }
}

Table inventory_stocks {
  id uuid [pk, default: `gen_random_uuid()`]
  tenant_id uuid [not null, ref: > tenants.id]
  warehouse_id uuid [not null, ref: > warehouses.id]
  product_id uuid [not null, ref: > products.id]
  batch_id uuid [not null, ref: > batches.id]
  quantity_units int [not null, default: 0] // En unidades mínimas indivisibles
  updated_at timestamptz [default: `now()`]

  indexes {
    (tenant_id, warehouse_id, product_id, batch_id) [unique]
  }
}

Table cash_registers {
  id uuid [pk, default: `gen_random_uuid()`]
  tenant_id uuid [not null, ref: > tenants.id]
  branch_id uuid [not null, ref: > branches.id]
  sin_pos_code int [not null, default: 0] // Código punto de venta del SIN
  name varchar(80) [not null]
  is_active boolean [default: true]
}

Table cash_shifts {
  id uuid [pk, default: `gen_random_uuid()`]
  tenant_id uuid [not null, ref: > tenants.id]
  cash_register_id uuid [not null, ref: > cash_registers.id]
  user_id uuid [not null, ref: > users.id]
  opened_at timestamptz [default: `now()`]
  closed_at timestamptz
  initial_cash numeric(12,2) [not null]
  expected_cash numeric(12,2)
  declared_cash numeric(12,2)
  difference numeric(12,2)
  status varchar(20) [default: 'open'] // open, closed
}

Table sales {
  id uuid [pk, default: `gen_random_uuid()`]
  tenant_id uuid [not null, ref: > tenants.id]
  branch_id uuid [not null, ref: > branches.id]
  warehouse_id uuid [not null, ref: > warehouses.id]
  shift_id uuid [not null, ref: > cash_shifts.id]
  cashier_id uuid [not null, ref: > users.id]
  invoice_number bigint
  customer_name varchar(150) [not null]
  customer_doc_type int [not null, default: 1] // 1: CI, 5: NIT (Catálogo SIN)
  customer_doc_number varchar(30) [not null]
  customer_complement varchar(10)
  customer_email varchar(120)
  total_amount numeric(12,2) [not null]
  discount_amount numeric(12,2) [default: 0]
  payable_amount numeric(12,2) [not null]
  payment_method varchar(30) [not null] // CASH, QR, CARD, CREDIT
  document_type varchar(30) [not null] // SIAT_INVOICE, SALE_RECEIPT
  status varchar(20) [default: 'completed'] // completed, annulled
  created_at timestamptz [default: `now()`]
}

Table sale_items {
  id uuid [pk, default: `gen_random_uuid()`]
  tenant_id uuid [not null, ref: > tenants.id]
  sale_id uuid [not null, ref: > sales.id]
  product_id uuid [not null, ref: > products.id]
  presentation_id uuid [not null, ref: > product_presentations.id]
  batch_id uuid [not null, ref: > batches.id]
  quantity_sold int [not null]
  multiplier int [not null]
  total_base_units int [not null]
  unit_price numeric(12,2) [not null]
  subtotal numeric(12,2) [not null]
  batch_cost_price numeric(12,4) [not null]
}

Table controlled_drug_records {
  id uuid [pk, default: `gen_random_uuid()`]
  tenant_id uuid [not null, ref: > tenants.id]
  sale_id uuid [not null, ref: > sales.id]
  product_id uuid [not null, ref: > products.id]
  batch_id uuid [not null, ref: > batches.id]
  doctor_name varchar(150) [not null]
  doctor_medical_license varchar(50) [not null]
  doctor_ci varchar(30)
  patient_name varchar(150) [not null]
  patient_ci varchar(30) [not null]
  prescription_date date [not null]
  prescription_code varchar(50)
  retained_digital_copy_url text
  dispensed_units int [not null]
  created_at timestamptz [default: `now()`]
}

Table siat_daily_codes {
  id uuid [pk, default: `gen_random_uuid()`]
  tenant_id uuid [not null, ref: > tenants.id]
  branch_id uuid [not null, ref: > branches.id]
  cash_register_id uuid [not null, ref: > cash_registers.id]
  cufd_code text [not null]
  control_code varchar(50) [not null]
  direction varchar(255) [not null]
  start_date timestamptz [not null]
  end_date timestamptz [not null]
  is_active boolean [default: true]

  indexes {
    (tenant_id, branch_id, cash_register_id, is_active)
  }
}

Table siat_invoices {
  id uuid [pk, default: `gen_random_uuid()`]
  tenant_id uuid [not null, ref: > tenants.id]
  sale_id uuid [unique, not null, ref: > sales.id]
  invoice_number bigint [not null]
  cuf text [not null]
  cufd text [not null]
  emission_type int [not null, default: 1] // 1: En Línea, 2: Contingencia
  invoice_status varchar(30) [not null] // EMITTED, REJECTED, ANNULLED, PENDING_SYNC
  xml_payload text [not null]
  sin_reception_code text
  reception_datetime timestamptz
  created_at timestamptz [default: `now()`]

  indexes {
    (tenant_id, invoice_number)
    (tenant_id, cuf)
  }
}
```

---

## 5. ESPECIFICACIÓN TÉCNICA DE FACTURACIÓN SIAT SIN BOLIVIA

### 5.1. Diagrama de Secuencia de Emisión

```
+---------------+              +---------------------+              +-----------------------+
|  Cajero / POS |              | Backend PharmaCore  |              | Servidor SIAT (SIN)   |
+-------+-------+              +----------+----------+              +-----------+-----------+
        |                                 |                                     |
        | 1. Confirma Venta               |                                     |
        |-------------------------------->|                                     |
        |                                 | 2. Valida CUFD vigente (24h)        |
        |                                 | 3. Genera CUF con Algoritmo         |
        |                                 | 4. Construye XML Factura Compra/Venta|
        |                                 | 5. Firma Digital (o Digest SHA256)  |
        |                                 | 6. Comprime GZIP y Codifica Base64  |
        |                                 |                                     |
        |                                 | 7. Invoca recepcionFactura (SOAP)   |
        |                                 |------------------------------------>|
        |                                 |                                     |
        |                                 | 8. Respuesta: CodigoEstado (VALIDA) |
        |                                 |<------------------------------------|
        |                                 |                                     |
        |                                 | 9. Registra siat_invoices (EMITTED) |
        | 10. Retorna QR y Formato Ticket |                                     |
        |<--------------------------------|                                     |
```

### 5.2. Algoritmo del Código Único de Factura (CUF)
El CUF es un hash hexadecimal único que concatena campos de longitud fija con un dígito de control Módulo 11 y el código de control del CUFD:

```typescript
import BigNumber from 'bignumber.js';

export function calculateModulo11(chain: string): number {
  let factor = 2;
  let sum = 0;
  for (let i = chain.length - 1; i >= 0; i--) {
    sum += parseInt(chain[i], 10) * factor;
    factor = factor === 9 ? 2 : factor + 1;
  }
  const mod = sum % 11;
  if (mod === 0) return 0;
  if (mod === 1) return 1;
  return 11 - mod;
}

export function generateCUF(params: {
  nit: string;
  dateTime: Date;
  branchNumber: number;
  modality: 1 | 2;         // 1: Electrónica, 2: Computarizada
  emissionType: 1 | 2;     // 1: En línea, 2: Fuera de línea (contingencia)
  invoiceType: 1;          // 1: Con crédito fiscal
  sectorDocType: 1;        // 1: Compra-Venta estándar
  invoiceNumber: number;
  posCode: number;
  cufdControlCode: string;
}): string {
  const pad = (val: number | string, len: number) => String(val).padStart(len, '0');
  
  const padDate = (d: Date) => {
    const y = d.getFullYear();
    const m = pad(d.getMonth() + 1, 2);
    const day = pad(d.getDate(), 2);
    const h = pad(d.getHours(), 2);
    const min = pad(d.getMinutes(), 2);
    const s = pad(d.getSeconds(), 2);
    const ms = pad(d.getMilliseconds(), 3);
    return `${y}${m}${day}${h}${min}${s}${ms}`;
  };

  // 1. Concatenación de la cadena base de 53 caracteres
  const rawString = 
    pad(params.nit, 13) +
    padDate(params.dateTime) +
    pad(params.branchNumber, 4) +
    params.modality +
    params.emissionType +
    params.invoiceType +
    pad(params.sectorDocType, 2) +
    pad(params.invoiceNumber, 10) +
    pad(params.posCode, 4);

  // 2. Cálculo del Dígito Módulo 11
  const mod11 = calculateModulo11(rawString);
  const chainWithMod11 = rawString + mod11;

  // 3. Conversión de la cadena numérica a Hexadecimal Base 16 (BigInteger)
  const bigNum = new BigNumber(chainWithMod11);
  const hexValue = bigNum.toString(16).toUpperCase();

  // 4. Concatenación final con el Código de Control del CUFD
  return hexValue + params.cufdControlCode;
}
```

### 5.3. Procedimiento de Contingencia Offline
1. Si la petición SOAP al SIN falla por timeout o ausencia de conexión, conmutar a `emissionType = 2`.
2. Emitir la factura al cliente utilizando el CUFD local vigente con la leyenda obligatoria *"Este documento es la representación gráfica de una factura emitida fuera de línea"*.
3. Encolar la factura en Redis (`siat_contingency_queue`).
4. Al restablecer la conectividad, generar el archivo comprimido `.tar.gz` con el paquete de facturas y consumir el endpoint SOAP `recepcionPaqueteFactura` en un plazo no mayor a 48 horas.

---

## 6. ALGORITMO DE DISPENSACIÓN FEFO Y FRACCIONAMIENTO

Este servicio implementa la reserva y deducción de existencias con aislamiento transaccional (`SELECT ... FOR UPDATE`), garantizando consistencia absoluta ante concurrencia en mostradores simultáneos:

```typescript
import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';

export interface CartItemDto {
  productId: string;
  presentationId: string;
  quantityRequested: number; // Ej: 2 Cajas o 5 Tabletas
}

export interface DispensationBatchAllocation {
  batchId: string;
  batchNumber: string;
  expirationDate: string;
  baseUnitsDeducted: number;
  costPrice: number;
}

@Injectable()
export class FefoDispensationService {
  /**
   * Despacha el stock de un medicamento respetando rigurosamente FEFO
   * y calculando el consumo en la menor unidad divisible.
   */
  async allocateStockFEFO(
    queryRunner: QueryRunner,
    tenantId: string,
    warehouseId: string,
    item: CartItemDto,
  ): Promise<{ allocations: DispensationBatchAllocation[]; totalBaseUnits: number; subtotalCost: number }> {
    // 1. Obtener presentación y su factor de conversión a unidad mínima
    const presentation = await queryRunner.query(
      `SELECT id, product_id, units_multiplier, sale_price 
       FROM product_presentations 
       WHERE id = $1 AND tenant_id = $2`,
      [item.presentationId, tenantId],
    );

    if (!presentation || presentation.length === 0) {
      throw new BadRequestException(`Presentación farmacéutica ${item.presentationId} no existe`);
    }

    const multiplier = Number(presentation[0].units_multiplier);
    const requiredBaseUnits = item.quantityRequested * multiplier;
    let unitsRemainingToFulfill = requiredBaseUnits;

    // 2. Bloquear existencias ordenadas por FEFO (vencimiento más cercano primero)
    const availableBatches = await queryRunner.query(
      `SELECT 
          s.id AS stock_id,
          s.batch_id,
          s.quantity_units,
          b.batch_number,
          b.expiration_date,
          b.cost_price
       FROM inventory_stocks s
       INNER JOIN batches b ON b.id = s.batch_id
       WHERE s.tenant_id = $1 
         AND s.warehouse_id = $2 
         AND s.product_id = $3
         AND s.quantity_units > 0
         AND b.expiration_date >= CURRENT_DATE
       ORDER BY b.expiration_date ASC, s.quantity_units ASC
       FOR UPDATE OF s`,
      [tenantId, warehouseId, item.productId],
    );

    // 3. Validar suficiencia total de existencias
    const totalAvailableUnits = availableBatches.reduce(
      (acc: number, row: any) => acc + Number(row.quantity_units),
      0,
    );

    if (totalAvailableUnits < requiredBaseUnits) {
      throw new ConflictException(
        `Stock insuficiente para el producto ${item.productId}. Requerido: ${requiredBaseUnits} unidades base, Disponible: ${totalAvailableUnits}`,
      );
    }

    // 4. Asignar y descontar stock lote por lote
    const allocations: DispensationBatchAllocation[] = [];
    let subtotalCost = 0;

    for (const batchRow of availableBatches) {
      if (unitsRemainingToFulfill <= 0) break;

      const currentBatchStock = Number(batchRow.quantity_units);
      const unitsToDeduct = Math.min(unitsRemainingToFulfill, currentBatchStock);

      await queryRunner.query(
        `UPDATE inventory_stocks 
         SET quantity_units = quantity_units - $1,
             updated_at = NOW()
         WHERE id = $2`,
        [unitsToDeduct, batchRow.stock_id],
      );

      const batchCost = Number(batchRow.cost_price) * unitsToDeduct;
      subtotalCost += batchCost;

      allocations.push({
        batchId: batchRow.batch_id,
        batchNumber: batchRow.batch_number,
        expirationDate: batchRow.expiration_date,
        baseUnitsDeducted: unitsToDeduct,
        costPrice: Number(batchRow.cost_price),
      });

      unitsRemainingToFulfill -= unitsToDeduct;
    }

    return {
      allocations,
      totalBaseUnits: requiredBaseUnits,
      subtotalCost,
    };
  }
}
```

---

## 7. SUBSCRIPTION GUARD Y FEATURE FLAGS

Patrón de interceptación para validar en cada solicitud que el tenant no sobrepase sus cuotas o consuma módulos no contratados:

```typescript
import { SetMetadata, CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const REQUIRE_FEATURE_KEY = 'require_feature';
export const RequireFeature = (feature: string) => SetMetadata(REQUIRE_FEATURE_KEY, feature);

export const CHECK_QUOTA_KEY = 'check_quota';
export const CheckQuota = (resource: 'branches' | 'users' | 'cash_registers') => 
  SetMetadata(CHECK_QUOTA_KEY, resource);

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredFeature = this.reflector.get<string>(REQUIRE_FEATURE_KEY, context.getHandler());
    const quotaResource = this.reflector.get<string>(CHECK_QUOTA_KEY, context.getHandler());

    const request = context.switchToHttp().getRequest();
    const tenant = request.tenant; // Inyectado por TenantMiddleware previo
    const subscription = request.subscription; // Cargado de base de datos o Redis

    // 1. Validar estado de la suscripción
    if (!subscription || !['active', 'trialing'].includes(subscription.status)) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTION_INACTIVE',
        message: 'La suscripción de la farmacia está vencida o suspendida.',
      });
    }

    // 2. Validar Feature Flag
    if (requiredFeature) {
      const allowedFeatures: string[] = subscription.plan.features_json || [];
      if (!allowedFeatures.includes(requiredFeature)) {
        throw new ForbiddenException({
          code: 'FEATURE_NOT_IN_PLAN',
          message: `El módulo '${requiredFeature}' requiere actualizar a un plan superior.`,
          currentPlan: subscription.plan.code,
        });
      }
    }

    // 3. Validar Límite de Cuota
    if (quotaResource === 'branches') {
      const currentBranchesCount = request.currentCounts.branches;
      if (currentBranchesCount >= subscription.plan.max_branches) {
        throw new ForbiddenException({
          code: 'BRANCH_LIMIT_REACHED',
          message: `Ha alcanzado el límite de ${subscription.plan.max_branches} sucursal(es) de su plan.`,
        });
      }
    }

    return true;
  }
}
```

---

## 8. ROADMAP DE IMPLEMENTACIÓN Y TAREAS POR SPRINTS

### SPRINT 1: Núcleo Arquitectural y Multi-Tenancy
- [ ] Inicializar proyecto backend (NestJS/TypeScript o FastAPI/Python) con PostgreSQL y Redis.
- [ ] Aplicar DDL de base de datos desde el esquema DBML (`tenants`, `subscription_plans`, `subscriptions`, `branches`, `warehouses`, `users`).
- [ ] Crear `TenantContextMiddleware` para resolver el tenant mediante JWT claims o subdominio.
- [ ] Implementar `SubscriptionGuard` con `@RequireFeature()` y `@CheckQuota()`.
- [ ] Desarrollar servicio de autenticación JWT y control de roles RBAC.

### SPRINT 2: Catálogo Farmacéutico, Fraccionamiento e Inventario FEFO
- [ ] Migrar tablas `products`, `product_presentations`, `batches` e `inventory_stocks`.
- [ ] Implementar CRUD de productos con metadatos sanitarios AGEMED (principios activos, psicotrópicos, frío, homologación SIN).
- [ ] Configurar lógica de presentaciones: Caja, Blíster y Unidad con multiplicadores numéricos.
- [ ] Implementar `FefoDispensationService` con bloqueo `SELECT ... FOR UPDATE`.
- [ ] Configurar cron job para semáforo de alertas de caducidad (<30, <60, <90 días).

### SPRINT 3: Punto de Venta (POS) y Control de Turnos
- [ ] Crear tablas `cash_registers` y `cash_shifts`.
- [ ] Módulo de arqueo de caja: Apertura con fondo inicial, movimientos menores y arqueo ciego al cierre.
- [ ] Desarrollar endpoint transaccional de venta en POS que invoque la deducción FEFO y persista `sales` y `sale_items`.
- [ ] Validar retención de receta en ventas con fármacos `is_controlled = true` registrando médico, matrícula y paciente en `controlled_drug_records`.
- [ ] Generar formato de impresión térmica (58mm / 80mm).

### SPRINT 4: Facturación en Línea SIAT SIN Bolivia
- [ ] Configurar cliente SOAP hacia los ambientes de pruebas del SIN.
- [ ] Automatizar renovación diaria de CUFD en `siat_daily_codes`.
- [ ] Implementar algoritmo generador de CUF con Módulo 11 y codificación Hexadecimal Base 16.
- [ ] Desarrollar ensamblador de XML Factura Compra-Venta con digest SHA-256 o firma X.509.
- [ ] Implementar flujo de contingencia: emisión fuera de línea y cola de sincronización diferida en Redis.

### SPRINT 5: Multi-Sucursal, Libro AGEMED y Analítica
- [ ] Desarrollar módulo de traspasos: Solicitud, Despacho en tránsito y Recepción con verificación física.
- [ ] Generar Libro Oficial Digitalizado de Psicotrópicos en formato reglamentario AGEMED/SEDES.
- [ ] Implementar módulo de comisiones sobre ventas para el personal dispensador.
- [ ] Crear motor de clasificación ABC de existencias según volumen y valor de rotación.

---

## 9. PROMPT MAESTRO PARA AGENTES DE CÓDIGO

Copia y pega este bloque en cualquier asistente de código (Cursor, Claude Code, Copilot, Antigravity u OpenCode) para iniciar el desarrollo con contexto total:

```markdown
Actúa como un Arquitecto de Software Senior y Tech Lead Full-Stack.
Vamos a construir el backend y frontend de "PharmaCore Bolivia", un sistema SaaS multi-tenant para farmacias con estricto apego a las normativas de Bolivia (AGEMED para salud y SIN SIAT para tributación).

### 1. REGLAS ARQUITECTURALES
- Multi-Tenancy: Todas las consultas de negocio deben filtrar obligatoriamente por `tenant_id` resuelto desde el JWT.
- Control de Tiers SaaS: Implementa decoradores `@RequireFeature()` y `@CheckQuota()` según la matriz de planes (BASIC, PRO, ENTERPRISE).
- Fraccionamiento: El inventario se almacena siempre en la unidad mínima indivisible. Las presentaciones (caja, blíster) se calculan mediante su factor de conversión (`units_multiplier`).
- Algoritmo FEFO: Toda dispensación consume lotes ordenados por fecha de vencimiento más próxima (`expiration_date ASC`) aplicando bloqueos de fila transaccionales (`FOR UPDATE`).
- Facturación SIAT: Diseña el cálculo de CUF (Módulo 11 + Base 16), gestión de CUFD diario y mecanismo de contingencia offline.

### 2. TAREA INMEDIATA
Toma como referencia el esquema DBML y la especificación técnica completa provista en la documentación del proyecto e implementa la FASE 1 del Sprint Backlog:
1. Código DDL / Migraciones de la base de datos para PostgreSQL.
2. Middleware de resolución de Tenant y Guard de control de suscripciones.
3. El servicio de dispensación FEFO con fraccionamiento atómico.
```
