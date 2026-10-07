import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { TenantDatabase, type TenantScope } from "../database/tenant-database.js";
import { fromUnits, toUnits } from "../sales/sales-money.js";
import { FeatureService } from "../subscriptions/feature.service.js";
import { AuditService } from "../transversal/audit.service.js";
import { DocumentSequenceService } from "../transversal/document-sequence.service.js";
import { IdempotencyKeyReusedError, IdempotencyService, type IdempotentExecutionResult } from "../transversal/idempotency.service.js";
import { ZONE, invalid, isRealDate, requireFeature, uuidPattern } from "../staff/staff.common.js";
import { AGREEMENTS_FEATURE } from "./agreements.service.js";

const STATUSES = ["ISSUED", "PARTIAL", "PAID"] as const;
export type StatementStatus = (typeof STATUSES)[number];
const PAYMENT_METHODS = ["TRANSFER", "CHECK", "CASH", "QR", "OTHER"] as const;
export type StatementPaymentMethod = (typeof PAYMENT_METHODS)[number];
const periodPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const amountPattern = /^\d{1,14}(?:\.\d{1,4})?$/;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface StatementLine {
  chargeId: string;
  branchCode: string;
  saleNumber: string;
  /** Sale date (ISO) of the charge. */
  saleDate: string;
  customerName: string;
  memberCode: string;
  /** Charge net of reductions by returns. */
  amountBob: string;
}

export interface StatementPreview {
  agreementId: string;
  agreementName: string;
  period: string;
  lineCount: number;
  totalBob: string;
  lines: StatementLine[];
}

export interface StatementPayment {
  id: string;
  amountBob: string;
  method: StatementPaymentMethod;
  reference: string | null;
  paidOn: string;
  createdByName: string | null;
  createdAt: string;
}

export interface StatementSummary {
  id: string;
  agreementId: string;
  agreementName: string;
  period: string;
  number: string;
  totalBob: string;
  paidBob: string;
  balanceBob: string;
  status: StatementStatus;
  lineCount: number;
  issuedAt: string;
  issuedByName: string | null;
}

export interface StatementDetail extends StatementSummary {
  payerName: string;
  payerTaxId: string | null;
  coveragePercent: string;
  lines: StatementLine[];
  payments: StatementPayment[];
}

