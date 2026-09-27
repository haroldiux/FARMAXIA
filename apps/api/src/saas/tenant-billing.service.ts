import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { TenantDatabase, type TenantScope } from "../database/tenant-database.js";
import { AuditService } from "../platform/audit.service.js";
import type { SubscriptionStatus } from "../subscriptions/subscription-state.js";

export interface SubscriptionSummary {
  status: SubscriptionStatus;
  hasAccess: boolean;
  plan: { code: string; name: string; priceMonthlyBob: string; auditRetentionDays: number | null };
  trialEndsAt: string | null;
  graceEndsAt: string | null;
  currentPeriodEnd: string | null;
  usage: Array<{ resource: string; used: number; limit: number | null }>;
  features: Array<{ code: string; name: string; module: string; enabled: boolean; addOn: boolean }>;
  openInvoices: number;
}

export interface TenantInvoice {
  id: string;
  number: string;
  planName: string;
  periodStart: string;
  periodEnd: string;
  amountBob: string;
  status: "OPEN" | "PAID" | "VOID";
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
  payments: Array<{
    id: string;
    method: string;
    reference: string;
    amountBob: string;
    paidOn: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
    submittedAt: string;
    reviewNote: string | null;
    hasAttachment: boolean;
  }>;
}

export interface InvoiceDocument extends TenantInvoice {
  customer: { pharmacyName: string; legalName: string | null; taxId: string | null };
}

export interface SubmitPaymentInput {
  method: "QR" | "TRANSFER";
  reference: string;
  amountBob: string;
  paidOn: string;
  attachment?: { mediaType: string; base64: string };
}

const allowedAttachmentTypes = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
const maxAttachmentBytes = 2 * 1024 * 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lo que la farmacia ve y hace sobre su propia suscripción, siempre bajo su RLS. */
@Injectable()
export class TenantBillingService {
  private readonly audit = new AuditService();

  constructor(@Inject(TenantDatabase) private readonly database: TenantDatabase) {}

  async summary(scope: TenantScope, now = new Date()): Promise<SubscriptionSummary> {
    return this.database.withScope(scope, async (client) => {
      const { rows } = await client.query<{
        id: string; status: SubscriptionStatus; trialEndsAt: Date | null; graceEndsAt: Date | null;
        currentPeriodEnd: Date | null; planId: string; code: string; name: string; price: string;
        retention: number | null; allowsAll: boolean;
      }>(
        `select subscription.id, subscription.status,
                subscription.trial_ends_at as "trialEndsAt", subscription.grace_ends_at as "graceEndsAt",
                subscription.current_period_end as "currentPeriodEnd",
                plan.id as "planId", plan.code, plan.name, plan.price_monthly_bob::text as price,
                plan.audit_retention_days as retention, plan.allows_all_features as "allowsAll"
         from tenant_subscriptions as subscription
         join subscription_plans as plan on plan.id = subscription.plan_id
         where subscription.tenant_id = $1 and subscription.status <> 'CANCELED'
         limit 1`,
        [scope.tenantId]
      );
      const subscription = rows[0];
      if (!subscription) {
        throw new NotFoundException({ code: "SUBSCRIPTION_NOT_FOUND", message: "La farmacia no tiene una suscripción vigente." });
      }

      const usage = await client.query<{ resource: string; used: string | null; limit: string | null }>(
        `select quota.resource_code as resource, usage.used_units::text as used, quota.limit_units::text as limit
         from plan_quotas as quota
         left join tenant_resource_usage as usage
           on usage.resource_code = quota.resource_code and usage.tenant_id = $2
         where quota.plan_id = $1 and quota.resource_code <> 'storage_bytes'
         order by quota.resource_code`,
        [subscription.planId, scope.tenantId]
      );
      const features = await client.query<{ code: string; name: string; module: string; planEnabled: boolean | null; override: boolean | null }>(
        `select feature.code, feature.name, feature.module,
                plan_feature.is_enabled as "planEnabled", override.is_enabled as override
         from saas_features as feature
         left join plan_features as plan_feature
           on plan_feature.feature_code = feature.code and plan_feature.plan_id = $1
         left join subscription_feature_overrides as override
           on override.feature_code = feature.code and override.subscription_id = $2
         order by feature.sort_order`,
        [subscription.planId, subscription.id]
      );
      const open = await client.query<{ count: string }>(
        "select count(*)::text as count from saas_invoices where tenant_id = $1 and status = 'OPEN'",
        [scope.tenantId]
      );

      return {
        status: subscription.status,
        hasAccess: hasAccess(subscription, now),
        plan: {
          code: subscription.code,
          name: subscription.name,
          priceMonthlyBob: subscription.price,
          auditRetentionDays: subscription.retention
        },
        trialEndsAt: iso(subscription.trialEndsAt),
        graceEndsAt: iso(subscription.graceEndsAt),
        currentPeriodEnd: iso(subscription.currentPeriodEnd),
        usage: usage.rows.map((row) => ({
          resource: row.resource,
          used: Number(row.used ?? 0),
          limit: row.limit === null ? null : Number(row.limit)
        })),
        features: features.rows.map((row) => ({
          code: row.code,
          name: row.name,
          module: row.module,
          enabled: row.override ?? (subscription.allowsAll || row.planEnabled === true),
          addOn: row.override === true && !(subscription.allowsAll || row.planEnabled === true)
        })),
        openInvoices: Number(open.rows[0]?.count ?? 0)
      };
    });
  }

