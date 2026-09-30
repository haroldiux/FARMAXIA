import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { TenantDatabase, type TenantScope } from "../database/tenant-database.js";
import { AuditService } from "../transversal/audit.service.js";
import { IdempotencyService, type IdempotentExecutionResult } from "../transversal/idempotency.service.js";

export type PayableStatus = "OPEN" | "PARTIAL" | "PAID" | "OVERDUE";
export type PaymentMethod = "CASH" | "TRANSFER" | "CHECK" | "QR" | "OTHER";
export type ScheduleBucket = "overdue" | "thisWeek" | "next30" | "later" | "paid";

export interface PayableSummary {
  payableId: string;
  invoiceId: string;
  invoiceNumber: string;
  supplierId: string;
  supplierName: string;
  currency: string;
  issuedOn: string;
  dueOn: string;
  scheduledOn: string | null;
  originalAmount: string;
  outstandingAmount: string;
  paidAmount: string;
  status: PayableStatus;
  bucket: ScheduleBucket;
  daysToDue: number;
  paymentCount: number;
}

export interface PayableListResult {
  items: PayableSummary[];
  /** Saldo pendiente por tramo y moneda (solo cuentas no pagadas). */
  totals: Array<{ bucket: Exclude<ScheduleBucket, "paid">; currency: string; outstanding: string; count: number }>;
}

export interface SupplierPayment {
  id: string;
  paidOn: string;
  amount: string;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface RegisterPaymentInput {
  idempotencyKey: string;
  amount: string;
  paidOn: string;
  method: PaymentMethod;
  reference?: string;
  notes?: string;
}

export interface RegisterPaymentResult {
  paymentId: string;
  payableId: string;
  outstandingAmount: string;
  status: "OPEN" | "PARTIAL" | "PAID";
}

const methods: PaymentMethod[] = ["CASH", "TRANSFER", "CHECK", "QR", "OTHER"];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireId(value: string): string {
  if (!uuidPattern.test(value)) throw new NotFoundException("Cuenta por pagar no encontrada.");
  return value;
}

function isoDate(value: unknown, field: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new BadRequestException(`${field} debe ser una fecha válida (AAAA-MM-DD).`);
  }
  return text;
}

function amount(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  if (!/^\d+(?:\.\d{1,4})?$/.test(text) || Number(text) <= 0) {
    throw new BadRequestException("El monto debe ser un número positivo con hasta 4 decimales.");
  }
  return text;
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > max) throw new BadRequestException(`${field} admite hasta ${max} caracteres.`);
  return text;
}

