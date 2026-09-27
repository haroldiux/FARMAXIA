import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { transitionSubscription, type SubscriptionStatus } from "../subscriptions/subscription-state.js";
import { addMonths, formatInvoiceNumber, isInvoiceDue, nextBillingPeriod } from "./billing-period.js";
import { PlatformDatabase } from "./platform-database.js";

interface SubscriptionRow {
  id: string;
  tenantId: string;
  status: SubscriptionStatus;
  startsAt: Date;
  trialEndsAt: Date | null;
  graceEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  planCode: string;
  planName: string;
  priceMonthlyBob: string;
}

export interface BillingCycleResult {
  invoicesIssued: number;
  movedToPastDue: number;
  suspended: number;
}

export type PlatformStatusAction = "SUSPEND" | "REACTIVATE" | "CANCEL";

const subscriptionColumns = `
  subscription.id,
  subscription.tenant_id as "tenantId",
  subscription.status,
  subscription.starts_at as "startsAt",
  subscription.trial_ends_at as "trialEndsAt",
  subscription.grace_ends_at as "graceEndsAt",
  subscription.current_period_end as "currentPeriodEnd",
  plan.code as "planCode",
  plan.name as "planName",
  plan.price_monthly_bob::text as "priceMonthlyBob"`;

/**
 * Ciclo de vida comercial de una suscripción. Todas las operaciones corren con el rol
 * de plataforma: la farmacia solo lee sus comprobantes y declara pagos pendientes.
 */
@Injectable()
export class BillingService {
  constructor(@Inject(PlatformDatabase) private readonly database: PlatformDatabase) {}

  /** Emite el comprobante del siguiente periodo si ya está dentro de la ventana de emisión. */
  async ensureNextInvoice(client: PoolClient, subscriptionId: string, now: Date): Promise<boolean> {
    const subscription = await this.lockSubscription(client, subscriptionId);
    if (!subscription || !isBillable(subscription)) {
      return false;
    }
    if (!["TRIALING", "ACTIVE", "PAST_DUE"].includes(subscription.status)) {
      return false;
    }

    const period = nextBillingPeriod(subscription);
    if (!isInvoiceDue(period.start, now)) {
      return false;
    }

    const existing = await client.query(
      `select 1 from saas_invoices
       where subscription_id = $1 and period_start = $2 and status <> 'VOID'`,
      [subscription.id, period.start]
    );
    if (existing.rowCount) {
      return false;
    }

    const { rows } = await client.query<{ value: string }>(
      "select nextval('saas_invoice_number_seq')::text as value"
    );
    await client.query(
      `insert into saas_invoices (
         tenant_id, subscription_id, number, plan_code, plan_name,
         period_start, period_end, amount_bob, due_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $6)`,
      [
        subscription.tenantId,
        subscription.id,
        formatInvoiceNumber(rows[0]?.value ?? "0"),
        subscription.planCode,
        subscription.planName,
        period.start,
        period.end,
        subscription.priceMonthlyBob
      ]
    );
    return true;
  }

  /**
   * Revisa todas las suscripciones de pago: vence pruebas, pasa a mora a quien no pagó
   * su periodo, suspende al terminar la gracia y emite los comprobantes que tocan.
   * Es idempotente: correrlo dos veces seguidas no cambia nada la segunda vez.
   */
  async runCycle(now = new Date()): Promise<BillingCycleResult> {
    return this.database.withTransaction(async (client) => {
      const lock = await client.query<{ locked: boolean }>(
        "select pg_try_advisory_xact_lock(hashtext('farmaxia.billing_cycle')) as locked"
      );
      const result: BillingCycleResult = { invoicesIssued: 0, movedToPastDue: 0, suspended: 0 };
      if (!lock.rows[0]?.locked) {
        return result;
      }

      const { rows } = await client.query<SubscriptionRow>(
        `select ${subscriptionColumns}
         from tenant_subscriptions as subscription
         join subscription_plans as plan on plan.id = subscription.plan_id
         where subscription.status in ('TRIALING', 'ACTIVE', 'PAST_DUE')
           and plan.price_monthly_bob > 0
         order by subscription.created_at
         for update of subscription`
      );

      for (const subscription of rows) {
        const paidThrough = subscription.currentPeriodEnd;
        const coveredNow = paidThrough !== null && paidThrough > now;

        if (subscription.status === "TRIALING" && subscription.trialEndsAt && subscription.trialEndsAt <= now && !coveredNow) {
          await this.applyStatus(client, subscription, "SUSPENDED", now);
          result.suspended += 1;
          continue;
        }
        if (subscription.status === "ACTIVE" && paidThrough !== null && paidThrough <= now) {
          await this.applyStatus(client, subscription, "PAST_DUE", now);
          result.movedToPastDue += 1;
        }
        if (subscription.status === "PAST_DUE" && subscription.graceEndsAt && subscription.graceEndsAt <= now && !coveredNow) {
          await this.applyStatus(client, subscription, "SUSPENDED", now);
          result.suspended += 1;
          continue;
        }
        if (await this.ensureNextInvoice(client, subscription.id, now)) {
          result.invoicesIssued += 1;
        }
      }
      return result;
    });
  }

