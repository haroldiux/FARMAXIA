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

export type InventoryAlertType = "EXPIRING" | "EXPIRED";

export interface InventoryAlert {
  id: string;
  alertType: InventoryAlertType;
  warehouseId: string;
  warehouseName: string;
  batchId: string;
  lotCode: string;
  productName: string;
  presentationName: string;
  expiresOn: string;
  daysToExpiry: number;
  quantityBase: number;
  createdAt: string;
  acknowledgedAt: string | null;
}

export interface AlertScanResult {
  created: number;
  resolved: number;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dateOnly(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

export function alertHorizonDays(): number {
  const days = Number(process.env.INVENTORY_ALERT_HORIZON_DAYS ?? 30);
  return Number.isSafeInteger(days) && days >= 1 && days <= 365 ? days : 30;
}

/**
 * Alertas automáticas de vencimiento. El escaneo corre con el rol de plataforma
 * porque recorre todas las farmacias; cada sucursal solo lee las suyas.
 */
@Injectable()
export class InventoryAlertsService {
  constructor(
    @Inject(TenantDatabase) private readonly database: TenantDatabase,
    @Inject(PlatformDatabase) private readonly platform: PlatformDatabase
  ) {}

  /** Crea alertas nuevas, actualiza cantidades y cierra las que ya no aplican. Idempotente. */
  async scan(horizonDays = alertHorizonDays()): Promise<AlertScanResult> {
    return this.platform.withTransaction(async (client) => {
      // Cierra alertas cuyo lote ya no tiene stock o que pasaron de "por vencer" a "vencido".
      const resolved = await client.query(
        `update inventory_alerts a
         set resolved_at = now()
         from inventory_batches b
         where a.resolved_at is null
           and b.tenant_id = a.tenant_id and b.id = a.batch_id
           and (
             (a.alert_type = 'EXPIRING' and b.expires_on < current_date)
             or coalesce((select ib.quantity_base from inventory_balances ib
                          where ib.tenant_id = a.tenant_id and ib.warehouse_id = a.warehouse_id
                            and ib.batch_id = a.batch_id), 0) = 0
           )`
      );
      const created = await client.query(
        `insert into inventory_alerts (tenant_id, branch_id, warehouse_id, batch_id, alert_type, expires_on, quantity_base)
         select ib.tenant_id, w.branch_id, ib.warehouse_id, ib.batch_id,
                case when b.expires_on < current_date then 'EXPIRED' else 'EXPIRING' end,
                b.expires_on, ib.quantity_base
         from inventory_balances ib
         join inventory_batches b on b.tenant_id = ib.tenant_id and b.id = ib.batch_id
         join warehouses w on w.tenant_id = ib.tenant_id and w.id = ib.warehouse_id
         where ib.quantity_base > 0
           and b.status <> 'DISPOSED'
           and b.expires_on <= current_date + $1::int
         on conflict (tenant_id, warehouse_id, batch_id, alert_type) where resolved_at is null do nothing`,
        [horizonDays]
      );
      await client.query(
        `update inventory_alerts a
         set quantity_base = ib.quantity_base
         from inventory_balances ib
         where a.resolved_at is null
           and ib.tenant_id = a.tenant_id and ib.warehouse_id = a.warehouse_id and ib.batch_id = a.batch_id
           and ib.quantity_base > 0 and ib.quantity_base <> a.quantity_base`
      );
      return { created: created.rowCount ?? 0, resolved: resolved.rowCount ?? 0 };
    });
  }

  async list(scope: TenantScope, includeAcknowledged = true): Promise<{ items: InventoryAlert[]; unacknowledged: number }> {
    return this.database.withScope(scope, async (client) => {
      const result = await client.query<{
        id: string;
        alertType: InventoryAlertType;
        warehouseId: string;
        warehouseName: string;
        batchId: string;
        lotCode: string;
        productName: string;
        presentationName: string;
        expiresOn: string | Date;
        daysToExpiry: number;
        quantityBase: string;
        createdAt: Date;
        acknowledgedAt: Date | null;
      }>(
        `select a.id, a.alert_type as "alertType", a.warehouse_id as "warehouseId", w.name as "warehouseName",
                a.batch_id as "batchId", b.lot_code as "lotCode", p.name as "productName",
                pp.name as "presentationName", a.expires_on as "expiresOn",
                (a.expires_on - current_date)::int as "daysToExpiry",
                coalesce(ib.quantity_base, 0) as "quantityBase", a.created_at as "createdAt", a.acknowledged_at as "acknowledgedAt"
         from inventory_alerts a
         join warehouses w on w.tenant_id = a.tenant_id and w.id = a.warehouse_id
         join inventory_batches b on b.tenant_id = a.tenant_id and b.id = a.batch_id
         join product_presentations pp on pp.tenant_id = b.tenant_id and pp.id = b.presentation_id
         join products p on p.tenant_id = pp.tenant_id and p.id = pp.product_id
         left join inventory_balances ib
           on ib.tenant_id = a.tenant_id and ib.warehouse_id = a.warehouse_id and ib.batch_id = a.batch_id
         where a.tenant_id = $1 and a.branch_id = $2 and a.resolved_at is null
           and ($3::boolean or a.acknowledged_at is null)
         order by (a.acknowledged_at is null) desc, a.expires_on asc
         limit 200`,
        [scope.tenantId, scope.branchId, includeAcknowledged]
      );
      const items = result.rows.map((row) => ({
        id: row.id,
        alertType: row.alertType,
        warehouseId: row.warehouseId,
        warehouseName: row.warehouseName,
        batchId: row.batchId,
        lotCode: row.lotCode,
        productName: row.productName,
        presentationName: row.presentationName,
        expiresOn: dateOnly(row.expiresOn),
        daysToExpiry: row.daysToExpiry,
        quantityBase: Number(row.quantityBase),
        createdAt: row.createdAt.toISOString(),
        acknowledgedAt: row.acknowledgedAt ? row.acknowledgedAt.toISOString() : null
      }));
      return { items, unacknowledged: items.filter((item) => !item.acknowledgedAt).length };
    });
  }

  async acknowledge(scope: TenantScope, id: string): Promise<{ id: string; acknowledgedAt: string }> {
    if (!uuidPattern.test(id)) {
      throw new NotFoundException("Alerta no encontrada.");
    }
    return this.database.withScope(scope, async (client) => {
      const current = await client.query<{ acknowledgedAt: Date | null; resolvedAt: Date | null }>(
        `select acknowledged_at as "acknowledgedAt", resolved_at as "resolvedAt"
         from inventory_alerts where tenant_id = $1 and branch_id = $2 and id = $3 for update`,
        [scope.tenantId, scope.branchId, id]
      );
      const row = current.rows[0];
      if (!row) {
        throw new NotFoundException("Alerta no encontrada.");
      }
      if (row.resolvedAt) {
        throw new ConflictException("La alerta ya fue resuelta.");
      }
      if (row.acknowledgedAt) {
        return { id, acknowledgedAt: row.acknowledgedAt.toISOString() };
      }
      const updated = await client.query<{ acknowledgedAt: Date }>(
        `update inventory_alerts set acknowledged_at = now(), acknowledged_by_user_id = $2
         where id = $1 returning acknowledged_at as "acknowledgedAt"`,
        [id, scope.userId]
      );
      return { id, acknowledgedAt: updated.rows[0]!.acknowledgedAt.toISOString() };
    });
  }
}

/** Ejecuta el escaneo de vencimientos cada INVENTORY_ALERT_INTERVAL_MINUTES (60 por defecto). */
@Injectable()
export class InventoryAlertScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("InventoryAlertScheduler");
  private timer?: NodeJS.Timeout;

  constructor(@Inject(InventoryAlertsService) private readonly alerts: InventoryAlertsService) {}

  onApplicationBootstrap(): void {
    const minutes = Number(process.env.INVENTORY_ALERT_INTERVAL_MINUTES ?? 60);
    if (process.env.NODE_ENV === "test" || !Number.isFinite(minutes) || minutes <= 0) {
      return;
    }
    const run = () => {
      this.alerts.scan().then(
        (result) => this.logger.log(`Expiry alert scan: ${JSON.stringify(result)}`),
        (error: unknown) => this.logger.error(`Expiry alert scan failed: ${String(error)}`)
      );
    };
    setTimeout(run, 15_000).unref();
    this.timer = setInterval(run, minutes * 60_000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }
}