export interface StatementListQuery {
  agreementId?: string;
  period?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface StatementListResult {
  items: StatementSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface StatementPaymentInput {
  idempotencyKey: string;
  amountBob: number | string;
  method: string;
  paidOn: string;
  reference?: string | null;
}

export interface StatementPaymentResult {
  paymentId: string;
  statementId: string;
  amountBob: string;
  paidBob: string;
  balanceBob: string;
  status: StatementStatus;
}

interface LineRow extends Omit<StatementLine, "saleDate"> {
  saleDate: Date;
}

const statementNotFound = (): NotFoundException => new NotFoundException({ code: "STATEMENT_NOT_FOUND", message: "Estado de cuenta no encontrado." });
const agreementNotFound = (): NotFoundException => new NotFoundException({ code: "AGREEMENT_NOT_FOUND", message: "Convenio no encontrado." });

function periodValue(value: unknown): string {
  if (typeof value !== "string" || !periodPattern.test(value.trim())) throw invalid("period", "El periodo debe tener el formato AAAA-MM.");
  return value.trim();
}

function page(value: unknown, field: string, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw invalid(field, "El valor está fuera de rango.");
  return value;
}

function csvCell(value: string): string {
  // Spreadsheet formula guard: a text cell never starts with = + - @.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const summarySql = (extraColumns = ""): string => `select s.id, s.agreement_id as "agreementId", a.name as "agreementName", s.period, s.statement_number as number,
       s.total_bob::numeric(18,4)::text as "totalBob", s.paid_bob::numeric(18,4)::text as "paidBob",
       (s.total_bob - s.paid_bob)::numeric(18,4)::text as "balanceBob", s.status,
       (select count(*) from agreement_charges ch where ch.tenant_id = s.tenant_id and ch.statement_id = s.id)::int as "lineCount",
       s.issued_at as "issuedAt", s.issued_by_name as "issuedByName"${extraColumns}
     from agreement_statements s
     join agreements a on a.tenant_id = s.tenant_id and a.id = s.agreement_id`;

const lineSelect = `select ch.id as "chargeId", ch.branch_code as "branchCode", ch.sale_number as "saleNumber", ch.created_at as "saleDate",
       c.full_name as "customerName", m.member_code as "memberCode",
       (ch.amount_bob - ch.reduced_amount_bob)::numeric(18,4)::text as "amountBob"
     from agreement_charges ch
     join customers c on c.tenant_id = ch.tenant_id and c.id = ch.customer_id
     join agreement_members m on m.tenant_id = ch.tenant_id and m.id = ch.member_id`;

const toLine = ({ saleDate, ...line }: LineRow): StatementLine => ({ ...line, saleDate: saleDate.toISOString() });

/**
 * Monthly, non-fiscal statement per agreement (D71): consolidates the OPEN charges of every branch for the La Paz
 * month, and records the payments of the payer manually (never above the balance). Requires crm.agreements and,
 * at the HTTP layer, agreements.billing.
 */
@Injectable()
export class AgreementStatementsService {
  private readonly features: FeatureService;
  private readonly audit = new AuditService();
  private readonly idempotency = new IdempotencyService();
  private readonly sequences = new DocumentSequenceService();

  constructor(@Inject(TenantDatabase) private readonly database: TenantDatabase) {
    this.features = new FeatureService(database);
  }

  /** Unbilled charges of the agreement and month, across all branches. */
  async preview(scope: TenantScope, input: { agreementId: string; period: string }): Promise<StatementPreview> {
    await requireFeature(this.features, scope, AGREEMENTS_FEATURE);
    const period = periodValue(input?.period);
    if (!uuidPattern.test(input.agreementId ?? "")) throw agreementNotFound();
    return this.database.withScope(scope, async (client) => {
      const agreement = await this.loadAgreement(client, scope, input.agreementId, false);
      const lines = await this.openCharges(client, scope, input.agreementId, period, false);
      return { agreementId: agreement.id, agreementName: agreement.name, period, lineCount: lines.length, totalBob: sum(lines), lines };
    });
  }

  async issue(scope: TenantScope, input: { agreementId: string; period: string }): Promise<StatementDetail> {
    await requireFeature(this.features, scope, AGREEMENTS_FEATURE);
    const period = periodValue(input?.period);
    if (!uuidPattern.test(input.agreementId ?? "")) throw agreementNotFound();
    return this.database.withScope(scope, async (client) => {
      const agreement = await this.loadAgreement(client, scope, input.agreementId, true);
      const current = await client.query<{ p: string }>("select to_char(now() at time zone $1, 'YYYY-MM') as p", [ZONE]);
      if (period > current.rows[0]!.p) throw invalid("period", "No se puede emitir un estado de cuenta de un mes futuro.");
      const existing = await client.query("select 1 from agreement_statements where tenant_id = $1 and agreement_id = $2 and period = $3", [scope.tenantId, agreement.id, period]);
      if (existing.rowCount) {
        throw new ConflictException({ code: "AGREEMENT_STATEMENT_EXISTS", message: "Ya existe un estado de cuenta de este convenio para el periodo." });
      }
      const lines = await this.openCharges(client, scope, agreement.id, period, true);
      if (lines.length === 0) {
        throw new ConflictException({ code: "NO_CHARGES_TO_BILL", message: "El convenio no tiene cargos pendientes de facturar en el periodo." });
      }
      const total = sum(lines);
      const number = await this.nextNumber(client, scope);
      const inserted = await client.query<{ id: string }>(
        `insert into agreement_statements (tenant_id, agreement_id, period, statement_number, branch_id, total_bob, issued_by_user_id, issued_by_name)
         values ($1, $2, $3, $4, $5, $6::numeric, $7, $8) returning id`,
        [scope.tenantId, agreement.id, period, number, scope.branchId, total, scope.userId, await this.userName(client, scope)]
      );
      const statementId = inserted.rows[0]!.id;
      await client.query(
        `update agreement_charges set status = 'BILLED', statement_id = $3, updated_at = now()
         where tenant_id = $1 and id = any($2::uuid[])`,
        [scope.tenantId, lines.map((line) => line.chargeId), statementId]
      );
      await this.audit.recordInTransaction(client, scope, {
        action: "crm.agreement_statement.issued",
        entityType: "agreement_statement",
        entityId: statementId,
        payload: { agreementId: agreement.id, period, number, totalBob: total, lineCount: lines.length }
      });
      return this.loadDetail(client, scope, statementId);
    });
  }

  async list(scope: TenantScope, query: StatementListQuery): Promise<StatementListResult> {
    await requireFeature(this.features, scope, AGREEMENTS_FEATURE);
    const limit = page(query.limit, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = page(query.offset, "offset", 0, 0, 1_000_000);
    const params: unknown[] = [scope.tenantId];
    const conditions = ["s.tenant_id = $1"];
    if (query.agreementId !== undefined && query.agreementId !== "") {
      if (!uuidPattern.test(query.agreementId)) throw invalid("agreementId", "El identificador no es válido.");
      params.push(query.agreementId);
      conditions.push(`s.agreement_id = $${params.length}`);
    }
    if (query.period !== undefined && query.period !== "") {
      params.push(periodValue(query.period));
      conditions.push(`s.period = $${params.length}`);
    }
    if (query.status !== undefined && query.status !== "") {
      if (!(STATUSES as readonly string[]).includes(query.status)) throw invalid("status", "El estado debe ser ISSUED, PARTIAL o PAID.");
      params.push(query.status);
      conditions.push(`s.status = $${params.length}`);
    }
    const where = conditions.join(" and ");
    return this.database.withScope(scope, async (client) => {
      const count = await client.query<{ total: number }>(`select count(*)::int as total from agreement_statements s where ${where}`, params);
      const rows = await client.query<StatementSummary & { issuedAt: Date | string }>(
        `${summarySql()} where ${where} order by s.issued_at desc, s.id desc limit ${limit} offset ${offset}`,
        params
      );
      return {
        items: rows.rows.map((row) => ({ ...row, issuedAt: new Date(row.issuedAt).toISOString() })),
        total: count.rows[0]?.total ?? 0,
        limit,
        offset
      };
    });
  }

  async detail(scope: TenantScope, statementId: string): Promise<StatementDetail> {
    await requireFeature(this.features, scope, AGREEMENTS_FEATURE);
    return this.database.withScope(scope, (client) => this.loadDetail(client, scope, statementId));
  }

  /** Registers a payment of the payer: never above the balance, idempotent by key. */
  async registerPayment(scope: TenantScope, statementId: string, input: StatementPaymentInput): Promise<StatementPaymentResult> {
    await requireFeature(this.features, scope, AGREEMENTS_FEATURE);
    if (!uuidPattern.test(statementId ?? "")) throw statementNotFound();
    const idempotencyKey = typeof input?.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
    if (!idempotencyKey || idempotencyKey.length > 255) throw invalid("idempotencyKey", "Indique la clave de idempotencia (hasta 255 caracteres).");
    const rawAmount = typeof input.amountBob === "number" ? String(input.amountBob) : typeof input.amountBob === "string" ? input.amountBob.trim() : "";
    if (!amountPattern.test(rawAmount) || toUnits(rawAmount) <= 0n) throw invalid("amountBob", "Indique un monto positivo con hasta 4 decimales.");
    if (typeof input.method !== "string" || !(PAYMENT_METHODS as readonly string[]).includes(input.method)) {
      throw invalid("method", "El método debe ser TRANSFER, CHECK, CASH, QR u OTHER.");
    }
    if (typeof input.paidOn !== "string" || !isRealDate(input.paidOn)) throw invalid("paidOn", "La fecha de pago no es válida (use AAAA-MM-DD).");
    const reference = typeof input.reference === "string" ? input.reference.trim() : "";
    if (input.reference !== undefined && input.reference !== null && typeof input.reference !== "string") throw invalid("reference", "La referencia no es válida.");
    if (reference.length > 120) throw invalid("reference", "La referencia admite hasta 120 caracteres.");
    const normalized = {
      statementId,
      amountBob: fromUnits(toUnits(rawAmount)),
      method: input.method as StatementPaymentMethod,
      paidOn: input.paidOn,
      reference: reference || null
    };
    try {
      const result = await this.idempotency.execute(
        this.database,
        scope,
        "crm.agreement_statement_payment",
        idempotencyKey,
        normalized,
        (client) => this.postPayment(client, scope, idempotencyKey, normalized)
      );
      return (result.body ?? result.data) as StatementPaymentResult;
    } catch (error) {
      if (error instanceof IdempotencyKeyReusedError) throw new ConflictException({ code: error.code, message: error.message });
      throw error;
    }
  }

  /** CSV of a statement (one row per charge and the total), spreadsheet-safe. */
  async exportCsv(scope: TenantScope, statementId: string): Promise<{ filename: string; csv: string }> {
    const statement = await this.detail(scope, statementId);
    const rows = [
      ["Sucursal", "Venta", "Fecha", "Cliente", "Codigo afiliado", "Monto (BOB)"].join(","),
      ...statement.lines.map((line) =>
        [
          csvCell(line.branchCode),
          csvCell(line.saleNumber),
          line.saleDate.slice(0, 10),
          csvCell(line.customerName),
          csvCell(line.memberCode),
          line.amountBob
        ].join(",")
      ),
      ["TOTAL", "", "", "", "", statement.totalBob].join(",")
    ];
    return { filename: `convenio-${statement.number}.csv`, csv: `${rows.join("\r\n")}\r\n` };
  }

  private async postPayment(
    client: PoolClient,
    scope: TenantScope,
    idempotencyKey: string,
    input: { statementId: string; amountBob: string; method: StatementPaymentMethod; paidOn: string; reference: string | null }
  ): Promise<IdempotentExecutionResult<StatementPaymentResult>> {
    const locked = await client.query<{ total: string; paid: string; number: string }>(
      `select total_bob::text as total, paid_bob::text as paid, statement_number as number
       from agreement_statements where tenant_id = $1 and id = $2 for update`,
      [scope.tenantId, input.statementId]
    );
    const statement = locked.rows[0];
    if (!statement) throw statementNotFound();
    const balance = toUnits(statement.total) - toUnits(statement.paid);
    const amount = toUnits(input.amountBob);
    if (amount > balance) {
      throw new BadRequestException({
        code: "PAYMENT_EXCEEDS_BALANCE",
        message: "El pago supera el saldo pendiente del estado de cuenta.",
        balanceBob: fromUnits(balance)
      });
    }
    const payment = await client.query<{ id: string }>(
      `insert into agreement_statement_payments
         (tenant_id, statement_id, amount_bob, method, reference, paid_on, idempotency_key, created_by_user_id, created_by_name)
       values ($1, $2, $3::numeric, $4, $5, $6::date, $7, $8, $9) returning id`,
      [scope.tenantId, input.statementId, input.amountBob, input.method, input.reference, input.paidOn, idempotencyKey, scope.userId, await this.userName(client, scope)]
    );
    const updated = await client.query<{ paid: string; status: StatementStatus }>(
      `update agreement_statements
       set paid_bob = paid_bob + $3::numeric,
           status = case when paid_bob + $3::numeric = total_bob then 'PAID' else 'PARTIAL' end,
           updated_at = now()
       where tenant_id = $1 and id = $2
       returning paid_bob::numeric(18,4)::text as paid, status`,
      [scope.tenantId, input.statementId, input.amountBob]
    );
    const row = updated.rows[0]!;
    const paymentId = payment.rows[0]!.id;
    await this.audit.recordInTransaction(client, scope, {
      action: "crm.agreement_statement.payment_registered",
      entityType: "agreement_statement",
      entityId: input.statementId,
      payload: { paymentId, number: statement.number, amountBob: input.amountBob, method: input.method, paidBob: row.paid }
    });
    return {
      statusCode: 201,
      body: {
        paymentId,
        statementId: input.statementId,
        amountBob: input.amountBob,
        paidBob: row.paid,
        balanceBob: fromUnits(toUnits(statement.total) - toUnits(row.paid)),
        status: row.status
      }
    };
  }

  private async loadAgreement(client: PoolClient, scope: TenantScope, agreementId: string, lock: boolean): Promise<{ id: string; name: string }> {
    const result = await client.query<{ id: string; name: string }>(
      `select id, name from agreements where tenant_id = $1 and id = $2 ${lock ? "for update" : ""}`,
      [scope.tenantId, agreementId]
    );
    const row = result.rows[0];
    if (!row) throw agreementNotFound();
    return row;
  }

  /** OPEN charges of the agreement whose sale date falls in the La Paz month, net of reductions, oldest first. */
  private async openCharges(client: PoolClient, scope: TenantScope, agreementId: string, period: string, lock: boolean): Promise<StatementLine[]> {
    const rows = await client.query<LineRow>(
      `${lineSelect}
       where ch.tenant_id = $1 and ch.agreement_id = $2 and ch.status = 'OPEN'
         and to_char(ch.created_at at time zone $3, 'YYYY-MM') = $4
       order by ch.created_at, ch.id ${lock ? "for update of ch" : ""}`,
      [scope.tenantId, agreementId, ZONE, period]
    );
    return rows.rows.map(toLine);
  }

  private async loadDetail(client: PoolClient, scope: TenantScope, statementId: string): Promise<StatementDetail> {
    if (!uuidPattern.test(statementId ?? "")) throw statementNotFound();
    const header = await client.query<StatementSummary & { issuedAt: Date | string; payerName: string; payerTaxId: string | null; coveragePercent: string }>(
      `${summarySql(`, a.payer_name as "payerName", a.payer_tax_id as "payerTaxId", a.coverage_percent::text as "coveragePercent"`)}
       where s.tenant_id = $1 and s.id = $2`,
      [scope.tenantId, statementId]
    );
    const row = header.rows[0];
    if (!row) throw statementNotFound();
    const lines = await client.query<LineRow>(`${lineSelect} where ch.tenant_id = $1 and ch.statement_id = $2 order by ch.created_at, ch.id`, [scope.tenantId, statementId]);
    const payments = await client.query<Omit<StatementPayment, "createdAt"> & { createdAt: Date }>(
      `select p.id, p.amount_bob::numeric(18,4)::text as "amountBob", p.method, p.reference, to_char(p.paid_on, 'YYYY-MM-DD') as "paidOn",
              p.created_by_name as "createdByName", p.created_at as "createdAt"
       from agreement_statement_payments p
       where p.tenant_id = $1 and p.statement_id = $2 order by p.created_at, p.id`,
      [scope.tenantId, statementId]
    );
    return {
      ...row,
      issuedAt: new Date(row.issuedAt).toISOString(),
      lines: lines.rows.map(toLine),
      payments: payments.rows.map((payment) => ({ ...payment, createdAt: payment.createdAt.toISOString() }))
    };
  }

  /** Display name of the acting user, snapshotted because users are only visible inside their own branch. */
  private async userName(client: PoolClient, scope: TenantScope): Promise<string> {
    const result = await client.query<{ name: string }>("select display_name as name from users where id = $1", [scope.userId]);
    return (result.rows[0]?.name ?? "Usuario").slice(0, 160);
  }

  private async nextNumber(client: PoolClient, scope: TenantScope): Promise<string> {
    const branch = await client.query<{ code: string }>("select code from branches where tenant_id = $1 and id = $2", [scope.tenantId, scope.branchId]);
    const number = await this.sequences.nextNumberInTransaction(client, "AGREEMENT_STATEMENT");
    return `CONV-${branch.rows[0]?.code ?? "SUC"}-${number.toString().padStart(6, "0")}`;
  }
}

function sum(lines: readonly StatementLine[]): string {
  return fromUnits(lines.reduce((total, line) => total + toUnits(line.amountBob), 0n));
}
