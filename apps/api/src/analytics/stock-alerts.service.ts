import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnApplicationShutdown
} from "@nestjs/common";
import { TenantDatabase, type TenantScope } from "../database/tenant-database.js";
import { PlatformDatabase } from "../saas/platform-database.js";
import { invalid, requireUuid } from "../staff/staff.common.js";
import { availableStockByPresentation, forEachBranch, laPazDay, netSalesByPresentation } from "./analytics-data.js";
import { VELOCITY_DAYS, findShortages, type ShortageKind } from "./analytics-stockouts.js";

export interface StockAlert {
  id: string;
  branchId: string;
  branchName: string;
  presentationId: string;
  productName: string;
  presentationName: string;
  kind: ShortageKind;
  daysOfStock: number | null;
  availableBase: number;
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

export interface StockAlertList {
  items: StockAlert[];
  unacknowledged: number;
}

export interface StockAlertScanResult {
  tenants: number;
  created: number;
  resolved: number;
}

export interface StockAlertQuery {
  status?: string;
  branchId?: string;
}

const MAX_ALERTS = 200;
export const ALERT_FEATURE = "analytics.profitability";

/** Pharmacies whose current plan (or add-on override) includes the feature and whose subscription still gives access. */
const ENTITLED_TENANTS_SQL = `
  select distinct subscription.tenant_id as "tenantId"
  from tenant_subscriptions subscription
  join subscription_plans plan on plan.id = subscription.plan_id
  left join plan_features plan_feature on plan_feature.plan_id = plan.id and plan_feature.feature_code = $1
  left join subscription_feature_overrides override on override.subscription_id = subscription.id and override.feature_code = $1
  where (subscription.status = 'ACTIVE'
         or (subscription.status = 'TRIALING' and subscription.trial_ends_at > now())
         or (subscription.status = 'PAST_DUE' and subscription.grace_ends_at > now()))
    and coalesce(override.is_enabled, plan.allows_all_features or coalesce(plan_feature.is_enabled, false))`;

/**
 * Shortage alerts (D74). The scan runs with the platform role because it walks every pharmacy; reads and
 * acknowledgements go through the tenant scope, one branch at a time.
 */
@Injectable()
export class StockAlertsService {
  private readonly logger = new Logger("StockAlertsService");

  constructor(
    @Inject(TenantDatabase) private readonly database: TenantDatabase,
    @Inject(PlatformDatabase) private readonly platform: PlatformDatabase
  ) {}

  /** Opens alerts for current shortages, refreshes the open ones and resolves those that no longer apply. Idempotent. */
  async scan(): Promise<StockAlertScanResult> {
    const tenants = await this.platform.withTransaction(async (client) => {
      const result = await client.query<{ tenantId: string }>(ENTITLED_TENANTS_SQL, [ALERT_FEATURE]);
      return result.rows.map((row) => row.tenantId);
    });
    const total: StockAlertScanResult = { tenants: 0, created: 0, resolved: 0 };
    for (const tenantId of tenants) {
      try {
        const outcome = await this.scanTenant(tenantId);
        total.tenants += 1;
        total.created += outcome.created;
        total.resolved += outcome.resolved;
      } catch (error) {
        this.logger.error(`Stock alert scan failed for one pharmacy: ${String(error)}`);
      }
    }
    return total;
  }

  private async scanTenant(tenantId: string): Promise<{ created: number; resolved: number }> {
    const from = laPazDay(-(VELOCITY_DAYS - 1));
    const to = laPazDay(0);
    return this.platform.withTransaction(async (client) => {
      const branches = await client.query<{ id: string }>("select id from branches where tenant_id = $1 and is_active order by id", [tenantId]);
      let created = 0;
      let resolved = 0;
      for (const { id: branchId } of branches.rows) {
        const shortages = findShortages(
          await netSalesByPresentation(client, tenantId, branchId, from, to),
          await availableStockByPresentation(client, tenantId, branchId)
        );
        const keep = shortages.map((shortage) => `${shortage.presentationId}:${shortage.kind}`);
        const closed = await client.query(
          `update stock_alerts set resolved_at = now()
           where tenant_id = $1 and branch_id = $2 and resolved_at is null
             and (presentation_id::text || ':' || kind) <> all($3::text[])`,
          [tenantId, branchId, keep]
        );
        resolved += closed.rowCount ?? 0;
        for (const shortage of shortages) {
          const upsert = await client.query<{ inserted: boolean }>(
            `insert into stock_alerts (tenant_id, branch_id, presentation_id, kind, days_of_stock, available_base)
             values ($1, $2, $3, $4, $5, $6)
             on conflict (tenant_id, branch_id, presentation_id, kind) where resolved_at is null
             do update set days_of_stock = excluded.days_of_stock, available_base = excluded.available_base
             returning (xmax = 0) as inserted`,
            [tenantId, branchId, shortage.presentationId, shortage.kind, shortage.daysOfInventory, shortage.availableBase]
          );
          if (upsert.rows[0]?.inserted) created += 1;
        }
      }
      return { created, resolved };
    });
  }

