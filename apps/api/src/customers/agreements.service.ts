import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { TenantDatabase, type TenantScope } from "../database/tenant-database.js";
import { usedCreditSql } from "../sales/sales-agreements.js";
import { FeatureService } from "../subscriptions/feature.service.js";
import { AuditService } from "../transversal/audit.service.js";
import { ZONE, invalid, requireFeature, requireUuid, uuidPattern } from "../staff/staff.common.js";

export const AGREEMENTS_FEATURE = "crm.agreements";
const KINDS = ["INSURER", "COMPANY", "UNION"] as const;
export type AgreementKind = (typeof KINDS)[number];
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const moneyPattern = /^\d{1,14}(?:\.\d{1,4})?$/;
const percentPattern = /^\d{1,3}(?:\.\d{1,2})?$/;

export interface Agreement {
  id: string;
  name: string;
  kind: AgreementKind;
  payerName: string;
  payerTaxId: string | null;
  /** Percent of each sale the agreement covers, e.g. "80.00". */
  coveragePercent: string;
  /** Default monthly credit per member in BOB. */
  monthlyLimitBob: string;
  notes: string | null;
  isActive: boolean;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgreementInput {
  name?: string;
  kind?: string;
  payerName?: string;
  payerTaxId?: string | null;
  coveragePercent?: number | string;
  monthlyLimitBob?: number | string;
  notes?: string | null;
  isActive?: boolean;
}

export interface AgreementListQuery {
  q?: string;
  /** "true" | "false"; omitted = both. */
  active?: string;
  limit?: number;
  offset?: number;
}

export interface AgreementListResult {
  items: Agreement[];
  total: number;
  limit: number;
  offset: number;
}

export interface AgreementMember {
  id: string;
  agreementId: string;
  customerId: string;
  customerName: string;
  docType: string | null;
  docNumber: string | null;
  memberCode: string;
  /** The member's own monthly limit; null = the agreement default applies. */
  monthlyLimitBob: string | null;
  effectiveLimitBob: string;
  /** Credit used in the current La Paz month (non-voided charges net of reductions). */
  usedBob: string;
  remainingBob: string;
  isActive: boolean;
  createdAt: string;
}

export interface AgreementMemberInput {
  customerId?: string;
  memberCode?: string;
  /** null clears the override (the agreement default applies). */
  monthlyLimitBob?: number | string | null;
  isActive?: boolean;
}

/** One active enrolment of a customer, as the POS picker needs it. */
export interface CustomerAgreement {
  agreementId: string;
  name: string;
  kind: AgreementKind;
  coveragePercent: string;
  memberId: string;
  memberCode: string;
  monthlyLimitBob: string;
  usedBob: string;
  remainingBob: string;
}

interface AgreementRow extends Omit<Agreement, "createdAt" | "updatedAt"> {
  createdAt: Date;
  updatedAt: Date;
}

interface MemberRow extends Omit<AgreementMember, "createdAt"> {
  createdAt: Date;
}

function has(input: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key) && (input as Record<string, unknown>)[key] !== undefined;
}

function text(value: unknown, field: string, max: number, required: boolean): string | null {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    if (required) throw invalid(field, "El campo es obligatorio.");
    return null;
  }
  if (typeof value !== "string") throw invalid(field, "El valor no es válido.");
  const trimmed = value.trim();
  if (trimmed.length > max) throw invalid(field, `Máximo ${max} caracteres.`);
  return trimmed;
}

function money(value: unknown, field: string): string {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!moneyPattern.test(raw) || Number(raw) <= 0) throw invalid(field, "Indique un monto positivo con hasta 4 decimales.");
  return raw;
}

function percent(value: unknown, field: string): string {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!percentPattern.test(raw) || Number(raw) <= 0 || Number(raw) > 100) throw invalid(field, "Indique un porcentaje mayor que 0 y hasta 100, con hasta 2 decimales.");
  return raw;
}

function kind(value: unknown): AgreementKind {
  if (typeof value !== "string" || !(KINDS as readonly string[]).includes(value)) {
    throw invalid("kind", "El tipo debe ser INSURER, COMPANY o UNION.");
  }
  return value as AgreementKind;
}