function dateOnly(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

/** Cuentas por pagar: pagos parciales o totales y agenda de vencimientos. */
@Injectable()
export class PayablesService {
  private readonly idempotency = new IdempotencyService();
  private readonly audit = new AuditService();

  constructor(@Inject(TenantDatabase) private readonly database: TenantDatabase) {}

  async list(scope: TenantScope): Promise<PayableListResult> {
    return this.database.withScope(scope, async (client) => {
      const result = await client.query<Omit<PayableSummary, "issuedOn" | "dueOn" | "scheduledOn"> & { issuedOn: string | Date; dueOn: string | Date; scheduledOn: string | Date | null }>(
        `select payable.id as "payableId", invoice.id as "invoiceId", invoice.invoice_number as "invoiceNumber",
                invoice.supplier_id as "supplierId", supplier.name as "supplierName", invoice.currency,
                invoice.issued_on as "issuedOn", payable.due_on as "dueOn", payable.scheduled_on as "scheduledOn",
                payable.original_amount::text as "originalAmount", payable.outstanding_amount::text as "outstandingAmount",
                (payable.original_amount - payable.outstanding_amount)::text as "paidAmount",
                case
                  when payable.outstanding_amount = 0 then 'PAID'
                  when payable.due_on < current_date then 'OVERDUE'
                  when payable.outstanding_amount < payable.original_amount then 'PARTIAL'
                  else 'OPEN'
                end as status,
                case
                  when payable.outstanding_amount = 0 then 'paid'
                  when coalesce(payable.scheduled_on, payable.due_on) < current_date then 'overdue'
                  when coalesce(payable.scheduled_on, payable.due_on) <= current_date + 7 then 'thisWeek'
                  when coalesce(payable.scheduled_on, payable.due_on) <= current_date + 30 then 'next30'
                  else 'later'
                end as bucket,
                (payable.due_on - current_date)::int as "daysToDue",
                (select count(*) from supplier_payments payment where payment.tenant_id = payable.tenant_id and payment.payable_id = payable.id)::int as "paymentCount"
         from payables payable
         join supplier_invoices invoice on invoice.tenant_id = payable.tenant_id and invoice.id = payable.supplier_invoice_id
         join suppliers supplier on supplier.tenant_id = invoice.tenant_id and supplier.id = invoice.supplier_id
         where payable.tenant_id = $1
         order by (payable.outstanding_amount = 0), coalesce(payable.scheduled_on, payable.due_on), invoice.issued_on, payable.id`,
        [scope.tenantId]
      );
      const items = result.rows.map((row) => ({
        ...row,
        issuedOn: dateOnly(row.issuedOn),
        dueOn: dateOnly(row.dueOn),
        scheduledOn: row.scheduledOn ? dateOnly(row.scheduledOn) : null
      }));
      const totals = new Map<string, { bucket: Exclude<ScheduleBucket, "paid">; currency: string; outstanding: number; count: number }>();
      for (const item of items) {
        if (item.bucket === "paid") continue;
        const key = `${item.bucket}:${item.currency}`;
        const entry = totals.get(key) ?? { bucket: item.bucket, currency: item.currency, outstanding: 0, count: 0 };
        entry.outstanding += Number(item.outstandingAmount);
        entry.count += 1;
        totals.set(key, entry);
      }
      return {
        items,
        totals: [...totals.values()].map((entry) => ({ ...entry, outstanding: entry.outstanding.toFixed(2) }))
      };
    });
  }

  async listPayments(scope: TenantScope, payableId: string): Promise<{ items: SupplierPayment[] }> {
    const id = requireId(payableId);
    return this.database.withScope(scope, async (client) => {
      await this.lockPayable(client, scope, id, false);
      const result = await client.query<Omit<SupplierPayment, "paidOn" | "createdAt"> & { paidOn: string | Date; createdAt: Date }>(
        `select payment.id, payment.paid_on as "paidOn", payment.amount::text as amount, payment.method,
                payment.reference, payment.notes, app_user.display_name as "createdByName", payment.created_at as "createdAt"
         from supplier_payments payment
         left join users app_user on app_user.id = payment.created_by_user_id
         where payment.tenant_id = $1 and payment.payable_id = $2
         order by payment.paid_on desc, payment.created_at desc`,
        [scope.tenantId, id]
      );
      return { items: result.rows.map((row) => ({ ...row, paidOn: dateOnly(row.paidOn), createdAt: row.createdAt.toISOString() })) };
    });
  }

  /** Registra un pago: nunca más que el saldo pendiente; un reintento con la misma clave no se duplica. */
  async registerPayment(scope: TenantScope, payableId: string, input: RegisterPaymentInput): Promise<RegisterPaymentResult> {
    const id = requireId(payableId);
    const idempotencyKey = optionalText(input?.idempotencyKey, "La clave de idempotencia", 255);
    if (!idempotencyKey) throw new BadRequestException("Falta la clave de idempotencia.");
    const method = input.method as PaymentMethod;
    if (!methods.includes(method)) throw new BadRequestException("Método de pago no válido.");
    const normalized = {
      payableId: id,
      amount: amount(input.amount),
      paidOn: isoDate(input.paidOn, "La fecha de pago"),
      method,
      reference: optionalText(input.reference, "La referencia", 120),
      notes: optionalText(input.notes, "La nota", 255)
    };
    const result = await this.idempotency.execute(
      this.database,
      scope,
      "procurement.supplier_payment",
      idempotencyKey,
      normalized,
      async (client) => this.postPayment(client, scope, idempotencyKey, normalized)
    );
    return (result.body ?? result.data) as RegisterPaymentResult;
  }

  /** Fija (o quita, con null) la fecha en que se planea pagar la cuenta. */
  async schedule(scope: TenantScope, payableId: string, scheduledOn: string | null): Promise<{ payableId: string; scheduledOn: string | null }> {
    const id = requireId(payableId);
    const date = scheduledOn === null || scheduledOn === "" ? null : isoDate(scheduledOn, "La fecha programada");
    return this.database.withScope(scope, async (client) => {
      const payable = await this.lockPayable(client, scope, id, true);
      if (Number(payable.outstanding) === 0) throw new ConflictException("La cuenta ya está pagada.");
      await client.query(
        "update payables set scheduled_on = $3, updated_at = now() where tenant_id = $1 and id = $2",
        [scope.tenantId, id, date]
      );
      await this.audit.recordInTransaction(client, {
        action: "procurement.payable_scheduled",
        entityType: "payable",
        entityId: id,
        payload: { scheduledOn: date }
      });
      return { payableId: id, scheduledOn: date };
    });
  }

  private async lockPayable(client: PoolClient, scope: TenantScope, id: string, forUpdate: boolean) {
    const result = await client.query<{ outstanding: string; original: string; supplierId: string; invoiceNumber: string }>(
      `select payable.outstanding_amount::text as outstanding, payable.original_amount::text as original,
              invoice.supplier_id as "supplierId", invoice.invoice_number as "invoiceNumber"
       from payables payable
       join supplier_invoices invoice on invoice.tenant_id = payable.tenant_id and invoice.id = payable.supplier_invoice_id
       where payable.tenant_id = $1 and payable.id = $2
       ${forUpdate ? "for update of payable" : ""}`,
      [scope.tenantId, id]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Cuenta por pagar no encontrada.");
    return row;
  }

  private async postPayment(
    client: PoolClient,
    scope: TenantScope,
    idempotencyKey: string,
    input: { payableId: string; amount: string; paidOn: string; method: PaymentMethod; reference: string | null; notes: string | null }
  ): Promise<IdempotentExecutionResult<RegisterPaymentResult>> {
    const payable = await this.lockPayable(client, scope, input.payableId, true);
    const check = await client.query<{ exceeds: boolean }>("select $1::numeric > $2::numeric as exceeds", [input.amount, payable.outstanding]);
    if (Number(payable.outstanding) === 0) throw new ConflictException("La cuenta ya está pagada.");
    if (check.rows[0]?.exceeds) {
      throw new ConflictException(`El pago supera el saldo pendiente (${payable.outstanding}).`);
    }
    const payment = await client.query<{ id: string }>(
      `insert into supplier_payments
         (tenant_id, payable_id, supplier_id, paid_on, amount, method, reference, notes, idempotency_key, created_by_user_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning id`,
      [scope.tenantId, input.payableId, payable.supplierId, input.paidOn, input.amount, input.method, input.reference, input.notes, idempotencyKey, scope.userId]
    );
    const updated = await client.query<{ outstanding: string; status: "OPEN" | "PARTIAL" | "PAID" }>(
      `update payables
       set outstanding_amount = outstanding_amount - $3::numeric,
           status = case when outstanding_amount - $3::numeric = 0 then 'PAID' else 'PARTIAL' end,
           scheduled_on = case when outstanding_amount - $3::numeric = 0 then null else scheduled_on end,
           updated_at = now()
       where tenant_id = $1 and id = $2
       returning outstanding_amount::text as outstanding, status`,
      [scope.tenantId, input.payableId, input.amount]
    );
    const row = updated.rows[0]!;
    await this.audit.recordInTransaction(client, {
      action: "procurement.supplier_payment_registered",
      entityType: "payable",
      entityId: input.payableId,
      payload: { paymentId: payment.rows[0]!.id, invoiceNumber: payable.invoiceNumber, amount: input.amount, method: input.method, outstandingAfter: row.outstanding }
    });
    return {
      statusCode: 201,
      body: { paymentId: payment.rows[0]!.id, payableId: input.payableId, outstandingAmount: row.outstanding, status: row.status }
    };
  }
}
