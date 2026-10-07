import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { TenantDatabase, type TenantScope } from "../database/tenant-database.js";
import { FeatureService } from "../subscriptions/feature.service.js";
import { AuditService } from "../transversal/audit.service.js";
import { invalid, requireFeature, uuidPattern } from "../staff/staff.common.js";
import { LOYALTY_FEATURE } from "./customers.service.js";
import {
  customerBalance,
  insertMovement,
  loadLoyaltySettings,
  lockCustomer,
  type LoyaltyKind,
  type LoyaltySettings
} from "./loyalty-ledger.js";

const MAX_ADJUSTMENT = 1_000_000;
const decimalPattern = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,4})?$/;

export interface LoyaltySettingsInput {
  enabled?: boolean;
  bobPerPoint?: number | string;
  pointValueBob?: number | string;
}

export interface LoyaltyMovement {
  id: string;
  kind: LoyaltyKind;
  points: number;
  reason: string;
  saleId: string | null;
  /** Only resolvable for sales of the active branch. */
  saleNumber: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface CustomerLoyalty {
  customerId: string;
  balance: number;
  settings: LoyaltySettings;
  movements: { items: LoyaltyMovement[]; total: number; limit: number; offset: number };
}

function money(value: unknown, field: string): string {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!decimalPattern.test(text) || Number(text) <= 0) {
    throw invalid(field, "Debe ser un monto mayor a cero con hasta 4 decimales.");
  }
  return text;
}

function pageValue(value: unknown, field: string, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw invalid(field, "El valor está fuera de rango.");
  }
  return value;
}

function customerNotFound(): NotFoundException {
  return new NotFoundException({ code: "CUSTOMER_NOT_FOUND", message: "Cliente no encontrado." });
}

@Injectable()
export class LoyaltyService {
  private readonly features: FeatureService;
  private readonly audit = new AuditService();

  constructor(@Inject(TenantDatabase) private readonly database: TenantDatabase) {
    this.features = new FeatureService(database);
  }

  async getSettings(scope: TenantScope): Promise<LoyaltySettings> {
    await requireFeature(this.features, scope, LOYALTY_FEATURE);
    return this.database.withScope(scope, (client) => loadLoyaltySettings(client, scope.tenantId));
  }

  async updateSettings(scope: TenantScope, input: LoyaltySettingsInput): Promise<LoyaltySettings> {
    await requireFeature(this.features, scope, LOYALTY_FEATURE);
    const hasEnabled = input?.enabled !== undefined;
    const hasEarn = input?.bobPerPoint !== undefined;
    const hasValue = input?.pointValueBob !== undefined;
    if (!hasEnabled && !hasEarn && !hasValue) throw invalid("enabled", "Indique al menos un valor a cambiar.");
    if (hasEnabled && typeof input.enabled !== "boolean") throw invalid("enabled", "El estado no es válido.");
    const bobPerPoint = hasEarn ? money(input.bobPerPoint, "bobPerPoint") : null;
    const pointValueBob = hasValue ? money(input.pointValueBob, "pointValueBob") : null;
    return this.database.withScope(scope, async (client) => {
      const current = await loadLoyaltySettings(client, scope.tenantId);
      await client.query(
        `insert into loyalty_settings (tenant_id, enabled, bob_per_point, point_value_bob, updated_at)
         values ($1, $2, $3::numeric, $4::numeric, now())
         on conflict (tenant_id) do update
           set enabled = excluded.enabled, bob_per_point = excluded.bob_per_point,
               point_value_bob = excluded.point_value_bob, updated_at = now()`,
        [scope.tenantId, hasEnabled ? input.enabled : current.enabled, bobPerPoint ?? current.bobPerPoint, pointValueBob ?? current.pointValueBob]
      );
      const settings = await loadLoyaltySettings(client, scope.tenantId);
      await this.audit.recordInTransaction(client, scope, {
        action: "crm.loyalty_settings.updated",
        entityType: "loyalty_settings",
        entityId: scope.tenantId,
        payload: { before: current, after: settings }
      });
      return settings;
    });
  }

