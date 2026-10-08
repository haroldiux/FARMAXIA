import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { TenantDatabase, type TenantScope } from "../database/tenant-database.js";
import { FeatureService } from "../subscriptions/feature.service.js";
import { AuditService } from "../transversal/audit.service.js";
import { ZONE, featureEnabled, invalid, optionalDate, requireFeature, uuidPattern } from "../staff/staff.common.js";

export const CUSTOMERS_FEATURE = "crm.customers";
export const LOYALTY_FEATURE = "crm.loyalty";
const DOC_TYPES = ["CI", "NIT", "PASSPORT", "OTHER"] as const;
export type DocType = (typeof DOC_TYPES)[number];
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface Customer {
  id: string;
  fullName: string;
  docType: DocType | null;
  docNumber: string | null;
  complement: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  isActive: boolean;
  /** Points balance; null when the plan has no crm.loyalty. */
  loyaltyBalance: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerInput {
  fullName?: string;
  docType?: string | null;
  docNumber?: string | null;
  complement?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

export interface CustomerListQuery {
  q?: string;
  /** "true" | "false"; omitted = both. */
  active?: string;
  limit?: number;
  offset?: number;
}

export interface CustomerListResult {
  items: Customer[];
  total: number;
  limit: number;
  offset: number;
}

export interface PurchaseHistoryQuery {
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface CustomerPurchase {
  id: string;
  number: string;
  createdAt: string;
  status: string;
  totalBob: string;
  refundedBob: string;
  /** Total minus refunds; zero for voided sales. */
  netBob: string;
}

export interface PurchaseHistory {
  customerId: string;
  items: CustomerPurchase[];
  total: number;
  limit: number;
  offset: number;
  /** Over the whole filter (not only the page); voided sales are excluded. */
  summary: { salesCount: number; netTotalBob: string };
}

interface CustomerRow {
  id: string;
  fullName: string;
  docType: DocType | null;
  docNumber: string | null;
  complement: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  isActive: boolean;
  loyaltyBalance: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toCustomer(row: CustomerRow): Customer {
  return {
    ...row,
    loyaltyBalance: row.loyaltyBalance === null ? null : Number(row.loyaltyBalance),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function has(input: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key) && (input as Record<string, unknown>)[key] !== undefined;
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw invalid(field, "El valor no es válido.");
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw invalid(field, `Máximo ${max} caracteres.`);
  return trimmed;
}

function requiredName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) throw invalid("fullName", "Indique el nombre del cliente.");
  if (name.length > 160) throw invalid("fullName", "El nombre admite hasta 160 caracteres.");
  return name;
}

/** Validates the document pair and the complement (CI only) of the final customer state. */
function checkDocument(docType: string | null, docNumber: string | null, complement: string | null): void {
  if (docNumber !== null && docType === null) throw invalid("docType", "Indique el tipo de documento.");
  if (docType !== null && !(DOC_TYPES as readonly string[]).includes(docType)) {
    throw invalid("docType", "El tipo de documento debe ser CI, NIT, PASSPORT u OTHER.");
  }
  if (docType !== null && docNumber === null) throw invalid("docNumber", "Indique el número de documento.");
  if (complement !== null) {
    if (complement.length > 3) throw invalid("complement", "El complemento admite hasta 3 caracteres.");
    if (docType !== "CI") throw invalid("complement", "El complemento solo aplica a la cédula de identidad.");
  }
}

function checkEmail(email: string | null): void {
  if (email !== null && (email.length > 160 || !emailPattern.test(email))) throw invalid("email", "El correo no es válido.");
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function page(value: unknown, field: string, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw invalid(field, "El valor está fuera de rango.");
  }
  return value;
}

@Injectable()
export class CustomersService {
  private readonly features: FeatureService;
  private readonly audit = new AuditService();

  constructor(@Inject(TenantDatabase) private readonly database: TenantDatabase) {
    this.features = new FeatureService(database);
  }

  async list(scope: TenantScope, query: CustomerListQuery): Promise<CustomerListResult> {
    await requireFeature(this.features, scope, CUSTOMERS_FEATURE);
    const limit = page(query.limit, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = page(query.offset, "offset", 0, 0, 1_000_000);
    if (query.active !== undefined && query.active !== "true" && query.active !== "false") {
      throw invalid("active", "El filtro de estado debe ser true o false.");
    }
    const withLoyalty = await featureEnabled(this.features, scope, LOYALTY_FEATURE);
    const params: unknown[] = [scope.tenantId];
    const conditions = ["c.tenant_id = $1"];
    const term = typeof query.q === "string" ? query.q.trim() : "";
    if (term) {
      params.push(`%${escapeLike(term)}%`);
      conditions.push(`(c.full_name ilike $${params.length} escape '\\' or c.doc_number ilike $${params.length} escape '\\')`);
    }
    if (query.active !== undefined) {
      params.push(query.active === "true");
      conditions.push(`c.is_active = $${params.length}`);
    }
    const where = conditions.join(" and ");
    return this.database.withScope(scope, async (client) => {
      const count = await client.query<{ total: number }>(`select count(*)::int as total from customers c where ${where}`, params);
      const rows = await client.query<CustomerRow>(
        `${selectCustomer(withLoyalty)} where ${where} order by c.full_name, c.id limit ${limit} offset ${offset}`,
        params
      );
      return { items: rows.rows.map(toCustomer), total: count.rows[0]?.total ?? 0, limit, offset };
    });
  }

  async detail(scope: TenantScope, customerId: string): Promise<Customer> {
    await requireFeature(this.features, scope, CUSTOMERS_FEATURE);
    const withLoyalty = await featureEnabled(this.features, scope, LOYALTY_FEATURE);
    return this.database.withScope(scope, (client) => this.load(client, scope, customerId, withLoyalty));
  }

  async create(scope: TenantScope, input: CustomerInput): Promise<Customer> {
    await requireFeature(this.features, scope, CUSTOMERS_FEATURE);
    const fullName = requiredName(input?.fullName);
    const docType = optionalText(input.docType, "docType", 10);
    const docNumber = optionalText(input.docNumber, "docNumber", 30);
    const complement = optionalText(input.complement, "complement", 3);
    const email = optionalText(input.email, "email", 160);
    checkDocument(docType, docNumber, complement);
    checkEmail(email);
    const phone = optionalText(input.phone, "phone", 30);
    const notes = optionalText(input.notes, "notes", 500);
    const withLoyalty = await featureEnabled(this.features, scope, LOYALTY_FEATURE);
    return this.database.withScope(scope, async (client) => {
      await this.assertDocumentFree(client, scope, docType, docNumber, null);
      const inserted = await client.query<{ id: string }>(
        `insert into customers (tenant_id, full_name, doc_type, doc_number, complement, phone, email, notes)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [scope.tenantId, fullName, docType, docNumber, complement, phone, email, notes]
      );
      const customerId = inserted.rows[0]!.id;
      await this.audit.recordInTransaction(client, scope, {
        action: "crm.customer.created",
        entityType: "customer",
        entityId: customerId,
        payload: { fullName, docType, docNumber }
      });
      return this.load(client, scope, customerId, withLoyalty);
    });
  }

  async update(scope: TenantScope, customerId: string, input: CustomerInput): Promise<Customer> {
    await requireFeature(this.features, scope, CUSTOMERS_FEATURE);
    if (!uuidPattern.test(customerId ?? "")) throw notFound();
    const withLoyalty = await featureEnabled(this.features, scope, LOYALTY_FEATURE);
    return this.database.withScope(scope, async (client) => {
      const current = await client.query<CustomerRow>(`${selectCustomer(false)} where c.tenant_id = $1 and c.id = $2 for update of c`, [scope.tenantId, customerId]);
      const row = current.rows[0];
      if (!row) throw notFound();
      const next = {
        fullName: has(input, "fullName") ? requiredName(input.fullName) : row.fullName,
        docType: has(input, "docType") ? optionalText(input.docType, "docType", 10) : row.docType,
        docNumber: has(input, "docNumber") ? optionalText(input.docNumber, "docNumber", 30) : row.docNumber,
        complement: has(input, "complement") ? optionalText(input.complement, "complement", 3) : row.complement,
        phone: has(input, "phone") ? optionalText(input.phone, "phone", 30) : row.phone,
        email: has(input, "email") ? optionalText(input.email, "email", 160) : row.email,
        notes: has(input, "notes") ? optionalText(input.notes, "notes", 500) : row.notes,
        isActive: row.isActive
      };
      if (has(input, "isActive")) {
        if (typeof input.isActive !== "boolean") throw invalid("isActive", "El estado no es válido.");
        next.isActive = input.isActive;
      }
      checkDocument(next.docType, next.docNumber, next.complement);
      checkEmail(next.email);
      await this.assertDocumentFree(client, scope, next.docType, next.docNumber, customerId);
      await client.query(
        `update customers set full_name = $3, doc_type = $4, doc_number = $5, complement = $6, phone = $7, email = $8,
                notes = $9, is_active = $10, updated_at = now()
         where tenant_id = $1 and id = $2`,
        [scope.tenantId, customerId, next.fullName, next.docType, next.docNumber, next.complement, next.phone, next.email, next.notes, next.isActive]
      );
      await this.audit.recordInTransaction(client, scope, {
        action: "crm.customer.updated",
        entityType: "customer",
        entityId: customerId,
        payload: { fullName: next.fullName, docType: next.docType, docNumber: next.docNumber, isActive: next.isActive }
      });
      return this.load(client, scope, customerId, withLoyalty);
    });
  }

  /** Sales of the active branch for this customer, net of returns (D66: sales are branch-scoped). */
  async purchases(scope: TenantScope, customerId: string, query: PurchaseHistoryQuery): Promise<PurchaseHistory> {
    await requireFeature(this.features, scope, CUSTOMERS_FEATURE);
    if (!uuidPattern.test(customerId ?? "")) throw notFound();
    const from = optionalDate(query.from, "from");
    const to = optionalDate(query.to, "to");
    const limit = page(query.limit, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = page(query.offset, "offset", 0, 0, 1_000_000);
    const params: unknown[] = [scope.tenantId, scope.branchId, customerId];
    const conditions = ["s.tenant_id = $1", "s.branch_id = $2", "s.customer_id = $3"];
    if (from) {
      params.push(from);
      conditions.push(`s.created_at >= ($${params.length}::date::timestamp at time zone '${ZONE}')`);
    }
    if (to) {
      params.push(to);
      conditions.push(`s.created_at < (($${params.length}::date + 1)::timestamp at time zone '${ZONE}')`);
    }
    const where = conditions.join(" and ");
    const refunded = `coalesce((select sum(r.refund_amount_bob) from sale_returns r
      where r.tenant_id = s.tenant_id and r.branch_id = s.branch_id and r.sale_id = s.id), 0)`;
    return this.database.withScope(scope, async (client) => {
      const exists = await client.query("select 1 from customers where tenant_id = $1 and id = $2", [scope.tenantId, customerId]);
      if (!exists.rowCount) throw notFound();
      const summary = await client.query<{ total: number; salesCount: number; netTotalBob: string }>(
        `select count(*)::int as total,
                (count(*) filter (where s.status <> 'VOIDED'))::int as "salesCount",
                coalesce(sum(s.total_amount_bob - ${refunded}) filter (where s.status <> 'VOIDED'), 0)::numeric(18,4)::text as "netTotalBob"
         from sales s where ${where}`,
        params
      );
      const rows = await client.query<{ id: string; number: string; createdAt: Date; status: string; totalBob: string; refundedBob: string; netBob: string }>(
        `select s.id, s.sale_number as number, s.created_at as "createdAt", s.status,
                s.total_amount_bob::numeric(18,4)::text as "totalBob",
                (${refunded})::numeric(18,4)::text as "refundedBob",
                (case when s.status = 'VOIDED' then 0 else s.total_amount_bob - ${refunded} end)::numeric(18,4)::text as "netBob"
         from sales s where ${where}
         order by s.created_at desc, s.id desc limit ${limit} offset ${offset}`,
        params
      );
      const totals = summary.rows[0]!;
      return {
        customerId,
        items: rows.rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
        total: totals.total,
        limit,
        offset,
        summary: { salesCount: totals.salesCount, netTotalBob: totals.netTotalBob }
      };
    });
  }

  private async load(client: PoolClient, scope: TenantScope, customerId: string, withLoyalty: boolean): Promise<Customer> {
    if (!uuidPattern.test(customerId ?? "")) throw notFound();
    const result = await client.query<CustomerRow>(`${selectCustomer(withLoyalty)} where c.tenant_id = $1 and c.id = $2`, [scope.tenantId, customerId]);
    const row = result.rows[0];
    if (!row) throw notFound();
    return toCustomer(row);
  }

  private async assertDocumentFree(
    client: PoolClient,
    scope: TenantScope,
    docType: string | null,
    docNumber: string | null,
    exceptId: string | null
  ): Promise<void> {
    if (docNumber === null) return;
    const clash = await client.query(
      `select 1 from customers where tenant_id = $1 and doc_type = $2 and doc_number = $3 and ($4::uuid is null or id <> $4::uuid)`,
      [scope.tenantId, docType, docNumber, exceptId]
    );
    if (clash.rowCount) {
      throw new ConflictException({ code: "CUSTOMER_DOCUMENT_EXISTS", message: "Ya existe un cliente con ese documento." });
    }
  }
}

function notFound(): NotFoundException {
  return new NotFoundException({ code: "CUSTOMER_NOT_FOUND", message: "Cliente no encontrado." });
}

function selectCustomer(withLoyalty: boolean): string {
  const balance = withLoyalty
    ? `(select coalesce(sum(m.points), 0)::text from loyalty_movements m where m.tenant_id = c.tenant_id and m.customer_id = c.id)`
    : "null::text";
  return `select c.id, c.full_name as "fullName", c.doc_type as "docType", c.doc_number as "docNumber", c.complement,
                 c.phone, c.email, c.notes, c.is_active as "isActive", ${balance} as "loyaltyBalance",
                 c.created_at as "createdAt", c.updated_at as "updatedAt"
          from customers c`;
}