  async approvePayment(operatorId: string, paymentId: string, note: string | undefined, now = new Date()): Promise<void> {
    await this.database.withTransaction(async (client) => {
      const payment = await this.lockPendingPayment(client, paymentId);
      const invoice = await client.query<{
        id: string; subscriptionId: string; status: string; amountBob: string; periodEnd: Date;
      }>(
        `select id, subscription_id as "subscriptionId", status, amount_bob::text as "amountBob", period_end as "periodEnd"
         from saas_invoices where id = $1 for update`,
        [payment.invoiceId]
      );
      const target = invoice.rows[0];
      if (!target || target.status !== "OPEN") {
        throw new ConflictException({ code: "INVOICE_NOT_OPEN", message: "El comprobante ya no está pendiente de pago." });
      }
      if (Number(payment.amountBob) < Number(target.amountBob)) {
        throw new ConflictException({
          code: "PAYMENT_AMOUNT_INSUFFICIENT",
          message: `El monto declarado (${payment.amountBob} BOB) no cubre el comprobante (${target.amountBob} BOB).`
        });
      }

      await client.query(
        `update saas_payments
         set status = 'APPROVED', reviewed_by_operator_id = $2, reviewed_at = $3, review_note = $4
         where id = $1`,
        [paymentId, operatorId, now, note?.trim() || null]
      );
      await client.query("update saas_invoices set status = 'PAID', paid_at = $2 where id = $1", [target.id, now]);

      const subscription = await this.lockSubscription(client, target.subscriptionId);
      if (!subscription) {
        throw new NotFoundException();
      }
      // Una farmacia suspendida que paga reinicia su periodo hoy: no paga el tiempo sin servicio.
      const periodEnd = subscription.status === "SUSPENDED"
        ? addMonths(now, 1)
        : maxDate(subscription.currentPeriodEnd, target.periodEnd);
      await client.query("update tenant_subscriptions set current_period_end = $2, updated_at = $3 where id = $1", [
        subscription.id,
        periodEnd,
        now
      ]);
      if (subscription.status !== "ACTIVE") {
        await this.applyStatus(client, subscription, "ACTIVE", now);
      }

      await recordPlatformAudit(client, operatorId, subscription.tenantId, "saas.payment.approved", "saas_payment", paymentId, {
        invoiceId: target.id,
        amountBob: payment.amountBob,
        paidThrough: periodEnd.toISOString()
      });
      await this.ensureNextInvoice(client, subscription.id, now);
    });
  }

  async rejectPayment(operatorId: string, paymentId: string, note: string | undefined, now = new Date()): Promise<void> {
    const reason = note?.trim();
    if (!reason) {
      throw new BadRequestException({ code: "REVIEW_NOTE_REQUIRED", message: "Indica el motivo del rechazo para la farmacia." });
    }
    await this.database.withTransaction(async (client) => {
      const payment = await this.lockPendingPayment(client, paymentId);
      await client.query(
        `update saas_payments
         set status = 'REJECTED', reviewed_by_operator_id = $2, reviewed_at = $3, review_note = $4
         where id = $1`,
        [paymentId, operatorId, now, reason.slice(0, 500)]
      );
      await recordPlatformAudit(client, operatorId, payment.tenantId, "saas.payment.rejected", "saas_payment", paymentId, {
        reason
      });
    });
  }