  async list(scope: TenantScope, query: StockAlertQuery): Promise<StockAlertList> {
    const status = query.status ?? "open";
    if (status !== "open" && status !== "all") throw invalid("status", "Use open o all.");
    const branchId = query.branchId ? requireUuid(query.branchId, "branchId") : null;
    const perBranch = await forEachBranch(this.database, scope, branchId, async (client, branch) => {
      const result = await client.query<{
        id: string;
        presentationId: string;
        productName: string;
        presentationName: string;
        kind: ShortageKind;
        daysOfStock: string | null;
        availableBase: string;
        createdAt: Date;
        acknowledgedAt: Date | null;
        resolvedAt: Date | null;
      }>(
        `select alert.id, alert.presentation_id as "presentationId", product.name as "productName", presentation.name as "presentationName",
                alert.kind, alert.days_of_stock::text as "daysOfStock", alert.available_base::text as "availableBase",
                alert.created_at as "createdAt", alert.acknowledged_at as "acknowledgedAt", alert.resolved_at as "resolvedAt"
         from stock_alerts alert
         join product_presentations presentation on presentation.tenant_id = alert.tenant_id and presentation.id = alert.presentation_id
         join products product on product.tenant_id = presentation.tenant_id and product.id = presentation.product_id
         where alert.tenant_id = $1 and alert.branch_id = $2 and ($3 = 'all' or alert.resolved_at is null)
         order by alert.created_at desc
         limit ${MAX_ALERTS}`,
        [scope.tenantId, branch.id, status]
      );
      return result.rows.map(
        (row): StockAlert => ({
          id: row.id,
          branchId: branch.id,
          branchName: branch.name,
          presentationId: row.presentationId,
          productName: row.productName,
          presentationName: row.presentationName,
          kind: row.kind,
          daysOfStock: row.daysOfStock === null ? null : Number(row.daysOfStock),
          availableBase: Number(row.availableBase),
          createdAt: row.createdAt.toISOString(),
          acknowledgedAt: row.acknowledgedAt ? row.acknowledgedAt.toISOString() : null,
          resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null
        })
      );
    });
    const items = perBranch
      .flat()
      .sort(
        (a, b) =>
          Number(a.resolvedAt !== null) - Number(b.resolvedAt !== null) ||
          Number(a.acknowledgedAt !== null) - Number(b.acknowledgedAt !== null) ||
          b.createdAt.localeCompare(a.createdAt)
      )
      .slice(0, MAX_ALERTS);
    return { items, unacknowledged: items.filter((item) => item.resolvedAt === null && item.acknowledgedAt === null).length };
  }

  /** Acknowledges an open alert of any branch the user belongs to (RLS decides which branch holds it). Idempotent. */
  async acknowledge(scope: TenantScope, id: string): Promise<{ id: string; acknowledgedAt: string }> {
    let alertId: string;
    try {
      alertId = requireUuid(id, "id");
    } catch {
      throw new NotFoundException("Alerta no encontrada.");
    }
    const found = await forEachBranch(this.database, scope, null, async (client, branch) => {
      const current = await client.query<{ acknowledgedAt: Date | null; resolvedAt: Date | null }>(
        `select acknowledged_at as "acknowledgedAt", resolved_at as "resolvedAt"
         from stock_alerts where tenant_id = $1 and branch_id = $2 and id = $3 for update`,
        [scope.tenantId, branch.id, alertId]
      );
      const row = current.rows[0];
      if (!row) return undefined;
      if (row.resolvedAt) throw new ConflictException("La alerta ya fue resuelta.");
      if (row.acknowledgedAt) return row.acknowledgedAt;
      const updated = await client.query<{ acknowledgedAt: Date }>(
        `update stock_alerts set acknowledged_at = now(), acknowledged_by_user_id = $2 where id = $1 returning acknowledged_at as "acknowledgedAt"`,
        [alertId, scope.userId]
      );
      return updated.rows[0]!.acknowledgedAt;
    });
    const acknowledgedAt = found[0];
    if (!acknowledgedAt) throw new NotFoundException("Alerta no encontrada.");
    return { id: alertId, acknowledgedAt: acknowledgedAt.toISOString() };
  }
}

/** Runs the shortage scan every STOCK_ALERT_INTERVAL_MINUTES (60 by default); disabled when NODE_ENV is "test". */
@Injectable()
export class StockAlertScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("StockAlertScheduler");
  private timer?: NodeJS.Timeout;

  constructor(@Inject(StockAlertsService) private readonly alerts: StockAlertsService) {}

  onApplicationBootstrap(): void {
    const minutes = Number(process.env.STOCK_ALERT_INTERVAL_MINUTES ?? 60);
    if (process.env.NODE_ENV === "test" || !Number.isFinite(minutes) || minutes <= 0) {
      return;
    }
    const run = () => {
      this.alerts.scan().then(
        (result) => this.logger.log(`Stock alert scan: ${JSON.stringify(result)}`),
        (error: unknown) => this.logger.error(`Stock alert scan failed: ${String(error)}`)
      );
    };
    setTimeout(run, 30_000).unref();
    this.timer = setInterval(run, minutes * 60_000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }
}
