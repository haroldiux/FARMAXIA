import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { SubscriptionInactiveException } from "../saas/subscription.guard.js";
import { TenantDatabase, type TenantScope } from "../database/tenant-database.js";
import { FeatureService } from "../subscriptions/feature.service.js";
import { SubscriptionAccessError } from "../subscriptions/quota.service.js";
import { controlledProductPredicate } from "./prescription.js";

const ZONE = "America/La_Paz";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface PrescriptionListQuery {
  /** Dispensing date range (inclusive, Bolivia time), YYYY-MM-DD. */
  from?: string;
  to?: string;
  /** Free text: folio, sale number, patient name/document, doctor name/license. */
  q?: string;
  limit?: number;
  offset?: number;
}

export interface DispensedLot {
  lotCode: string;
  quantityBase: number;
}

export interface DispensedItem {
  productName: string;
  presentationName: string;
  quantity: number;
  quantityBase: number;
  isControlled: boolean;
  lots: DispensedLot[];
}

export interface PrescriptionSummary {
  id: string;
  folio: string;
  saleId: string;
  saleNumber: string;
  doctorName: string;
  doctorLicense: string;
  patientName: string;
  patientDocument: string;
  issuingCenter: string;
  /** YYYY-MM-DD */
  prescribedAt: string;
  notes: string | null;
  createdByUserId: string;
  createdAt: string;
  items: DispensedItem[];
}

export interface PrescriptionListResult {
  items: PrescriptionSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface BalanceFlow {
  total: number;
  /** Quantity (base units) per movement type: RECEIPT, SALE, SALE_VOID, SALE_RETURN, TRANSFER_IN, ... */
  byType: Record<string, number>;
}

export interface ControlledBalanceItem {
  productId: string;
  productName: string;
  presentations: Array<{ id: string; name: string; baseUnitFactor: number }>;
  openingBase: number;
  entries: BalanceFlow;
  exits: BalanceFlow;
  /** opening + entries.total - exits.total */
  closingBase: number;
  /** Live stock in the branch warehouses (inventory_balances), for comparison. */
  currentStockBase: number;
}

export interface ControlledBalanceResult {
  month: string;
  items: ControlledBalanceItem[];
}

export interface BookLine {
  /** Sequential line number inside this listing (1-based). */
  folio: number;
  occurredAt: string;
  /** YYYY-MM-DD (Bolivia time) */
  date: string;
  productId: string;
  productName: string;
  presentationName: string;
  lotCode: string;
  warehouseName: string;
  movementType: string;
  quantityIn: number;
  quantityOut: number;
  /** Running balance of the product after this line. */
  balanceBase: number;
  document: { type: string; number: string | null };
  prescription: null | {
    folio: string;
    doctorName: string;
    doctorLicense: string;
    patientName: string;
    patientDocument: string;
  };
}

export interface ControlledBookResult {
  month: string;
  openings: Array<{ productId: string; productName: string; openingBase: number }>;
  lines: BookLine[];
}

export interface BookExport {
  filename: string;
  csv: string;
}

function invalid(field: string, message: string): BadRequestException {
  return new BadRequestException({ code: "INVALID_INPUT", field, message });
}

function isRealDate(value: string): boolean {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function optionalDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !isRealDate(value)) {
    throw invalid(field, "La fecha no es válida (use AAAA-MM-DD).");
  }
  return value;
}

/** Returns [first day of the month, first day of the next month] as YYYY-MM-DD. */
function monthRange(month: unknown): { month: string; start: string; end: string } {
  if (typeof month !== "string" || !monthPattern.test(month)) {
    throw invalid("month", "El mes no es válido (use AAAA-MM).");
  }
  const [yearText, monthText] = month.split("-") as [string, string];
  const year = Number(yearText);
  const next = Number(monthText) === 12 ? `${year + 1}-01` : `${yearText}-${String(Number(monthText) + 1).padStart(2, "0")}`;
  return { month, start: `${month}-01`, end: `${next}-01` };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** RFC 4180 cell; also defuses spreadsheet formulas (a leading = + @ becomes text). */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+@]/.test(text)) text = `'${text}`;
  return /[",;\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const csvHeader = [
  "Folio",
  "Fecha",
  "Producto",
  "Presentacion",
  "Lote",
  "Movimiento",
  "Entrada (base)",
  "Salida (base)",
  "Saldo (base)",
  "Documento",
  "Receta",
  "Medico",
  "Matricula",
  "Paciente",
  "Documento paciente"
];