  async changePlan(operatorId: string, tenantId: string, planCode: string, now = new Date()): Promise<void> {
    await this.database.withTransaction(async (client) => {
      const subscription = await this.lockCurrentSubscription(client, tenantId);
      const plan = await client.query<{ id: string; code: string; price: string }>(
        "select id, code, price_monthly_bob::text as price from subscription_plans where code = $1 and is_active",
        [planCode]
      );
      const target = plan.rows[0];
      if (!target) {
        throw new BadRequestException({ code: "PLAN_NOT_FOUND", message: "El plan indicado no existe o está inactivo." });
      }
      if (target.code === subscription.planCode) {
        return;
      }

      // No se permite bajar a un plan cuyos límites ya supera la farmacia.
      const exceeded = await client.query<{ resource: string; used: string; limit: string }>(
        `select quota.resource_code as resource, usage.used_units::text as used, quota.limit_units::text as limit
         from plan_quotas as quota
         join tenant_resource_usage as usage
           on usage.resource_code = quota.resource_code and usage.tenant_id = $2
         where quota.plan_id = $1 and quota.limit_units is not null and usage.used_units > quota.limit_units`,
        [target.id, tenantId]
      );
      if (exceeded.rowCount) {
        throw new ConflictException({
          code: "PLAN_QUOTA_EXCEEDED",
          message: "La farmacia usa más recursos de los que permite ese plan.",
          details: exceeded.rows
        });
      }

      await client.query(
        "update saas_invoices set status = 'VOID', voided_at = $2 where subscription_id = $1 and status = 'OPEN'",
        [subscription.id, now]
      );
      // Pasar de un plan sin costo a uno de pago empieza a cobrar desde hoy.
      const startsBilling = Number(subscription.priceMonthlyBob) === 0 && Number(target.price) > 0
        && subscription.status === "ACTIVE" && subscription.currentPeriodEnd === null;
      await client.query(
        `update tenant_subscriptions
         set plan_id = $2, updated_at = $3::timestamptz,
             current_period_end = case when $4::boolean then $3::timestamptz else current_period_end end
         where id = $1`,
        [subscription.id, target.id, now, startsBilling]
      );
      await recordPlatformAudit(client, operatorId, tenantId, "saas.subscription.plan_changed", "tenant_subscription", subscription.id, {
        from: subscription.planCode,
        to: target.code
      });
      await this.ensureNextInvoice(client, subscription.id, now);
    });
  }

  async setStatus(operatorId: string, tenantId: string, action: PlatformStatusAction, now = new Date()): Promise<void> {
    await this.database.withTransaction(async (client) => {
      const subscription = await this.lockCurrentSubscription(client, tenantId);
      const previousStatus = subscription.status;
      if (action === "SUSPEND") {
        if (subscription.status === "SUSPENDED") {
          return;
        }
        if (subscription.status === "ACTIVE") {
          // La máquina de estados no salta de ACTIVE a SUSPENDED: pasa por mora.
          await this.applyStatus(client, subscription, "PAST_DUE", now);
          subscription.status = "PAST_DUE";
        }
        await this.applyStatus(client, subscription, "SUSPENDED", now);
      } else if (action === "REACTIVATE") {
        if (subscription.status !== "SUSPENDED") {
          throw new ConflictException({ code: "SUBSCRIPTION_NOT_SUSPENDED", message: "Solo se reactiva una suscripción suspendida." });
        }
        await this.applyStatus(client, subscription, "ACTIVE", now);
      } else {
        await this.applyStatus(client, subscription, "CANCELED", now);
        await client.query(
          "update saas_invoices set status = 'VOID', voided_at = $2 where subscription_id = $1 and status = 'OPEN'",
          [subscription.id, now]
        );
      }
      await recordPlatformAudit(client, operatorId, tenantId, `saas.subscription.${action.toLowerCase()}`, "tenant_subscription", subscription.id, {
        previousStatus,
        status: subscription.status
      });
    });
  }