  async customerLoyalty(
    scope: TenantScope,
    customerId: string,
    query: { limit?: number; offset?: number }
  ): Promise<CustomerLoyalty> {
    await requireFeature(this.features, scope, LOYALTY_FEATURE);
    const limit = pageValue(query.limit, "limit", 20, 1, 100);
    const offset = pageValue(query.offset, "offset", 0, 0, 1_000_000);
    if (!uuidPattern.test(customerId ?? "")) throw customerNotFound();
    return this.database.withScope(scope, async (client) => {
      const exists = await client.query("select 1 from customers where tenant_id = $1 and id = $2", [scope.tenantId, customerId]);
      if (!exists.rowCount) throw customerNotFound();
      const rows = await client.query<{
        id: string;
        kind: LoyaltyKind;
        points: number;
        reason: string;
        saleId: string | null;
        saleNumber: string | null;
        createdByName: string | null;
        createdAt: Date;
      }>(
        `select m.id, m.kind, m.points, m.reason, m.sale_id as "saleId", s.sale_number as "saleNumber",
                u.display_name as "createdByName", m.created_at as "createdAt"
         from loyalty_movements m
         left join sales s on s.tenant_id = m.tenant_id and s.branch_id = m.branch_id and s.id = m.sale_id
         left join users u on u.id = m.created_by_user_id
         where m.tenant_id = $1 and m.customer_id = $2
         order by m.created_at desc, m.id desc limit $3 offset $4`,
        [scope.tenantId, customerId, limit, offset]
      );
      const total = await client.query<{ n: number }>(
        "select count(*)::int as n from loyalty_movements where tenant_id = $1 and customer_id = $2",
        [scope.tenantId, customerId]
      );
      return {
        customerId,
        balance: await customerBalance(client, scope.tenantId, customerId),
        settings: await loadLoyaltySettings(client, scope.tenantId),
        movements: {
          items: rows.rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
          total: total.rows[0]?.n ?? 0,
          limit,
          offset
        }
      };
    });
  }

  /** Manual +/- adjustment with a reason; the balance can never go below zero. */
  async adjust(
    scope: TenantScope,
    customerId: string,
    input: { points: number; reason: string }
  ): Promise<LoyaltyMovement & { balance: number }> {
    await requireFeature(this.features, scope, LOYALTY_FEATURE);
    const points = input?.points;
    if (typeof points !== "number" || !Number.isInteger(points) || points === 0 || Math.abs(points) > MAX_ADJUSTMENT) {
      throw invalid("points", "Los puntos deben ser un entero distinto de cero (máximo 1.000.000).");
    }
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (!reason || reason.length > 200) throw invalid("reason", "Indique el motivo (hasta 200 caracteres).");
    if (!uuidPattern.test(customerId ?? "")) throw customerNotFound();
    return this.database.withScope(scope, async (client) => {
      const customer = await lockCustomer(client, scope.tenantId, customerId);
      if (!customer) throw customerNotFound();
      const before = await customerBalance(client, scope.tenantId, customerId);
      if (before + points < 0) {
        throw new BadRequestException({
          code: "INSUFFICIENT_POINTS",
          message: "El ajuste dejaría el saldo de puntos en negativo.",
          balance: before
        });
      }
      const movementId = await insertMovement(client, scope, { customerId, kind: "ADJUST", points, reason });
      await this.audit.recordInTransaction(client, scope, {
        action: "crm.loyalty.adjusted",
        entityType: "customer",
        entityId: customerId,
        payload: { movementId, points, reason, balanceBefore: before }
      });
      const stored = await client.query<{ createdAt: Date; createdByName: string | null }>(
        `select m.created_at as "createdAt", u.display_name as "createdByName"
         from loyalty_movements m left join users u on u.id = m.created_by_user_id where m.id = $1`,
        [movementId]
      );
      return {
        id: movementId,
        kind: "ADJUST" as const,
        points,
        reason,
        saleId: null,
        saleNumber: null,
        createdByName: stored.rows[0]?.createdByName ?? null,
        createdAt: stored.rows[0]!.createdAt.toISOString(),
        balance: before + points
      };
    });
  }
}
