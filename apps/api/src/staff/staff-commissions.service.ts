import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { TenantDatabase, type TenantScope } from "../database/tenant-database.js";
import { FeatureService } from "../subscriptions/feature.service.js";
import { AuditService } from "../transversal/audit.service.js";
import { ZONE, featureEnabled, invalid, requireFeature, requiredPeriod, uuidPattern } from "./staff.common.js";

const FEATURE = "staff.commissions";
const MULTILEVEL_FEATURE = "staff.commissions.multilevel";
const SCOPES = ["DEFAULT", "CATEGORY", "PRODUCT"] as const;

export type RuleScope = (typeof SCOPES)[number];
export type RateSource = "PRODUCT" | "CATEGORY" | "DEFAULT" | "TIER" | "NONE";

export interface CommissionRule {
  id: string;
  scope: RuleScope;
  targetId: string | null;
  /** Product or category name; null for the default rule. */
  targetName: string | null;
  /** Percent with 2 decimals, e.g. "5.00". */
  ratePercent: string;
  isActive: boolean;
  createdAt: string;
}

export interface CommissionTier {
  id: string;
  /** Minimum net sales of the seller in the report period (BOB, 2 decimals). */
  minNetSalesBob: string;
  ratePercent: string;
  createdAt: string;
}

export interface RuleInput {
  scope: RuleScope;
  targetId?: string | null;
  ratePercent: number | string;
  isActive?: boolean;
}

export interface TierInput {
  minNetSalesBob: number | string;
  ratePercent: number | string;
}

export interface CommissionLine {
  saleId: string;
  saleNumber: string;
  /** YYYY-MM-DD, Bolivia time. */
  saleDate: string;
  saleItemId: string;
  productId: string;
  productName: string;
  presentationName: string;
  quantity: number;
  lineTotalBob: string;
  returnedBob: string;
  /** Commission base: line total minus returned amount. */
  netBob: string;
  ratePercent: string;
  rateSource: RateSource;
  commissionBob: string;
}

export interface SellerCommission {
  userId: string;
  userName: string;
  netSalesBob: string;
  /** Tier rate reached by the seller's net sales; null when multilevel is off or no tier is reached. */
  tierRatePercent: string | null;
  commissionBob: string;
  lines: CommissionLine[];
}

export interface CommissionReport {
  from: string;
  to: string;
  /** True when the plan includes staff.commissions.multilevel (tiers were considered). */
  multilevelApplied: boolean;
  sellers: SellerCommission[];
  totalCommissionBob: string;
}

interface RuleRow {
  id: string;
  scope: RuleScope;
  targetId: string | null;
  targetName: string | null;
  ratePercent: string;
  isActive: boolean;
  createdAt: Date;
}

interface TierRow {
  id: string;
  minNetSalesBob: string;
  ratePercent: string;
  createdAt: Date;
}

interface LineRow {
  sellerId: string;
  sellerName: string;
  tierRate: string | null;
  saleId: string;
  saleNumber: string;
  saleDate: string;
  saleItemId: string;
  productId: string;
  productName: string;
  presentationName: string;
  quantity: string;
  lineTotal: string;
  returned: string;
  net: string;
  rate: string;
  source: RateSource;
  commission: string;
}

const ruleSelect = `
  select r.id, r.scope, r.target_id as "targetId", coalesce(p.name, c.name) as "targetName",
         r.rate_percent::text as "ratePercent", r.is_active as "isActive", r.created_at as "createdAt"
  from commission_rules r
  left join products p on r.scope = 'PRODUCT' and p.tenant_id = r.tenant_id and p.id = r.target_id
  left join product_categories c on r.scope = 'CATEGORY' and c.tenant_id = r.tenant_id and c.id = r.target_id`;

const tierSelect = `select id, min_net_sales_bob::text as "minNetSalesBob", rate_percent::text as "ratePercent", created_at as "createdAt" from commission_tiers`;