  async setFeatureOverride(operatorId: string, tenantId: string, featureCode: string, enabled: boolean | null): Promise<void> {
    await this.database.withTransaction(async (client) => {
      const subscription = await this.lockCurrentSubscription(client, tenantId);
      const feature = await client.query("select 1 from saas_features where code = $1", [featureCode]);
      if (!feature.rowCount) {
        throw new BadRequestException({ code: "FEATURE_NOT_FOUND", message: "La funcionalidad indicada no existe." });
      }
      if (enabled === null) {
        await client.query(
          "delete from subscription_feature_overrides where subscription_id = $1 and feature_code = $2",
          [subscription.id, featureCode]
        );
      } else {
        await client.query(
          `insert into subscription_feature_overrides (subscription_id, feature_code, is_enabled)
           values ($1, $2, $3)
           on conflict (subscription_id, feature_code) do update set is_enabled = excluded.is_enabled`,
          [subscription.id, featureCode, enabled]
        );
      }
      await recordPlatformAudit(client, operatorId, tenantId, "saas.feature_override.set", "tenant_subscription", subscription.id, {
        featureCode,
        enabled
      });
    });
  }

  private async applyStatus(client: PoolClient, subscription: SubscriptionRow, next: SubscriptionStatus, now: Date): Promise<void> {
    const transition = transitionSubscription(subscription.status, next, now);
    await client.query(
      `update tenant_subscriptions
       set status = $2::varchar,
           grace_ends_at = $3::timestamptz,
           suspended_at = case when $2::varchar = 'SUSPENDED' then $4::timestamptz else null end,
           canceled_at = case when $2::varchar = 'CANCELED' then $4::timestamptz else canceled_at end,
           updated_at = $4::timestamptz
       where id = $1`,
      [subscription.id, transition.status, transition.graceEndsAt ?? null, now]
    );
    subscription.status = transition.status;
    subscription.graceEndsAt = transition.graceEndsAt ?? null;
  }

  private async lockSubscription(client: PoolClient, subscriptionId: string): Promise<SubscriptionRow | undefined> {
    const { rows } = await client.query<SubscriptionRow>(
      `select ${subscriptionColumns}
       from tenant_subscriptions as subscription
       join subscription_plans as plan on plan.id = subscription.plan_id
       where subscription.id = $1
       for update of subscription`,
      [subscriptionId]
    );
    return rows[0];
  }

  private async lockCurrentSubscription(client: PoolClient, tenantId: string): Promise<SubscriptionRow> {
    const { rows } = await client.query<SubscriptionRow>(
      `select ${subscriptionColumns}
       from tenant_subscriptions as subscription
       join subscription_plans as plan on plan.id = subscription.plan_id
       where subscription.tenant_id = $1 and subscription.status <> 'CANCELED'
       for update of subscription`,
      [tenantId]
    );
    const subscription = rows[0];
    if (!subscription) {
      throw new NotFoundException({ code: "SUBSCRIPTION_NOT_FOUND", message: "La farmacia no tiene una suscripción vigente." });
    }
    return subscription;
  }

  private async lockPendingPayment(
    client: PoolClient,
    paymentId: string
  ): Promise<{ id: string; tenantId: string; invoiceId: string; amountBob: string }> {
    const { rows } = await client.query<{ id: string; tenantId: string; invoiceId: string; amountBob: string; status: string }>(
      `select id, tenant_id as "tenantId", invoice_id as "invoiceId", amount_bob::text as "amountBob", status
       from saas_payments where id = $1 for update`,
      [paymentId]
    );
    const payment = rows[0];
    if (!payment) {
      throw new NotFoundException({ code: "PAYMENT_NOT_FOUND", message: "El pago no existe." });
    }
    if (payment.status !== "PENDING") {
      throw new ConflictException({ code: "PAYMENT_ALREADY_REVIEWED", message: "Este pago ya fue revisado." });
    }
    return payment;
  }
}

function isBillable(subscription: SubscriptionRow): boolean {
  return Number(subscription.priceMonthlyBob) > 0;
}

function maxDate(current: Date | null, candidate: Date): Date {
  return current && current > candidate ? current : candidate;
}

export async function recordPlatformAudit(
  client: PoolClient,
  operatorId: string | null,
  tenantId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  payload: Record<string, unknown>
): Promise<void> {
  await client.query(
    `insert into platform_audit_events (operator_id, tenant_id, action, entity_type, entity_id, payload)
     values ($1, $2, $3, $4, $5, $6)`,
    [operatorId, tenantId, action, entityType, entityId, JSON.stringify(payload)]
  );
}
