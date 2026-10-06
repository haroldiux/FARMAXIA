import { Inject, Injectable } from "@nestjs/common";
import { TenantDatabase, type TenantScope } from "../database/tenant-database.js";
import { FeatureService } from "../subscriptions/feature.service.js";
import { ZONE, featureEnabled, requiredPeriod } from "./staff.common.js";

export interface SellerProductivity {
  userId: string;
  userName: string;
  /** Non-voided sales created in the period (fully returned ones included). */
  salesCount: number;
  /** Sum of sale totals minus the refunds registered against them (BOB, 2 decimals). */
  netSalesBob: string;
  /** Units sold net of returned units. */
  units: number;
  /** netSalesBob / salesCount, "0.00" when there are no sales. */
  averageTicketBob: string;
  /** Returns registered against the seller's sales of the period. */
  returnsCount: number;
  returnsBob: string;
  voidsCount: number;
  /** Hours between check-in and check-out of completed shifts; null when the plan lacks staff.shifts. */
  hoursWorked: number | null;
  /** netSalesBob / hoursWorked; null without hours. */
  salesPerHourBob: string | null;
}

export interface ProductivityReport {
  from: string;
  to: string;
  /** True when hours worked are computed (plan includes staff.shifts). */
  hoursAvailable: boolean;
  sellers: SellerProductivity[];
}

const periodFilter = `
  s.tenant_id = $1 and s.branch_id = $2
  and s.created_at >= $3::date::timestamp at time zone '${ZONE}'
  and s.created_at < ($4::date + 1)::timestamp at time zone '${ZONE}'`;

@Injectable()
export class StaffProductivityService {
  private readonly features: FeatureService;

  constructor(@Inject(TenantDatabase) private readonly database: TenantDatabase) {
    this.features = new FeatureService(database);
  }

  async report(scope: TenantScope, query: { from?: string; to?: string }): Promise<ProductivityReport> {
    const period = requiredPeriod(query?.from, query?.to);
    // D64: available on every plan; only an inactive subscription (402) blocks it.
    const hoursAvailable = await featureEnabled(this.features, scope, "staff.shifts");
    const params = [scope.tenantId, scope.branchId, period.from, period.to];

    return this.database.withScope(scope, async (client) => {
      const sales = await client.query<{
        sellerId: string;
        sellerName: string;
        salesCount: number;
        net: string;
        average: string;
        voids: number;
      }>(
        `with base as (
           select s.created_by_user_id as seller_id, s.status,
                  s.total_amount_bob - coalesce((select sum(r.refund_amount_bob) from sale_returns r
                    where r.tenant_id = s.tenant_id and r.branch_id = s.branch_id and r.sale_id = s.id), 0) as net
           from sales s where ${periodFilter}
         )
         select b.seller_id as "sellerId", u.display_name as "sellerName",
                (count(*) filter (where b.status <> 'VOIDED'))::int as "salesCount",
                round(coalesce(sum(b.net) filter (where b.status <> 'VOIDED'), 0), 2)::text as net,
                round(coalesce(sum(b.net) filter (where b.status <> 'VOIDED'), 0)
                      / nullif(count(*) filter (where b.status <> 'VOIDED'), 0), 2)::text as average,
                (count(*) filter (where b.status = 'VOIDED'))::int as voids
         from base b join users u on u.id = b.seller_id
         group by b.seller_id, u.display_name`,
        params
      );
      const units = await client.query<{ sellerId: string; units: string }>(
        `select s.created_by_user_id as "sellerId",
                coalesce(sum(i.quantity - coalesce((select sum(ri.quantity) from sale_return_items ri
                  where ri.tenant_id = i.tenant_id and ri.branch_id = i.branch_id and ri.sale_item_id = i.id), 0)), 0)::text as units
         from sales s join sale_items i on i.tenant_id = s.tenant_id and i.branch_id = s.branch_id and i.sale_id = s.id
         where ${periodFilter} and s.status <> 'VOIDED'
         group by s.created_by_user_id`,
        params
      );
      const returns = await client.query<{ sellerId: string; count: number; total: string }>(
        `select s.created_by_user_id as "sellerId", count(r.id)::int as count, round(coalesce(sum(r.refund_amount_bob), 0), 2)::text as total
         from sales s join sale_returns r on r.tenant_id = s.tenant_id and r.branch_id = s.branch_id and r.sale_id = s.id
         where ${periodFilter}
         group by s.created_by_user_id`,
        params
      );
      const hours = hoursAvailable
        ? await client.query<{ userId: string; userName: string; hours: string }>(
            `select h.user_id as "userId", u.display_name as "userName",
                    round(sum(extract(epoch from (h.checked_out_at - h.checked_in_at))) / 3600, 2)::text as hours
             from staff_shifts h join users u on u.id = h.user_id
             where h.tenant_id = $1 and h.branch_id = $2 and h.checked_out_at is not null
               and h.checked_in_at >= $3::date::timestamp at time zone '${ZONE}'
               and h.checked_in_at < ($4::date + 1)::timestamp at time zone '${ZONE}'
             group by h.user_id, u.display_name`,
            params
          )
        : null;

      const unitsBySeller = new Map(units.rows.map((row) => [row.sellerId, Number(row.units)]));
      const returnsBySeller = new Map(returns.rows.map((row) => [row.sellerId, row]));
      const hoursBySeller = new Map((hours?.rows ?? []).map((row) => [row.userId, Number(row.hours)]));

      const byId = new Map<string, SellerProductivity>();
      const entry = (userId: string, userName: string): SellerProductivity => {
        let seller = byId.get(userId);
        if (!seller) {
          seller = {
            userId,
            userName,
            salesCount: 0,
            netSalesBob: "0.00",
            units: 0,
            averageTicketBob: "0.00",
            returnsCount: 0,
            returnsBob: "0.00",
            voidsCount: 0,
            hoursWorked: hoursAvailable ? 0 : null,
            salesPerHourBob: null
          };
          byId.set(userId, seller);
        }
        return seller;
      };
      for (const row of sales.rows) {
        const seller = entry(row.sellerId, row.sellerName);
        seller.salesCount = row.salesCount;
        seller.netSalesBob = row.net;
        seller.averageTicketBob = row.average ?? "0.00";
        seller.voidsCount = row.voids;
        seller.units = unitsBySeller.get(row.sellerId) ?? 0;
        const sellerReturns = returnsBySeller.get(row.sellerId);
        seller.returnsCount = sellerReturns?.count ?? 0;
        seller.returnsBob = sellerReturns?.total ?? "0.00";
      }
      for (const row of hours?.rows ?? []) entry(row.userId, row.userName);
      for (const seller of byId.values()) {
        if (!hoursAvailable) continue;
        const worked = hoursBySeller.get(seller.userId) ?? 0;
        seller.hoursWorked = worked;
        seller.salesPerHourBob = worked > 0 ? (Number(seller.netSalesBob) / worked).toFixed(2) : null;
      }
      const sellers = [...byId.values()].sort((a, b) => a.userName.localeCompare(b.userName, "es") || a.userId.localeCompare(b.userId));
      return { from: period.from, to: period.to, hoursAvailable, sellers };
    });
  }
}