export function bookToCsv(lines: readonly BookLine[]): string {
  const rows = lines.map((line) =>
    [
      line.folio,
      line.date,
      line.productName,
      line.presentationName,
      line.lotCode,
      line.movementType,
      line.quantityIn,
      line.quantityOut,
      line.balanceBase,
      line.document.number ?? line.document.type,
      line.prescription?.folio,
      line.prescription?.doctorName,
      line.prescription?.doctorLicense,
      line.prescription?.patientName,
      line.prescription?.patientDocument
    ]
      .map(csvCell)
      .join(",")
  );
  return `﻿${[csvHeader.join(","), ...rows].join("\r\n")}\r\n`;
}

// Movements of effectively controlled products in the active branch's warehouses.
const movementJoins = `
  from inventory_movements m
  join warehouses w on w.tenant_id = m.tenant_id and w.id = m.warehouse_id and w.branch_id = $2
  join inventory_batches b on b.tenant_id = m.tenant_id and b.id = m.batch_id
  join product_presentations pr on pr.tenant_id = b.tenant_id and pr.id = b.presentation_id
  join products p on p.tenant_id = pr.tenant_id and p.id = pr.product_id
  left join product_categories c on c.tenant_id = p.tenant_id and c.id = p.category_id`;
const movementWhere = `where m.tenant_id = $1 and ${controlledProductPredicate("p", "c")}`;
const movementSource = `${movementJoins} ${movementWhere}`;

const periodStart = "$3::date::timestamp at time zone 'America/La_Paz'";
const periodEnd = "$4::date::timestamp at time zone 'America/La_Paz'";

@Injectable()
export class ControlledService {
  private readonly features: FeatureService;

  constructor(@Inject(TenantDatabase) private readonly database: TenantDatabase) {
    this.features = new FeatureService(database);
  }

  async listPrescriptions(scope: TenantScope, query: PrescriptionListQuery): Promise<PrescriptionListResult> {
    const from = optionalDate(query.from, "from");
    const to = optionalDate(query.to, "to");
    const q = typeof query.q === "string" ? query.q.trim() : "";
    if (q.length > 80) throw invalid("q", "La búsqueda admite como máximo 80 caracteres.");
    const limit = query.limit ?? DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw invalid("limit", `El límite debe estar entre 1 y ${MAX_LIMIT}.`);
    }
    const offset = query.offset ?? 0;
    if (!Number.isInteger(offset) || offset < 0) throw invalid("offset", "El desplazamiento no es válido.");
    const like = q ? `%${escapeLike(q)}%` : null;

