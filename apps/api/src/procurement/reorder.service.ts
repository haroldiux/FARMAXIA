import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { TenantDatabase, type TenantScope } from "../database/tenant-database.js";

export interface ReorderSuggestion {
  presentationId: string;
  productName: string;
  presentationName: string;
  baseUnitFactor: number;
  /** Unidades base vendidas en la sucursal en los últimos `salesWindowDays` días. */
  soldBase: number;
  averageDailyBase: number;
  /** Stock libre (físico − reservado) en almacenes de despacho activos de la sucursal. */
  availableBase: number;
  /** Pendiente de recibir en órdenes abiertas de la sucursal. */
  incomingBase: number;
  daysOfStock: number | null;
  suggestedBase: number;
  averageUnitCost: string | null;
  estimatedCost: string | null;
  lastSupplierId: string | null;
  lastSupplierName: string | null;
}

export interface ReorderResult {
  coverageDays: number;
  salesWindowDays: number;
  items: ReorderSuggestion[];
}

const SALES_WINDOW_DAYS = 30;

/**
 * Reposición sugerida: cubre `coverageDays` días de venta según el promedio de los últimos
 * 30 días, descontando el stock libre y lo que ya está pedido. Solo aparecen los productos
 * que se venden y a los que no les alcanza lo disponible.
 */
@Injectable()
export class ReorderService {
  constructor(@Inject(TenantDatabase) private readonly database: TenantDatabase) {}

  async suggestions(scope: TenantScope, coverageDaysInput?: number): Promise<ReorderResult> {
    const coverageDays = coverageDaysInput === undefined || Number.isNaN(coverageDaysInput) ? 30 : coverageDaysInput;
    if (!Number.isSafeInteger(coverageDays) || coverageDays < 7 || coverageDays > 120) {
      throw new BadRequestException("Los días de cobertura deben estar entre 7 y 120.");
    }
    return this.database.withScope(scope, async (client) => {
      const result = await client.query<{
        presentationId: string;
        productName: string;
        presentationName: string;
        baseUnitFactor: string;
        soldBase: string;
        availableBase: string;
        incomingBase: string;
        averageUnitCost: string | null;
        lastSupplierId: string | null;
        lastSupplierName: string | null;
      }>(
        `with sold as (
           select item.presentation_id, sum(item.quantity_base) as quantity
           from sale_items item
           join sales sale on sale.tenant_id = item.tenant_id and sale.branch_id = item.branch_id and sale.id = item.sale_id
           where item.tenant_id = $1 and item.branch_id = $2 and sale.status = 'CONFIRMED'
             and sale.created_at >= now() - make_interval(days => $3)
           group by item.presentation_id
         ), available as (
           select batch.presentation_id, sum(balance.quantity_base - balance.reserved_base) as quantity
           from inventory_balances balance
           join inventory_batches batch on batch.tenant_id = balance.tenant_id and batch.id = balance.batch_id
           join warehouses warehouse on warehouse.tenant_id = balance.tenant_id and warehouse.id = balance.warehouse_id
           where balance.tenant_id = $1 and warehouse.branch_id = $2
             and warehouse.is_dispatch_enabled and warehouse.is_active
             and batch.status = 'AVAILABLE' and batch.expires_on >= current_date
           group by batch.presentation_id
         ), incoming as (
           select item.presentation_id,
                  sum(item.quantity_base) - coalesce(sum((
                    select sum(received.quantity_base)
                    from goods_receipt_items received
                    join goods_receipts receipt on receipt.tenant_id = received.tenant_id and receipt.id = received.goods_receipt_id
                    where receipt.tenant_id = po.tenant_id and receipt.purchase_order_id = po.id
                      and received.presentation_id = item.presentation_id
                  )), 0) as quantity
           from purchase_orders po
           join warehouses warehouse on warehouse.tenant_id = po.tenant_id and warehouse.id = po.warehouse_id
           join purchase_order_items item on item.tenant_id = po.tenant_id and item.purchase_order_id = po.id
           where po.tenant_id = $1 and warehouse.branch_id = $2 and po.status in ('SUBMITTED', 'PARTIALLY_RECEIVED')
           group by item.presentation_id
         ), last_supplier as (
           select distinct on (item.presentation_id) item.presentation_id, po.supplier_id, supplier.name
           from purchase_order_items item
           join purchase_orders po on po.tenant_id = item.tenant_id and po.id = item.purchase_order_id
           join suppliers supplier on supplier.tenant_id = po.tenant_id and supplier.id = po.supplier_id
           where item.tenant_id = $1 and supplier.is_active
           order by item.presentation_id, po.ordered_at desc
         )
         select presentation.id as "presentationId", product.name as "productName", presentation.name as "presentationName",
                presentation.base_unit_factor::text as "baseUnitFactor",
                coalesce(sold.quantity, 0)::text as "soldBase",
                greatest(coalesce(available.quantity, 0), 0)::text as "availableBase",
                greatest(coalesce(incoming.quantity, 0), 0)::text as "incomingBase",
                round(cost.average_unit_cost, 4)::text as "averageUnitCost",
                last_supplier.supplier_id as "lastSupplierId", last_supplier.name as "lastSupplierName"
         from sold
         join product_presentations presentation on presentation.tenant_id = $1 and presentation.id = sold.presentation_id
         join products product on product.tenant_id = presentation.tenant_id and product.id = presentation.product_id
         left join available on available.presentation_id = presentation.id
         left join incoming on incoming.presentation_id = presentation.id
         left join presentation_costs cost on cost.tenant_id = presentation.tenant_id and cost.presentation_id = presentation.id
         left join last_supplier on last_supplier.presentation_id = presentation.id
         where presentation.is_active and product.is_active`,
        [scope.tenantId, scope.branchId, SALES_WINDOW_DAYS]
      );
      const items: ReorderSuggestion[] = [];
      for (const row of result.rows) {
        const soldBase = Number(row.soldBase);
        const availableBase = Number(row.availableBase);
        const incomingBase = Number(row.incomingBase);
        const averageDailyBase = soldBase / SALES_WINDOW_DAYS;
        const suggestedBase = Math.ceil(averageDailyBase * coverageDays) - availableBase - incomingBase;
        if (suggestedBase <= 0) continue;
        const averageUnitCost = row.averageUnitCost;
        items.push({
          presentationId: row.presentationId,
          productName: row.productName,
          presentationName: row.presentationName,
          baseUnitFactor: Number(row.baseUnitFactor),
          soldBase,
          averageDailyBase: Math.round(averageDailyBase * 100) / 100,
          availableBase,
          incomingBase,
          daysOfStock: averageDailyBase > 0 ? Math.floor(availableBase / averageDailyBase) : null,
          suggestedBase,
          averageUnitCost,
          estimatedCost: averageUnitCost ? (Number(averageUnitCost) * suggestedBase).toFixed(2) : null,
          lastSupplierId: row.lastSupplierId,
          lastSupplierName: row.lastSupplierName
        });
      }
      // Primero lo que se acaba antes.
      items.sort((a, b) => (a.daysOfStock ?? 0) - (b.daysOfStock ?? 0) || b.suggestedBase - a.suggestedBase);
      return { coverageDays, salesWindowDays: SALES_WINDOW_DAYS, items };
    });
  }
}