/** Exact decimal text with at most `scale` decimals, within [0, max]. */
function decimal(value: unknown, field: string, max: number, scale = 2): string {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string" || !new RegExp(`^\\d{1,12}(\\.\\d{1,${scale}})?$`).test(text.trim())) {
    throw invalid(field, `El valor no es válido (número positivo con hasta ${scale} decimales).`);
  }
  const normalized = text.trim();
  if (Number(normalized) > max) throw invalid(field, `El valor no puede superar ${max}.`);
  return normalized;
}

const rate = (value: unknown) => decimal(value, "ratePercent", 100);

function toRule(row: RuleRow): CommissionRule {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

function toTier(row: TierRow): CommissionTier {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

function validId(value: string): boolean {
  return typeof value === "string" && uuidPattern.test(value);
}

@Injectable()
export class StaffCommissionsService {
  private readonly features: FeatureService;
  private readonly audit = new AuditService();

  constructor(@Inject(TenantDatabase) private readonly database: TenantDatabase) {
    this.features = new FeatureService(database);
  }

  async listRules(scope: TenantScope): Promise<CommissionRule[]> {
    await requireFeature(this.features, scope, FEATURE);
    return this.database.withScope(scope, async (client) => {
      const rows = await client.query<RuleRow>(
        `${ruleSelect} where r.tenant_id = $1
         order by array_position(array['DEFAULT','CATEGORY','PRODUCT'], r.scope::text), coalesce(p.name, c.name), r.id`,
        [scope.tenantId]
      );
      return rows.rows.map(toRule);
    });
  }

  async createRule(scope: TenantScope, input: RuleInput): Promise<CommissionRule> {
    await requireFeature(this.features, scope, FEATURE);
    if (!SCOPES.includes(input?.scope)) throw invalid("scope", "El alcance debe ser DEFAULT, CATEGORY o PRODUCT.");
    const ratePercent = rate(input.ratePercent);
    const targetId = input.targetId ?? null;
    if (input.scope === "DEFAULT" && targetId !== null) throw invalid("targetId", "La regla general no lleva producto ni categoría.");
    if (input.scope !== "DEFAULT" && !validId(targetId as string)) throw invalid("targetId", "Seleccione el producto o la categoría.");
    const isActive = input.isActive ?? true;
    if (typeof isActive !== "boolean") throw invalid("isActive", "El estado no es válido.");

    return this.database.withScope(scope, async (client) => {
      if (input.scope !== "DEFAULT") {
        const table = input.scope === "PRODUCT" ? "products" : "product_categories";
        const exists = await client.query(`select 1 from ${table} where tenant_id = $1 and id = $2`, [scope.tenantId, targetId]);
        if (!exists.rowCount) throw invalid("targetId", "El producto o la categoría no existe.");
      }
      const duplicate = await client.query(
        `select 1 from commission_rules where tenant_id = $1 and scope = $2 and target_id is not distinct from $3::uuid`,
        [scope.tenantId, input.scope, targetId]
      );
      if (duplicate.rowCount) {
        throw new ConflictException({ code: "RULE_EXISTS", message: "Ya existe una regla para ese alcance." });
      }
      const inserted = await client.query<{ id: string }>(
        `insert into commission_rules (tenant_id, scope, target_id, rate_percent, is_active) values ($1, $2, $3, $4, $5) returning id`,
        [scope.tenantId, input.scope, targetId, ratePercent, isActive]
      );
      const ruleId = inserted.rows[0]!.id;
      await this.audit.recordInTransaction(client, scope, {
        action: "staff.commission_rule.created",
        entityType: "commission_rule",
        entityId: ruleId,
        payload: { scope: input.scope, targetId, ratePercent, isActive }
      });
      const rows = await client.query<RuleRow>(`${ruleSelect} where r.tenant_id = $1 and r.id = $2`, [scope.tenantId, ruleId]);
      return toRule(rows.rows[0]!);
    });
  }

  async updateRule(scope: TenantScope, ruleId: string, input: { ratePercent?: number | string; isActive?: boolean }): Promise<CommissionRule> {
    await requireFeature(this.features, scope, FEATURE);
    const ratePercent = input?.ratePercent === undefined ? null : rate(input.ratePercent);
    if (input?.isActive !== undefined && typeof input.isActive !== "boolean") throw invalid("isActive", "El estado no es válido.");
    const isActive = input?.isActive ?? null;
    return this.database.withScope(scope, async (client) => {
      const updated = validId(ruleId)
        ? await client.query(
            `update commission_rules set rate_percent = coalesce($3::numeric, rate_percent), is_active = coalesce($4::boolean, is_active)
             where tenant_id = $1 and id = $2`,
            [scope.tenantId, ruleId, ratePercent, isActive]
          )
        : null;
      if (!updated?.rowCount) throw new NotFoundException({ code: "RULE_NOT_FOUND", message: "Regla no encontrada." });
      await this.audit.recordInTransaction(client, scope, {
        action: "staff.commission_rule.updated",
        entityType: "commission_rule",
        entityId: ruleId,
        payload: { ratePercent, isActive }
      });
      const rows = await client.query<RuleRow>(`${ruleSelect} where r.tenant_id = $1 and r.id = $2`, [scope.tenantId, ruleId]);
      return toRule(rows.rows[0]!);
    });
  }

  async deleteRule(scope: TenantScope, ruleId: string): Promise<void> {
    await requireFeature(this.features, scope, FEATURE);
    await this.database.withScope(scope, async (client) => {
      const deleted = validId(ruleId) ? await client.query("delete from commission_rules where tenant_id = $1 and id = $2", [scope.tenantId, ruleId]) : null;
      if (!deleted?.rowCount) throw new NotFoundException({ code: "RULE_NOT_FOUND", message: "Regla no encontrada." });
      await this.audit.recordInTransaction(client, scope, {
        action: "staff.commission_rule.deleted",
        entityType: "commission_rule",
        entityId: ruleId
      });
    });
  }

  async listTiers(scope: TenantScope): Promise<CommissionTier[]> {
    await requireFeature(this.features, scope, MULTILEVEL_FEATURE);
    return this.database.withScope(scope, async (client) => {
      const rows = await client.query<TierRow>(`${tierSelect} where tenant_id = $1 order by min_net_sales_bob`, [scope.tenantId]);
      return rows.rows.map(toTier);
    });
  }

  async createTier(scope: TenantScope, input: TierInput): Promise<CommissionTier> {
    await requireFeature(this.features, scope, MULTILEVEL_FEATURE);
    const minNetSalesBob = decimal(input?.minNetSalesBob, "minNetSalesBob", 1_000_000_000);
    const ratePercent = rate(input?.ratePercent);
    return this.database.withScope(scope, async (client) => {
      const duplicate = await client.query("select 1 from commission_tiers where tenant_id = $1 and min_net_sales_bob = $2::numeric", [scope.tenantId, minNetSalesBob]);
      if (duplicate.rowCount) {
        throw new ConflictException({ code: "TIER_EXISTS", message: "Ya existe un nivel con ese monto mínimo." });
      }
      const inserted = await client.query<TierRow>(
        `insert into commission_tiers (tenant_id, min_net_sales_bob, rate_percent) values ($1, $2, $3)
         returning id, min_net_sales_bob::text as "minNetSalesBob", rate_percent::text as "ratePercent", created_at as "createdAt"`,
        [scope.tenantId, minNetSalesBob, ratePercent]
      );
      await this.audit.recordInTransaction(client, scope, {
        action: "staff.commission_tier.created",
        entityType: "commission_tier",
        entityId: inserted.rows[0]!.id,
        payload: { minNetSalesBob, ratePercent }
      });
      return toTier(inserted.rows[0]!);
    });
  }

  async updateTier(scope: TenantScope, tierId: string, input: { minNetSalesBob?: number | string; ratePercent?: number | string }): Promise<CommissionTier> {
    await requireFeature(this.features, scope, MULTILEVEL_FEATURE);
    const minNetSalesBob = input?.minNetSalesBob === undefined ? null : decimal(input.minNetSalesBob, "minNetSalesBob", 1_000_000_000);
    const ratePercent = input?.ratePercent === undefined ? null : rate(input.ratePercent);
    return this.database.withScope(scope, async (client) => {
      if (minNetSalesBob !== null) {
        const duplicate = await client.query("select 1 from commission_tiers where tenant_id = $1 and min_net_sales_bob = $2::numeric and id <> $3", [scope.tenantId, minNetSalesBob, validId(tierId) ? tierId : "00000000-0000-0000-0000-000000000000"]);
        if (duplicate.rowCount) throw new ConflictException({ code: "TIER_EXISTS", message: "Ya existe un nivel con ese monto mínimo." });
      }
      const updated = validId(tierId)
        ? await client.query<TierRow>(
            `update commission_tiers set min_net_sales_bob = coalesce($3::numeric, min_net_sales_bob), rate_percent = coalesce($4::numeric, rate_percent)
             where tenant_id = $1 and id = $2
             returning id, min_net_sales_bob::text as "minNetSalesBob", rate_percent::text as "ratePercent", created_at as "createdAt"`,
            [scope.tenantId, tierId, minNetSalesBob, ratePercent]
          )
        : null;
      if (!updated?.rowCount) throw new NotFoundException({ code: "TIER_NOT_FOUND", message: "Nivel no encontrado." });
      await this.audit.recordInTransaction(client, scope, {
        action: "staff.commission_tier.updated",
        entityType: "commission_tier",
        entityId: tierId,
        payload: { minNetSalesBob, ratePercent }
      });
      return toTier(updated.rows[0]!);
    });
  }

  async deleteTier(scope: TenantScope, tierId: string): Promise<void> {
    await requireFeature(this.features, scope, MULTILEVEL_FEATURE);
    await this.database.withScope(scope, async (client) => {
      const deleted = validId(tierId) ? await client.query("delete from commission_tiers where tenant_id = $1 and id = $2", [scope.tenantId, tierId]) : null;
      if (!deleted?.rowCount) throw new NotFoundException({ code: "TIER_NOT_FOUND", message: "Nivel no encontrado." });
      await this.audit.recordInTransaction(client, scope, {
        action: "staff.commission_tier.deleted",
        entityType: "commission_tier",
        entityId: tierId
      });
    });
  }

  /** Commissions of every seller of the active branch for the period (needs staff.reports.read at the controller). */
  async report(scope: TenantScope, query: { from?: string; to?: string }): Promise<CommissionReport> {
    return this.build(scope, query, null);
  }

  /** The caller's own commissions (any member). */
  async myReport(scope: TenantScope, query: { from?: string; to?: string }): Promise<CommissionReport> {
    return this.build(scope, query, scope.userId);
  }

  private async build(scope: TenantScope, query: { from?: string; to?: string }, sellerId: string | null): Promise<CommissionReport> {
    await requireFeature(this.features, scope, FEATURE);
    const period = requiredPeriod(query?.from, query?.to);
    const multilevel = await featureEnabled(this.features, scope, MULTILEVEL_FEATURE);

    const rows = await this.database.withScope(scope, async (client) => {
      const result = await client.query<LineRow>(
        `with lines as (
           select s.created_by_user_id as seller_id, s.id as sale_id, s.sale_number, s.created_at,
                  i.id as item_id, i.quantity, i.line_total_bob,
                  coalesce((select sum(ri.line_total_bob) from sale_return_items ri
                            where ri.tenant_id = i.tenant_id and ri.branch_id = i.branch_id and ri.sale_item_id = i.id), 0) as returned,
                  p.id as product_id, p.name as product_name, p.category_id, pr.name as presentation_name
           from sales s
           join sale_items i on i.tenant_id = s.tenant_id and i.branch_id = s.branch_id and i.sale_id = s.id
           join product_presentations pr on pr.tenant_id = i.tenant_id and pr.id = i.presentation_id
           join products p on p.tenant_id = pr.tenant_id and p.id = pr.product_id
           where s.tenant_id = $1 and s.branch_id = $2 and s.status <> 'VOIDED'
             and s.created_at >= $3::date::timestamp at time zone '${ZONE}'
             and s.created_at < ($4::date + 1)::timestamp at time zone '${ZONE}'
             and ($5::uuid is null or s.created_by_user_id = $5::uuid)
         ), net as (
           select *, greatest(line_total_bob - returned, 0) as net_bob from lines
         ), totals as (
           select seller_id, sum(net_bob) as seller_net from net group by seller_id
         ), rated as (
           select n.*, t.seller_net,
                  coalesce(rp.rate_percent, rc.rate_percent, rd.rate_percent, 0) as base_rate,
                  case when rp.id is not null then 'PRODUCT' when rc.id is not null then 'CATEGORY'
                       when rd.id is not null then 'DEFAULT' else 'NONE' end as base_source,
                  case when $6::boolean then (select ct.rate_percent from commission_tiers ct
                         where ct.tenant_id = $1 and ct.min_net_sales_bob <= t.seller_net
                         order by ct.min_net_sales_bob desc limit 1) end as tier_rate
           from net n
           join totals t on t.seller_id = n.seller_id
           left join commission_rules rp on rp.tenant_id = $1 and rp.scope = 'PRODUCT' and rp.target_id = n.product_id and rp.is_active
           left join commission_rules rc on rc.tenant_id = $1 and rc.scope = 'CATEGORY' and rc.target_id = n.category_id and rc.is_active
           left join commission_rules rd on rd.tenant_id = $1 and rd.scope = 'DEFAULT' and rd.is_active
         ), final as (
           select r.*, case when r.tier_rate is not null and r.tier_rate > r.base_rate then r.tier_rate else r.base_rate end as rate,
                  case when r.tier_rate is not null and r.tier_rate > r.base_rate then 'TIER' else r.base_source end as source
           from rated r
         )
         select f.seller_id as "sellerId", u.display_name as "sellerName", f.tier_rate::numeric(5,2)::text as "tierRate",
                f.sale_id as "saleId", f.sale_number as "saleNumber",
                to_char(f.created_at at time zone '${ZONE}', 'YYYY-MM-DD') as "saleDate",
                f.item_id as "saleItemId", f.product_id as "productId", f.product_name as "productName",
                f.presentation_name as "presentationName", f.quantity::text as quantity,
                round(f.line_total_bob, 2)::text as "lineTotal", round(f.returned, 2)::text as returned,
                round(f.net_bob, 2)::text as net, f.rate::numeric(5,2)::text as rate, f.source,
                round(f.net_bob * f.rate / 100, 2)::text as commission
         from final f join users u on u.id = f.seller_id
         order by u.display_name, f.seller_id, f.created_at, f.item_id`,
        [scope.tenantId, scope.branchId, period.from, period.to, sellerId, multilevel]
      );
      return result.rows;
    });

    const sellers = new Map<string, SellerCommission & { cents: bigint; netCents: bigint }>();
    for (const row of rows) {
      let seller = sellers.get(row.sellerId);
      if (!seller) {
        seller = { userId: row.sellerId, userName: row.sellerName, netSalesBob: "0.00", tierRatePercent: row.tierRate, commissionBob: "0.00", lines: [], cents: 0n, netCents: 0n };
        sellers.set(row.sellerId, seller);
      }
      seller.lines.push({
        saleId: row.saleId,
        saleNumber: row.saleNumber,
        saleDate: row.saleDate,
        saleItemId: row.saleItemId,
        productId: row.productId,
        productName: row.productName,
        presentationName: row.presentationName,
        quantity: Number(row.quantity),
        lineTotalBob: row.lineTotal,
        returnedBob: row.returned,
        netBob: row.net,
        ratePercent: row.rate,
        rateSource: row.source,
        commissionBob: row.commission
      });
      seller.cents += toCents(row.commission);
      seller.netCents += toCents(row.net);
    }
    let total = 0n;
    const result: SellerCommission[] = [];
    for (const { cents, netCents, ...seller } of sellers.values()) {
      total += cents;
      result.push({ ...seller, commissionBob: fromCents(cents), netSalesBob: fromCents(netCents) });
    }
    return { from: period.from, to: period.to, multilevelApplied: multilevel, sellers: result, totalCommissionBob: fromCents(total) };
  }
}

function toCents(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
}

function fromCents(cents: bigint): string {
  const abs = cents < 0n ? -cents : cents;
  return `${cents < 0n ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}