  async listInvoices(scope: TenantScope): Promise<TenantInvoice[]> {
    return this.database.withScope(scope, async (client) => {
      const invoices = await client.query<TenantInvoice>(
        `${invoiceSelect} where invoice.tenant_id = $1 order by invoice.period_start desc, invoice.issued_at desc limit 60`,
        [scope.tenantId]
      );
      const payments = await this.paymentsFor(client, scope.tenantId, invoices.rows.map((invoice) => invoice.id));
      return invoices.rows.map((invoice) => ({ ...invoice, payments: payments.get(invoice.id) ?? [] }));
    });
  }

  async invoiceDocument(scope: TenantScope, invoiceId: string): Promise<InvoiceDocument> {
    assertUuid(invoiceId);
    return this.database.withScope(scope, async (client) => {
      const invoice = await client.query<TenantInvoice>(
        `${invoiceSelect} where invoice.tenant_id = $1 and invoice.id = $2`,
        [scope.tenantId, invoiceId]
      );
      const found = invoice.rows[0];
      if (!found) {
        throw new NotFoundException({ code: "INVOICE_NOT_FOUND", message: "El comprobante no existe." });
      }
      const customer = await client.query<{ pharmacyName: string; legalName: string | null; taxId: string | null }>(
        `select tenant.name as "pharmacyName", entity.legal_name as "legalName", entity.tax_id as "taxId"
         from tenants as tenant
         left join legal_entities as entity on entity.tenant_id = tenant.id
         where tenant.id = $1
         order by entity.created_at
         limit 1`,
        [scope.tenantId]
      );
      const payments = await this.paymentsFor(client, scope.tenantId, [found.id]);
      return {
        ...found,
        payments: payments.get(found.id) ?? [],
        customer: customer.rows[0] ?? { pharmacyName: "", legalName: null, taxId: null }
      };
    });
  }

  async submitPayment(scope: TenantScope, invoiceId: string, input: SubmitPaymentInput): Promise<{ paymentId: string }> {
    assertUuid(invoiceId);
    const payment = validatePayment(input);

    return this.database.withScope(scope, async (client) => {
      const invoice = await client.query<{ status: string }>(
        "select status from saas_invoices where tenant_id = $1 and id = $2",
        [scope.tenantId, invoiceId]
      );
      if (!invoice.rows[0]) {
        throw new NotFoundException({ code: "INVOICE_NOT_FOUND", message: "El comprobante no existe." });
      }
      if (invoice.rows[0].status !== "OPEN") {
        throw new ConflictException({ code: "INVOICE_NOT_OPEN", message: "Este comprobante ya no admite pagos." });
      }

      try {
        const { rows } = await client.query<{ id: string }>(
          `insert into saas_payments (
             tenant_id, invoice_id, method, reference, amount_bob, paid_on,
             attachment_media_type, attachment_data, submitted_by_user_id
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           returning id`,
          [
            scope.tenantId,
            invoiceId,
            payment.method,
            payment.reference,
            payment.amountBob,
            payment.paidOn,
            payment.attachment?.mediaType ?? null,
            payment.attachment?.data ?? null,
            scope.userId
          ]
        );
        const paymentId = rows[0]?.id ?? "";
        await this.audit.recordInTransaction(client, {
          action: "saas.payment.submitted",
          entityType: "saas_payment",
          entityId: paymentId,
          payload: { invoiceId, method: payment.method, amountBob: payment.amountBob, reference: payment.reference }
        });
        return { paymentId };
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ConflictException({
            code: "PAYMENT_ALREADY_PENDING",
            message: "Ya enviaste un pago para este comprobante y está en revisión."
          });
        }
        throw error;
      }
    });
  }

  private async paymentsFor(
    client: import("pg").PoolClient,
    tenantId: string,
    invoiceIds: string[]
  ): Promise<Map<string, TenantInvoice["payments"]>> {
    const result = new Map<string, TenantInvoice["payments"]>();
    if (!invoiceIds.length) {
      return result;
    }
    const { rows } = await client.query<TenantInvoice["payments"][number] & { invoiceId: string }>(
      `select id, invoice_id as "invoiceId", method, reference, amount_bob::text as "amountBob",
              to_char(paid_on, 'YYYY-MM-DD') as "paidOn", status, submitted_at as "submittedAt",
              review_note as "reviewNote", attachment_data is not null as "hasAttachment"
       from saas_payments
       where tenant_id = $1 and invoice_id = any($2::uuid[])
       order by submitted_at desc`,
      [tenantId, invoiceIds]
    );
    for (const { invoiceId, ...payment } of rows) {
      result.set(invoiceId, [...(result.get(invoiceId) ?? []), payment]);
    }
    return result;
  }
}