function page(value: unknown, field: string, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw invalid(field, "El valor está fuera de rango.");
  return value;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

const agreementNotFound = (): NotFoundException => new NotFoundException({ code: "AGREEMENT_NOT_FOUND", message: "Convenio no encontrado." });
const memberNotFound = (): NotFoundException => new NotFoundException({ code: "AGREEMENT_MEMBER_NOT_FOUND", message: "Afiliado no encontrado." });

const selectAgreement = `select a.id, a.name, a.kind, a.payer_name as "payerName", a.payer_tax_id as "payerTaxId",
       a.coverage_percent::text as "coveragePercent", a.monthly_limit_bob::text as "monthlyLimitBob", a.notes,
       a.is_active as "isActive",
       (select count(*) from agreement_members m where m.tenant_id = a.tenant_id and m.agreement_id = a.id)::int as "memberCount",
       a.created_at as "createdAt", a.updated_at as "updatedAt"
     from agreements a`;

const selectMember = `select m.id, m.agreement_id as "agreementId", m.customer_id as "customerId", c.full_name as "customerName",
       c.doc_type as "docType", c.doc_number as "docNumber", m.member_code as "memberCode",
       m.monthly_limit_bob::text as "monthlyLimitBob",
       coalesce(m.monthly_limit_bob, a.monthly_limit_bob)::numeric(18,4)::text as "effectiveLimitBob",
       ${usedCreditSql("m", "$2")}::text as "usedBob",
       greatest(coalesce(m.monthly_limit_bob, a.monthly_limit_bob) - ${usedCreditSql("m", "$2")}, 0)::numeric(18,4)::text as "remainingBob",
       m.is_active as "isActive", m.created_at as "createdAt"
     from agreement_members m
     join agreements a on a.tenant_id = m.tenant_id and a.id = m.agreement_id
     join customers c on c.tenant_id = m.tenant_id and c.id = m.customer_id`;

const toAgreement = (row: AgreementRow): Agreement => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
const toMember = (row: MemberRow): AgreementMember => ({ ...row, createdAt: row.createdAt.toISOString() });

/** Agreements (insurers, companies, unions) and their members: tenant-wide, Premium plan (crm.agreements). */
@Injectable()
export class AgreementsService {
  private readonly features: FeatureService;
  private readonly audit = new AuditService();

  constructor(@Inject(TenantDatabase) private readonly database: TenantDatabase) {
    this.features = new FeatureService(database);
  }

  async list(scope: TenantScope, query: AgreementListQuery): Promise<AgreementListResult> {
    await requireFeature(this.features, scope, AGREEMENTS_FEATURE);
    const limit = page(query.limit, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = page(query.offset, "offset", 0, 0, 1_000_000);
    if (query.active !== undefined && query.active !== "true" && query.active !== "false") {
      throw invalid("active", "El filtro de estado debe ser true o false.");
    }
    const params: unknown[] = [scope.tenantId];
    const conditions = ["a.tenant_id = $1"];
    const term = typeof query.q === "string" ? query.q.trim() : "";
    if (term) {
      params.push(`%${escapeLike(term)}%`);
      conditions.push(`(a.name ilike $${params.length} escape '\\' or a.payer_name ilike $${params.length} escape '\\')`);
    }
    if (query.active !== undefined) {
      params.push(query.active === "true");
      conditions.push(`a.is_active = $${params.length}`);
    }
    const where = conditions.join(" and ");
    return this.database.withScope(scope, async (client) => {
      const count = await client.query<{ total: number }>(`select count(*)::int as total from agreements a where ${where}`, params);
      const rows = await client.query<AgreementRow>(`${selectAgreement} where ${where} order by a.name, a.id limit ${limit} offset ${offset}`, params);
      return { items: rows.rows.map(toAgreement), total: count.rows[0]?.total ?? 0, limit, offset };
    });
  }

  async detail(scope: TenantScope, agreementId: string): Promise<Agreement> {
    await requireFeature(this.features, scope, AGREEMENTS_FEATURE);
    return this.database.withScope(scope, (client) => this.load(client, scope, agreementId));
  }

  async create(scope: TenantScope, input: AgreementInput): Promise<Agreement> {
    await requireFeature(this.features, scope, AGREEMENTS_FEATURE);
    const name = text(input?.name, "name", 120, true)!;
    const values = {
      kind: kind(input.kind),
      payerName: text(input.payerName, "payerName", 160, true)!,
      payerTaxId: text(input.payerTaxId, "payerTaxId", 30, false),
      coveragePercent: percent(input.coveragePercent, "coveragePercent"),
      monthlyLimitBob: money(input.monthlyLimitBob, "monthlyLimitBob"),
      notes: text(input.notes, "notes", 500, false)
    };
    return this.database.withScope(scope, async (client) => {
      await this.assertNameFree(client, scope, name, null);
      const inserted = await client.query<{ id: string }>(
        `insert into agreements (tenant_id, name, kind, payer_name, payer_tax_id, coverage_percent, monthly_limit_bob, notes)
         values ($1, $2, $3, $4, $5, $6::numeric, $7::numeric, $8) returning id`,
        [scope.tenantId, name, values.kind, values.payerName, values.payerTaxId, values.coveragePercent, values.monthlyLimitBob, values.notes]
      );
      const agreementId = inserted.rows[0]!.id;
      await this.audit.recordInTransaction(client, scope, {
        action: "crm.agreement.created",
        entityType: "agreement",
        entityId: agreementId,
        payload: { name, kind: values.kind, coveragePercent: values.coveragePercent, monthlyLimitBob: values.monthlyLimitBob }
      });
      return this.load(client, scope, agreementId);
    });
  }

  async update(scope: TenantScope, agreementId: string, input: AgreementInput): Promise<Agreement> {
    await requireFeature(this.features, scope, AGREEMENTS_FEATURE);
    if (!uuidPattern.test(agreementId ?? "")) throw agreementNotFound();
    return this.database.withScope(scope, async (client) => {
      const current = await client.query<AgreementRow>(`${selectAgreement} where a.tenant_id = $1 and a.id = $2 for update of a`, [scope.tenantId, agreementId]);
      const row = current.rows[0];
      if (!row) throw agreementNotFound();
      const next = {
        name: has(input, "name") ? text(input.name, "name", 120, true)! : row.name,
        kind: has(input, "kind") ? kind(input.kind) : row.kind,
        payerName: has(input, "payerName") ? text(input.payerName, "payerName", 160, true)! : row.payerName,
        payerTaxId: has(input, "payerTaxId") ? text(input.payerTaxId, "payerTaxId", 30, false) : row.payerTaxId,
        coveragePercent: has(input, "coveragePercent") ? percent(input.coveragePercent, "coveragePercent") : row.coveragePercent,
        monthlyLimitBob: has(input, "monthlyLimitBob") ? money(input.monthlyLimitBob, "monthlyLimitBob") : row.monthlyLimitBob,
        notes: has(input, "notes") ? text(input.notes, "notes", 500, false) : row.notes,
        isActive: row.isActive
      };
      if (has(input, "isActive")) {
        if (typeof input.isActive !== "boolean") throw invalid("isActive", "El estado no es válido.");
        next.isActive = input.isActive;
      }
      await this.assertNameFree(client, scope, next.name, agreementId);
      await client.query(
        `update agreements set name = $3, kind = $4, payer_name = $5, payer_tax_id = $6, coverage_percent = $7::numeric,
                monthly_limit_bob = $8::numeric, notes = $9, is_active = $10, updated_at = now()
         where tenant_id = $1 and id = $2`,
        [scope.tenantId, agreementId, next.name, next.kind, next.payerName, next.payerTaxId, next.coveragePercent, next.monthlyLimitBob, next.notes, next.isActive]
      );
      await this.audit.recordInTransaction(client, scope, {
        action: "crm.agreement.updated",
        entityType: "agreement",
        entityId: agreementId,
        payload: { name: next.name, coveragePercent: next.coveragePercent, monthlyLimitBob: next.monthlyLimitBob, isActive: next.isActive }
      });
      return this.load(client, scope, agreementId);
    });
  }

  async listMembers(scope: TenantScope, agreementId: string): Promise<{ items: AgreementMember[] }> {
    await requireFeature(this.features, scope, AGREEMENTS_FEATURE);
    if (!uuidPattern.test(agreementId ?? "")) throw agreementNotFound();
    return this.database.withScope(scope, async (client) => {
      await this.load(client, scope, agreementId);
      const rows = await client.query<MemberRow>(
        `${selectMember} where m.tenant_id = $1 and m.agreement_id = $3 order by c.full_name, m.id`,
        [scope.tenantId, ZONE, agreementId]
      );
      return { items: rows.rows.map(toMember) };
    });
  }

  async addMember(scope: TenantScope, agreementId: string, input: AgreementMemberInput): Promise<AgreementMember> {
    await requireFeature(this.features, scope, AGREEMENTS_FEATURE);
    if (!uuidPattern.test(agreementId ?? "")) throw agreementNotFound();
    const customerId = requireUuid(input?.customerId, "customerId");
    const memberCode = text(input.memberCode, "memberCode", 40, true)!;
    const limit = input.monthlyLimitBob === undefined || input.monthlyLimitBob === null ? null : money(input.monthlyLimitBob, "monthlyLimitBob");
    return this.database.withScope(scope, async (client) => {
      await this.load(client, scope, agreementId);
      const customer = await client.query("select 1 from customers where tenant_id = $1 and id = $2", [scope.tenantId, customerId]);
      if (!customer.rowCount) throw new NotFoundException({ code: "CUSTOMER_NOT_FOUND", message: "Cliente no encontrado." });
      await this.assertMemberFree(client, scope, agreementId, customerId, memberCode, null);
      const inserted = await client.query<{ id: string }>(
        `insert into agreement_members (tenant_id, agreement_id, customer_id, member_code, monthly_limit_bob)
         values ($1, $2, $3, $4, $5::numeric) returning id`,
        [scope.tenantId, agreementId, customerId, memberCode, limit]
      );
      const memberId = inserted.rows[0]!.id;
      await this.audit.recordInTransaction(client, scope, {
        action: "crm.agreement_member.added",
        entityType: "agreement_member",
        entityId: memberId,
        payload: { agreementId, customerId, memberCode, monthlyLimitBob: limit }
      });
      return this.loadMember(client, scope, agreementId, memberId);
    });
  }

  async updateMember(scope: TenantScope, agreementId: string, memberId: string, input: AgreementMemberInput): Promise<AgreementMember> {
    await requireFeature(this.features, scope, AGREEMENTS_FEATURE);
    if (!uuidPattern.test(agreementId ?? "")) throw agreementNotFound();
    if (!uuidPattern.test(memberId ?? "")) throw memberNotFound();
    return this.database.withScope(scope, async (client) => {
      const current = await client.query<{ customerId: string; memberCode: string; limit: string | null; isActive: boolean }>(
        `select customer_id as "customerId", member_code as "memberCode", monthly_limit_bob::text as "limit", is_active as "isActive"
         from agreement_members where tenant_id = $1 and agreement_id = $2 and id = $3 for update`,
        [scope.tenantId, agreementId, memberId]
      );
      const row = current.rows[0];
      if (!row) throw memberNotFound();
      const next = {
        memberCode: has(input, "memberCode") ? text(input.memberCode, "memberCode", 40, true)! : row.memberCode,
        limit: has(input, "monthlyLimitBob") ? (input.monthlyLimitBob === null ? null : money(input.monthlyLimitBob, "monthlyLimitBob")) : row.limit,
        isActive: row.isActive
      };
      if (has(input, "isActive")) {
        if (typeof input.isActive !== "boolean") throw invalid("isActive", "El estado no es válido.");
        next.isActive = input.isActive;
      }
      await this.assertMemberFree(client, scope, agreementId, row.customerId, next.memberCode, memberId);
      await client.query(
        `update agreement_members set member_code = $3, monthly_limit_bob = $4::numeric, is_active = $5, updated_at = now()
         where tenant_id = $1 and id = $2`,
        [scope.tenantId, memberId, next.memberCode, next.limit, next.isActive]
      );
      await this.audit.recordInTransaction(client, scope, {
        action: "crm.agreement_member.updated",
        entityType: "agreement_member",
        entityId: memberId,
        payload: { agreementId, memberCode: next.memberCode, monthlyLimitBob: next.limit, isActive: next.isActive }
      });
      return this.loadMember(client, scope, agreementId, memberId);
    });
  }

  /** Active enrolments of a customer in active agreements, with the credit left this La Paz month (POS picker). */
  async customerAgreements(scope: TenantScope, customerId: string): Promise<{ items: CustomerAgreement[] }> {
    await requireFeature(this.features, scope, AGREEMENTS_FEATURE);
    if (!uuidPattern.test(customerId ?? "")) throw new NotFoundException({ code: "CUSTOMER_NOT_FOUND", message: "Cliente no encontrado." });
    return this.database.withScope(scope, async (client) => {
      const exists = await client.query("select 1 from customers where tenant_id = $1 and id = $2", [scope.tenantId, customerId]);
      if (!exists.rowCount) throw new NotFoundException({ code: "CUSTOMER_NOT_FOUND", message: "Cliente no encontrado." });
      const rows = await client.query<CustomerAgreement>(
        `select a.id as "agreementId", a.name, a.kind, a.coverage_percent::text as "coveragePercent",
                m.id as "memberId", m.member_code as "memberCode",
                coalesce(m.monthly_limit_bob, a.monthly_limit_bob)::numeric(18,4)::text as "monthlyLimitBob",
                ${usedCreditSql("m", "$3")}::text as "usedBob",
                greatest(coalesce(m.monthly_limit_bob, a.monthly_limit_bob) - ${usedCreditSql("m", "$3")}, 0)::numeric(18,4)::text as "remainingBob"
         from agreement_members m
         join agreements a on a.tenant_id = m.tenant_id and a.id = m.agreement_id
         where m.tenant_id = $1 and m.customer_id = $2 and m.is_active and a.is_active
         order by a.name, a.id`,
        [scope.tenantId, customerId, ZONE]
      );
      return { items: rows.rows };
    });
  }

  private async load(client: PoolClient, scope: TenantScope, agreementId: string): Promise<Agreement> {
    if (!uuidPattern.test(agreementId ?? "")) throw agreementNotFound();
    const result = await client.query<AgreementRow>(`${selectAgreement} where a.tenant_id = $1 and a.id = $2`, [scope.tenantId, agreementId]);
    const row = result.rows[0];
    if (!row) throw agreementNotFound();
    return toAgreement(row);
  }

  private async loadMember(client: PoolClient, scope: TenantScope, agreementId: string, memberId: string): Promise<AgreementMember> {
    const result = await client.query<MemberRow>(
      `${selectMember} where m.tenant_id = $1 and m.agreement_id = $3 and m.id = $4`,
      [scope.tenantId, ZONE, agreementId, memberId]
    );
    const row = result.rows[0];
    if (!row) throw memberNotFound();
    return toMember(row);
  }

  private async assertNameFree(client: PoolClient, scope: TenantScope, name: string, exceptId: string | null): Promise<void> {
    const clash = await client.query(
      "select 1 from agreements where tenant_id = $1 and name = $2 and ($3::uuid is null or id <> $3::uuid)",
      [scope.tenantId, name, exceptId]
    );
    if (clash.rowCount) throw new ConflictException({ code: "AGREEMENT_NAME_EXISTS", message: "Ya existe un convenio con ese nombre." });
  }

  private async assertMemberFree(
    client: PoolClient,
    scope: TenantScope,
    agreementId: string,
    customerId: string,
    memberCode: string,
    exceptId: string | null
  ): Promise<void> {
    const sameCustomer = await client.query(
      "select 1 from agreement_members where tenant_id = $1 and agreement_id = $2 and customer_id = $3 and ($4::uuid is null or id <> $4::uuid)",
      [scope.tenantId, agreementId, customerId, exceptId]
    );
    if (sameCustomer.rowCount) {
      throw new ConflictException({ code: "AGREEMENT_MEMBER_EXISTS", message: "El cliente ya está afiliado a este convenio." });
    }
    const sameCode = await client.query(
      "select 1 from agreement_members where tenant_id = $1 and agreement_id = $2 and member_code = $3 and ($4::uuid is null or id <> $4::uuid)",
      [scope.tenantId, agreementId, memberCode, exceptId]
    );
    if (sameCode.rowCount) {
      throw new ConflictException({ code: "AGREEMENT_MEMBER_CODE_EXISTS", message: "Ese código de afiliado ya existe en el convenio." });
    }
  }
}