    return this.database.withScope(scope, async (client) => {
      const filter = `cp.tenant_id = $1 and cp.branch_id = $2
        and ($3::date is null or (cp.created_at at time zone '${ZONE}')::date >= $3::date)
        and ($4::date is null or (cp.created_at at time zone '${ZONE}')::date <= $4::date)
        and ($5::text is null or cp.folio ilike $5 or s.sale_number ilike $5 or cp.patient_name ilike $5
             or cp.patient_document ilike $5 or cp.doctor_name ilike $5 or cp.doctor_license ilike $5)`;
      const params = [scope.tenantId, scope.branchId, from, to, like];
      const total = await client.query<{ total: number }>(
        `select count(*)::int as total
         from controlled_prescriptions cp
         join sales s on s.tenant_id = cp.tenant_id and s.branch_id = cp.branch_id and s.id = cp.sale_id
         where ${filter}`,
        params
      );
      const rows = await client.query<PrescriptionRow>(
        `${prescriptionSelect}
         where ${filter}
         order by cp.created_at desc, cp.id desc
         limit $6 offset $7`,
        [...params, limit, offset]
      );
      return {
        items: await this.withItems(client, scope, rows.rows),
        total: total.rows[0]?.total ?? 0,
        limit,
        offset
      };
    });
  }

  async prescriptionDetail(scope: TenantScope, prescriptionId: string): Promise<PrescriptionSummary> {
    if (typeof prescriptionId !== "string" || !uuidPattern.test(prescriptionId)) {
      throw new NotFoundException("Receta no encontrada.");
    }
    return this.database.withScope(scope, async (client) => {
      const rows = await client.query<PrescriptionRow>(
        `${prescriptionSelect} where cp.tenant_id = $1 and cp.branch_id = $2 and cp.id = $3`,
        [scope.tenantId, scope.branchId, prescriptionId]
      );
      if (!rows.rows[0]) throw new NotFoundException("Receta no encontrada.");
      const [detail] = await this.withItems(client, scope, rows.rows);
      return detail!;
    });
  }

  async balance(scope: TenantScope, month: string): Promise<ControlledBalanceResult> {
    const range = monthRange(month);
    await this.requireBook(scope);
    return this.database.withScope(scope, async (client) => {
      const params = [scope.tenantId, scope.branchId, range.start, range.end];
      const signed = "case when m.movement_direction = 'IN' then m.quantity_base else -m.quantity_base end";
      const openings = await client.query<{ productId: string; productName: string; total: string }>(
        `select p.id as "productId", p.name as "productName", sum(${signed})::text as total
         ${movementSource} and m.occurred_at < ${periodStart}
         group by p.id, p.name`,
        params.slice(0, 3)
      );
      const flows = await client.query<{
        productId: string;
        productName: string;
        direction: "IN" | "OUT";
        movementType: string;
        total: string;
      }>(
        `select p.id as "productId", p.name as "productName", m.movement_direction as direction,
                m.movement_type as "movementType", sum(m.quantity_base)::text as total
         ${movementSource} and m.occurred_at >= ${periodStart} and m.occurred_at < ${periodEnd}
         group by p.id, p.name, m.movement_direction, m.movement_type`,
        params
      );

      const products = new Map<string, ControlledBalanceItem>();
      const entry = (productId: string, productName: string): ControlledBalanceItem => {
        let item = products.get(productId);
        if (!item) {
          item = {
            productId,
            productName,
            presentations: [],
            openingBase: 0,
            entries: { total: 0, byType: {} },
            exits: { total: 0, byType: {} },
            closingBase: 0,
            currentStockBase: 0
          };
          products.set(productId, item);
        }
        return item;
      };
      for (const row of openings.rows) entry(row.productId, row.productName).openingBase = Number(row.total);
      for (const row of flows.rows) {
        const item = entry(row.productId, row.productName);
        const flow = row.direction === "IN" ? item.entries : item.exits;
        flow.byType[row.movementType] = (flow.byType[row.movementType] ?? 0) + Number(row.total);
        flow.total += Number(row.total);
      }
      const reported = [...products.values()].filter(
        (item) => item.openingBase !== 0 || item.entries.total !== 0 || item.exits.total !== 0
      );
      if (reported.length > 0) {
        const ids = reported.map((item) => item.productId);
        const presentations = await client.query<{ productId: string; id: string; name: string; factor: string }>(
          `select pr.product_id as "productId", pr.id, pr.name, pr.base_unit_factor::text as factor
           from product_presentations pr
           where pr.tenant_id = $1 and pr.product_id = any($2::uuid[])
           order by pr.base_unit_factor asc, pr.name asc`,
          [scope.tenantId, ids]
        );
        const stock = await client.query<{ productId: string; total: string }>(
          `select pr.product_id as "productId", sum(ib.quantity_base)::text as total
           from inventory_balances ib
           join warehouses w on w.tenant_id = ib.tenant_id and w.id = ib.warehouse_id and w.branch_id = $2
           join inventory_batches b on b.tenant_id = ib.tenant_id and b.id = ib.batch_id
           join product_presentations pr on pr.tenant_id = b.tenant_id and pr.id = b.presentation_id
           where ib.tenant_id = $1 and pr.product_id = any($3::uuid[])
           group by pr.product_id`,
          [scope.tenantId, scope.branchId, ids]
        );
        for (const row of presentations.rows) {
          products.get(row.productId)?.presentations.push({ id: row.id, name: row.name, baseUnitFactor: Number(row.factor) });
        }
        for (const row of stock.rows) {
          const item = products.get(row.productId);
          if (item) item.currentStockBase = Number(row.total);
        }
      }
      for (const item of reported) item.closingBase = item.openingBase + item.entries.total - item.exits.total;
      reported.sort((a, b) => a.productName.localeCompare(b.productName, "es") || a.productId.localeCompare(b.productId));
      return { month: range.month, items: reported };
    });
  }

  async book(scope: TenantScope, month: string): Promise<ControlledBookResult> {
    const range = monthRange(month);
    await this.requireBook(scope);
    return this.database.withScope(scope, async (client) => {
      const params = [scope.tenantId, scope.branchId, range.start, range.end];
      const signed = "case when m.movement_direction = 'IN' then m.quantity_base else -m.quantity_base end";
      const openingRows = await client.query<{ productId: string; productName: string; total: string }>(
        `select p.id as "productId", p.name as "productName", sum(${signed})::text as total
         ${movementSource} and m.occurred_at < ${periodStart}
         group by p.id, p.name`,
        params.slice(0, 3)
      );
      const lineRows = await client.query<BookRow>(
        `select m.id, m.occurred_at as "occurredAt",
                to_char(m.occurred_at at time zone '${ZONE}', 'YYYY-MM-DD') as date,
                p.id as "productId", p.name as "productName", pr.name as "presentationName",
                b.lot_code as "lotCode", w.name as "warehouseName",
                m.movement_type as "movementType", m.movement_direction as direction,
                m.quantity_base::text as quantity, m.reference_type as "referenceType",
                coalesce(sale.sale_number, sret.return_number) as "documentNumber",
                cp.folio as "prescriptionFolio", cp.doctor_name as "doctorName",
                cp.doctor_license as "doctorLicense", cp.patient_name as "patientName",
                cp.patient_document as "patientDocument"
         ${movementJoins}
         left join sales sale on sale.tenant_id = m.tenant_id and sale.id = m.reference_id
           and m.reference_type in ('SALE', 'SALE_VOID')
         left join sale_returns sret on sret.tenant_id = m.tenant_id and sret.id = m.reference_id
           and m.reference_type = 'SALE_RETURN'
         left join controlled_prescriptions cp on cp.tenant_id = m.tenant_id and cp.branch_id = $2
           and cp.sale_id = coalesce(sale.id, sret.sale_id)
         ${movementWhere} and m.occurred_at >= ${periodStart} and m.occurred_at < ${periodEnd}
         order by m.occurred_at asc, m.id asc`,
        params
      );

      const running = new Map<string, number>();
      const names = new Map<string, string>();
      for (const row of openingRows.rows) {
        running.set(row.productId, Number(row.total));
        names.set(row.productId, row.productName);
      }
      const lines: BookLine[] = lineRows.rows.map((row, index) => {
        const quantity = Number(row.quantity);
        const quantityIn = row.direction === "IN" ? quantity : 0;
        const quantityOut = row.direction === "OUT" ? quantity : 0;
        const balance = (running.get(row.productId) ?? 0) + quantityIn - quantityOut;
        running.set(row.productId, balance);
        names.set(row.productId, row.productName);
        return {
          folio: index + 1,
          occurredAt: new Date(row.occurredAt).toISOString(),
          date: row.date,
          productId: row.productId,
          productName: row.productName,
          presentationName: row.presentationName,
          lotCode: row.lotCode,
          warehouseName: row.warehouseName,
          movementType: row.movementType,
          quantityIn,
          quantityOut,
          balanceBase: balance,
          document: { type: row.referenceType, number: row.documentNumber },
          prescription: row.prescriptionFolio
            ? {
                folio: row.prescriptionFolio,
                doctorName: row.doctorName!,
                doctorLicense: row.doctorLicense!,
                patientName: row.patientName!,
                patientDocument: row.patientDocument!
              }
            : null
        };
      });
      const openings = openingRows.rows
        .map((row) => ({ productId: row.productId, productName: row.productName, openingBase: Number(row.total) }))
        .sort((a, b) => a.productName.localeCompare(b.productName, "es"));
      return { month: range.month, openings, lines };
    });
  }

  async exportBookCsv(scope: TenantScope, month: string): Promise<BookExport> {
    const book = await this.book(scope, month);
    return { filename: `libro-controlados-${book.month}.csv`, csv: bookToCsv(book.lines) };
  }

  /** Gate for balance/book/export: the plan must include `controlled.book` (Premium). */
  private async requireBook(scope: TenantScope): Promise<void> {
    let enabled: boolean;
    try {
      enabled = await this.features.isEnabled(scope, "controlled.book");
    } catch (error) {
      if (error instanceof SubscriptionAccessError) throw new SubscriptionInactiveException();
      throw error;
    }
    if (!enabled) {
      throw new ForbiddenException({
        statusCode: 403,
        code: "PLAN_FEATURE_RESTRICTED",
        message: "Tu plan no incluye esta funcionalidad.",
        feature: "controlled.book"
      });
    }
  }

  private async withItems(
    client: PoolClient,
    scope: TenantScope,
    rows: readonly PrescriptionRow[]
  ): Promise<PrescriptionSummary[]> {
    const saleIds = rows.map((row) => row.saleId);
    const itemRows = saleIds.length
      ? await client.query<DispensedRow>(
          `select i.sale_id as "saleId", i.id as "itemId", p.name as "productName", pr.name as "presentationName",
                  i.quantity::int as quantity, i.quantity_base::text as "quantityBase",
                  ${controlledProductPredicate("p", "c")} as "isControlled",
                  b.lot_code as "lotCode", a.quantity_base::text as "lotQuantityBase"
           from sale_items i
           join product_presentations pr on pr.tenant_id = i.tenant_id and pr.id = i.presentation_id
           join products p on p.tenant_id = pr.tenant_id and p.id = pr.product_id
           left join product_categories c on c.tenant_id = p.tenant_id and c.id = p.category_id
           left join sale_allocations a on a.tenant_id = i.tenant_id and a.branch_id = i.branch_id and a.sale_item_id = i.id
           left join inventory_batches b on b.tenant_id = a.tenant_id and b.id = a.batch_id
           where i.tenant_id = $1 and i.branch_id = $2 and i.sale_id = any($3::uuid[])
           order by i.created_at asc, i.id asc, b.lot_code asc`,
          [scope.tenantId, scope.branchId, saleIds]
        )
      : { rows: [] as DispensedRow[] };
    const bySale = new Map<string, Map<string, DispensedItem>>();
    for (const row of itemRows.rows) {
      const items = bySale.get(row.saleId) ?? new Map<string, DispensedItem>();
      bySale.set(row.saleId, items);
      let item = items.get(row.itemId);
      if (!item) {
        item = {
          productName: row.productName,
          presentationName: row.presentationName,
          quantity: row.quantity,
          quantityBase: Number(row.quantityBase),
          isControlled: row.isControlled,
          lots: []
        };
        items.set(row.itemId, item);
      }
      if (row.lotCode) item.lots.push({ lotCode: row.lotCode, quantityBase: Number(row.lotQuantityBase) });
    }
    return rows.map((row) => ({
      id: row.id,
      folio: row.folio,
      saleId: row.saleId,
      saleNumber: row.saleNumber,
      doctorName: row.doctorName,
      doctorLicense: row.doctorLicense,
      patientName: row.patientName,
      patientDocument: row.patientDocument,
      issuingCenter: row.issuingCenter,
      prescribedAt: row.prescribedAt,
      notes: row.notes,
      createdByUserId: row.createdByUserId,
      createdAt: new Date(row.createdAt).toISOString(),
      items: [...(bySale.get(row.saleId)?.values() ?? [])]
    }));
  }
}