const invoiceSelect = `
  select invoice.id, invoice.number, invoice.plan_name as "planName",
         invoice.period_start as "periodStart", invoice.period_end as "periodEnd",
         invoice.amount_bob::text as "amountBob", invoice.status,
         invoice.issued_at as "issuedAt", invoice.due_at as "dueAt", invoice.paid_at as "paidAt"
  from saas_invoices as invoice`;

function hasAccess(
  subscription: { status: SubscriptionStatus; trialEndsAt: Date | null; graceEndsAt: Date | null },
  now: Date
): boolean {
  if (subscription.status === "ACTIVE") return true;
  if (subscription.status === "TRIALING") return Boolean(subscription.trialEndsAt && subscription.trialEndsAt > now);
  if (subscription.status === "PAST_DUE") return Boolean(subscription.graceEndsAt && subscription.graceEndsAt > now);
  return false;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function assertUuid(value: string): void {
  if (!uuidPattern.test(value)) {
    throw new NotFoundException({ code: "INVOICE_NOT_FOUND", message: "El comprobante no existe." });
  }
}

function validatePayment(input: SubmitPaymentInput): {
  method: "QR" | "TRANSFER"; reference: string; amountBob: string; paidOn: string;
  attachment?: { mediaType: string; data: Buffer };
} {
  if (input?.method !== "QR" && input?.method !== "TRANSFER") {
    throw new BadRequestException({ code: "INVALID_INPUT", field: "method", message: "Elige QR o transferencia." });
  }
  const reference = typeof input.reference === "string" ? input.reference.trim() : "";
  if (reference.length < 3 || reference.length > 120) {
    throw new BadRequestException({ code: "INVALID_INPUT", field: "reference", message: "Indica el número de transacción o referencia." });
  }
  const amountBob = typeof input.amountBob === "string" ? input.amountBob.trim() : "";
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(amountBob) || Number(amountBob) <= 0) {
    throw new BadRequestException({ code: "INVALID_INPUT", field: "amountBob", message: "El monto debe ser positivo, con hasta 2 decimales." });
  }
  const paidOn = typeof input.paidOn === "string" ? input.paidOn : "";
  const paidDate = new Date(`${paidOn}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || Number.isNaN(paidDate.getTime()) || paidDate.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
    throw new BadRequestException({ code: "INVALID_INPUT", field: "paidOn", message: "La fecha de pago no es válida." });
  }

  let attachment: { mediaType: string; data: Buffer } | undefined;
  if (input.attachment) {
    const { mediaType, base64 } = input.attachment;
    if (!allowedAttachmentTypes.has(mediaType) || typeof base64 !== "string") {
      throw new BadRequestException({ code: "INVALID_ATTACHMENT", field: "attachment", message: "El comprobante debe ser una imagen (PNG, JPG, WEBP) o un PDF." });
    }
    const data = Buffer.from(base64, "base64");
    if (!data.length || data.length > maxAttachmentBytes) {
      throw new BadRequestException({ code: "INVALID_ATTACHMENT", field: "attachment", message: "El comprobante debe pesar como máximo 2 MB." });
    }
    attachment = { mediaType, data };
  }

  return { method: input.method, reference, amountBob, paidOn, attachment };
}