interface PrescriptionRow {
  id: string;
  folio: string;
  saleId: string;
  saleNumber: string;
  doctorName: string;
  doctorLicense: string;
  patientName: string;
  patientDocument: string;
  issuingCenter: string;
  prescribedAt: string;
  notes: string | null;
  createdByUserId: string;
  createdAt: string | Date;
}

interface DispensedRow {
  saleId: string;
  itemId: string;
  productName: string;
  presentationName: string;
  quantity: number;
  quantityBase: string;
  isControlled: boolean;
  lotCode: string | null;
  lotQuantityBase: string | null;
}

interface BookRow {
  id: string;
  occurredAt: string | Date;
  date: string;
  productId: string;
  productName: string;
  presentationName: string;
  lotCode: string;
  warehouseName: string;
  movementType: string;
  direction: "IN" | "OUT";
  quantity: string;
  referenceType: string;
  documentNumber: string | null;
  prescriptionFolio: string | null;
  doctorName: string | null;
  doctorLicense: string | null;
  patientName: string | null;
  patientDocument: string | null;
}

const prescriptionSelect = `
  select cp.id, cp.folio, cp.sale_id as "saleId", s.sale_number as "saleNumber",
         cp.doctor_name as "doctorName", cp.doctor_license as "doctorLicense",
         cp.patient_name as "patientName", cp.patient_document as "patientDocument",
         cp.issuing_center as "issuingCenter", to_char(cp.prescribed_at, 'YYYY-MM-DD') as "prescribedAt",
         cp.notes, cp.created_by_user_id as "createdByUserId", cp.created_at as "createdAt"
  from controlled_prescriptions cp
  join sales s on s.tenant_id = cp.tenant_id and s.branch_id = cp.branch_id and s.id = cp.sale_id`;
