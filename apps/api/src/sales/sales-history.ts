import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { CustomerRef } from "../customers/loyalty-ledger.js";
import type { TenantDatabase, TenantScope } from "../database/tenant-database.js";
import { loadSaleLoyalty, type SaleLoyalty } from "./sales-loyalty.js";
import { loadSaleAgreement, type SaleAgreement } from "./sales-agreements.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const saleStatuses = ["CONFIRMED", "VOIDED", "PARTIALLY_RETURNED", "RETURNED"] as const;
const BUSINESS_TIME_ZONE = "America/La_Paz";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Whether the caller may see every sale of the branch or only the ones they created. */
export interface SalesAccess {
  viewAll: boolean;
}

/**
 * Supervisory users (those who approve cash differences or manage the catalog, such as the
 * owner, the pharmacist in charge and the branch manager) see all branch sales; counter users
 * with only `sales.confirm` / `cash.manage` see the sales they created.
 */
export function resolveSalesAccess(granted: readonly string[]): SalesAccess {
  const supervisory = granted.includes("cash.shift.approve") || granted.includes("catalog.manage");
  return { viewAll: granted.includes("sales.read") && supervisory };
}

export interface SalesListQuery {
  from?: string;
  to?: string;
  cashShiftId?: string;
  cashierId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface SaleListItem {
  id: string;
  number: string;
  createdAt: string;
  status: string;
  cashierId: string;
  cashierName: string | null;
  cashShiftId: string;
  totalBob: string;
  paidAmountBob: string;
  changeAmountBob: string;
  paymentMethods: string[];
  /** Total refunded through returns (0.0000 when none). */
  refundedBob: string;
}

export interface SalesListResult {
  items: SaleListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface SaleDetail {
  id: string;
  number: string;
  status: string;
  createdAt: string;
  totalBob: string;
  paidAmountBob: string;
  changeAmountBob: string;
  cashier: { id: string; name: string | null };
  shift: { id: string; registerCode: string };
  branch: { id: string; code: string; name: string };
  pharmacy: { name: string; legalName: string; taxId: string };
  warehouse: { id: string; name: string };
  /** Customer linked to the sale (F17), null for anonymous sales. */
  customer: CustomerRef | null;
  /** Points earned/redeemed by the sale and the customer's current balance; null without customer. */
  loyalty: SaleLoyalty | null;
  /** Agreement that covered part of the sale and the amount it paid (F17 Part B); null without an AGREEMENT payment. */
  agreement: SaleAgreement | null;
  /** Set when the sale was voided. */
  void: { at: string; byUserId: string; byName: string | null; reason: string } | null;
  returns: Array<{
    id: string;
    number: string;
    createdAt: string;
    reason: string;
    refundMethod: string;
    refundReference: string | null;
    refundAmountBob: string;
    /** Part of the refund that was paid with points and went back as points (D70). */
    refundPointsBob: string;
    pointsReturned: number;
    /** Part of the refund that belonged to the agreement: it reduced the agreement charge instead of being refunded. */
    refundAgreementBob: string;
    restock: boolean;
    createdByName: string | null;
    items: Array<{ saleItemId: string; productName: string; presentationName: string; quantity: number; unitPriceBob: string; lineTotalBob: string }>;
  }>;
  items: Array<{
    id: string;
    returnedQuantity: number;
    productName: string;
    presentationName: string;
    quantity: number;
    quantityBase: number;
    unitPriceBob: string;
    lineTotalBob: string;
    /** True when the cashier chose a lot different from FEFO (authorized, with a reason). */
    fefoOverride: boolean;
    fefoOverrideReason: string | null;
    allocations: Array<{ lotCode: string; expiresOn: string; quantityBase: number; fefoOverride: boolean }>;
  }>;
  payments: Array<{ method: string; amountBob: string; reference: string | null; reversed: boolean }>;
}

function optionalUuid(value: string | undefined, label: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (!uuidPattern.test(value)) throw new BadRequestException(`${label} must be a valid UUID.`);
  return value;
}

function optionalDate(value: string | undefined, label: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (!datePattern.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new BadRequestException(`${label} must be a date in YYYY-MM-DD format.`);
  }
  return value;
}

function pageNumber(value: number | undefined, label: string, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < (label === "limit" ? 1 : 0) || value > max) {
    throw new BadRequestException(`${label} is out of range.`);
  }
  return value;
}

function dateOnly(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

/** Read side of the sales module: paginated history and the full sale document for receipts. */
export class SalesHistoryReader {
  constructor(private readonly database: TenantDatabase) {}

  async list(scope: TenantScope, query: SalesListQuery, access: SalesAccess): Promise<SalesListResult> {
    const from = optionalDate(query.from, "from");
    const to = optionalDate(query.to, "to");
    const cashShiftId = optionalUuid(query.cashShiftId, "cashShiftId");
    const cashierId = optionalUuid(query.cashierId, "cashierId");
    const status = query.status === undefined || query.status === "" ? undefined : query.status.toUpperCase();
    if (status !== undefined && !(saleStatuses as readonly string[]).includes(status)) {
      throw new BadRequestException("Sale status must be one of CONFIRMED, VOIDED, PARTIALLY_RETURNED or RETURNED.");
    }
    const limit = pageNumber(query.limit, "limit", DEFAULT_LIMIT, MAX_LIMIT);
    const offset = pageNumber(query.offset, "offset", 0, 1_000_000);

    const params: unknown[] = [scope.tenantId, scope.branchId];
    const conditions = ["s.tenant_id = $1", "s.branch_id = $2"];
    const bind = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };
    if (!access.viewAll) conditions.push(`s.created_by_user_id = ${bind(scope.userId)}`);
    if (from) conditions.push(`s.created_at >= (${bind(from)}::date::timestamp at time zone '${BUSINESS_TIME_ZONE}')`);
    if (to) conditions.push(`s.created_at < ((${bind(to)}::date + 1)::timestamp at time zone '${BUSINESS_TIME_ZONE}')`);
    if (cashShiftId) conditions.push(`s.cash_shift_id = ${bind(cashShiftId)}`);
    if (cashierId) conditions.push(`s.created_by_user_id = ${bind(cashierId)}`);
    if (status) conditions.push(`s.status = ${bind(status)}`);
    const where = conditions.join(" and ");

    return this.database.withScope(scope, async (client) => {
      const count = await client.query<{ total: number }>(
        `select count(*)::int as total from sales s where ${where}`,
        params
      );
      const rows = await client.query<{
        id: string;
        number: string;
        createdAt: Date;
        status: string;
        cashierId: string;
        cashierName: string | null;
        cashShiftId: string;
        totalBob: string;
        paidAmountBob: string;
        changeAmountBob: string;
        paymentMethods: string[] | null;
        refundedBob: string;
      }>(
        `select s.id, s.sale_number as number, s.created_at as "createdAt", s.status,
                s.created_by_user_id as "cashierId", u.display_name as "cashierName",
                s.cash_shift_id as "cashShiftId", s.total_amount_bob::text as "totalBob",
                s.paid_amount_bob::text as "paidAmountBob", s.change_amount_bob::text as "changeAmountBob",
                (select array_agg(distinct p.method order by p.method) from sale_payments p
                  where p.tenant_id = s.tenant_id and p.branch_id = s.branch_id and p.sale_id = s.id) as "paymentMethods",
                (select coalesce(sum(r.refund_amount_bob), 0) from sale_returns r
                  where r.tenant_id = s.tenant_id and r.branch_id = s.branch_id and r.sale_id = s.id)::text as "refundedBob"
         from sales s left join users u on u.id = s.created_by_user_id
         where ${where}
         order by s.created_at desc, s.id desc
         limit ${bind(limit)} offset ${bind(offset)}`,
        params
      );
      return {
        items: rows.rows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
          paymentMethods: row.paymentMethods ?? []
        })),
        total: count.rows[0]?.total ?? 0,
        limit,
        offset
      };
    });
  }

  async detail(scope: TenantScope, saleId: string, access: SalesAccess): Promise<SaleDetail> {
    if (!uuidPattern.test(saleId)) throw new NotFoundException("Sale not found.");
    return this.database.withScope(scope, async (client) => {
      const header = await this.loadHeader(client, scope, saleId, access);
      if (!header) throw new NotFoundException("Sale not found.");
      const items = await client.query<{
        id: string;
        productName: string;
        presentationName: string;
        quantity: string;
        quantityBase: string;
        unitPriceBob: string;
        lineTotalBob: string;
        returnedQuantity: string;
        fefoOverride: boolean;
        fefoOverrideReason: string | null;
      }>(
        `select i.id, p.name as "productName", pp.name as "presentationName", i.quantity::text as quantity,
                i.quantity_base::text as "quantityBase", i.unit_price_bob::text as "unitPriceBob",
                i.line_total_bob::text as "lineTotalBob",
                i.fefo_override as "fefoOverride", i.fefo_override_reason as "fefoOverrideReason",
                coalesce((select sum(ri.quantity) from sale_return_items ri
                           where ri.tenant_id = i.tenant_id and ri.branch_id = i.branch_id and ri.sale_item_id = i.id), 0)::text as "returnedQuantity"
         from sale_items i
         join product_presentations pp on pp.tenant_id = i.tenant_id and pp.id = i.presentation_id
         join products p on p.tenant_id = pp.tenant_id and p.id = pp.product_id
         where i.tenant_id = $1 and i.branch_id = $2 and i.sale_id = $3
         order by i.created_at, i.id`,
        [scope.tenantId, scope.branchId, saleId]
      );
      const allocations = await client.query<{
        saleItemId: string;
        lotCode: string;
        expiresOn: string | Date;
        quantityBase: string;
        fefoOverride: boolean;
      }>(
        `select a.sale_item_id as "saleItemId", b.lot_code as "lotCode", b.expires_on as "expiresOn",
                a.quantity_base::text as "quantityBase", a.fefo_override as "fefoOverride"
         from sale_allocations a
         join sale_items i on i.tenant_id = a.tenant_id and i.branch_id = a.branch_id and i.id = a.sale_item_id
         join inventory_batches b on b.tenant_id = a.tenant_id and b.id = a.batch_id
         where i.tenant_id = $1 and i.branch_id = $2 and i.sale_id = $3
         order by b.expires_on, b.id`,
        [scope.tenantId, scope.branchId, saleId]
      );
      const payments = await client.query<{ method: string; amountBob: string; reference: string | null; reversed: boolean }>(
        `select method, amount_bob::text as "amountBob", reference, (reversed_at is not null) as reversed
         from sale_payments where tenant_id = $1 and branch_id = $2 and sale_id = $3
         order by method, amount_bob desc, id`,
        [scope.tenantId, scope.branchId, saleId]
      );
      const returns = await this.loadReturns(client, scope, saleId);
      const loyalty = header.customer ? await loadSaleLoyalty(client, scope.tenantId, saleId, header.customer.id) : null;
      const agreement = await loadSaleAgreement(client, scope.tenantId, scope.branchId, saleId);
      return {
        ...header,
        loyalty,
        agreement,
        returns,
        items: items.rows.map((item) => ({
          ...item,
          returnedQuantity: Number(item.returnedQuantity),
          quantity: Number(item.quantity),
          quantityBase: Number(item.quantityBase),
          allocations: allocations.rows
            .filter((allocation) => allocation.saleItemId === item.id)
            .map((allocation) => ({
              lotCode: allocation.lotCode,
              expiresOn: dateOnly(allocation.expiresOn),
              quantityBase: Number(allocation.quantityBase),
              fefoOverride: allocation.fefoOverride
            }))
        })),
        payments: payments.rows
      };
    });
  }

  private async loadHeader(
    client: PoolClient,
    scope: TenantScope,
    saleId: string,
    access: SalesAccess
  ): Promise<Omit<SaleDetail, "items" | "payments" | "returns" | "loyalty" | "agreement"> | undefined> {
    const result = await client.query<{
      id: string;
      number: string;
      status: string;
      createdAt: Date;
      totalBob: string;
      paidAmountBob: string;
      changeAmountBob: string;
      cashierId: string;
      cashierName: string | null;
      shiftId: string;
      registerCode: string;
      branchId: string;
      branchCode: string;
      branchName: string;
      pharmacyName: string;
      legalName: string;
      taxId: string;
      warehouseId: string;
      warehouseName: string;
      voidedAt: Date | null;
      voidedByUserId: string | null;
      voidedByName: string | null;
      voidReason: string | null;
      customerId: string | null;
      customerName: string | null;
      customerDocType: string | null;
      customerDocNumber: string | null;
    }>(
      `select s.id, s.sale_number as number, s.status, s.created_at as "createdAt",
              s.total_amount_bob::text as "totalBob", s.paid_amount_bob::text as "paidAmountBob",
              s.change_amount_bob::text as "changeAmountBob",
              s.created_by_user_id as "cashierId", u.display_name as "cashierName",
              s.cash_shift_id as "shiftId", cr.code as "registerCode",
              br.id as "branchId", br.code as "branchCode", br.name as "branchName",
              t.name as "pharmacyName", le.legal_name as "legalName", le.tax_id as "taxId",
              w.id as "warehouseId", w.name as "warehouseName",
              s.voided_at as "voidedAt", s.voided_by_user_id as "voidedByUserId",
              vu.display_name as "voidedByName", s.void_reason as "voidReason",
              c.id as "customerId", c.full_name as "customerName", c.doc_type as "customerDocType", c.doc_number as "customerDocNumber"
       from sales s
       join branches br on br.tenant_id = s.tenant_id and br.id = s.branch_id
       join legal_entities le on le.tenant_id = br.tenant_id and le.id = br.legal_entity_id
       join tenants t on t.id = s.tenant_id
       join cash_shifts cs on cs.tenant_id = s.tenant_id and cs.branch_id = s.branch_id and cs.id = s.cash_shift_id
       join cash_registers cr on cr.tenant_id = cs.tenant_id and cr.id = cs.cash_register_id
       join warehouses w on w.tenant_id = s.tenant_id and w.id = s.warehouse_id
       left join users u on u.id = s.created_by_user_id
       left join users vu on vu.id = s.voided_by_user_id
       left join customers c on c.tenant_id = s.tenant_id and c.id = s.customer_id
       where s.tenant_id = $1 and s.branch_id = $2 and s.id = $3
         and ($4::boolean or s.created_by_user_id = $5)`,
      [scope.tenantId, scope.branchId, saleId, access.viewAll, scope.userId]
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      number: row.number,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      totalBob: row.totalBob,
      paidAmountBob: row.paidAmountBob,
      changeAmountBob: row.changeAmountBob,
      cashier: { id: row.cashierId, name: row.cashierName },
      shift: { id: row.shiftId, registerCode: row.registerCode },
      branch: { id: row.branchId, code: row.branchCode, name: row.branchName },
      pharmacy: { name: row.pharmacyName, legalName: row.legalName, taxId: row.taxId },
      warehouse: { id: row.warehouseId, name: row.warehouseName },
      customer: row.customerId
        ? { id: row.customerId, fullName: row.customerName ?? "", docType: row.customerDocType, docNumber: row.customerDocNumber }
        : null,
      void:
        row.voidedAt && row.voidedByUserId
          ? { at: row.voidedAt.toISOString(), byUserId: row.voidedByUserId, byName: row.voidedByName, reason: row.voidReason ?? "" }
          : null
    };
  }

  private async loadReturns(client: PoolClient, scope: TenantScope, saleId: string): Promise<SaleDetail["returns"]> {
    const headers = await client.query<{
      id: string;
      number: string;
      createdAt: Date;
      reason: string;
      refundMethod: string;
      refundReference: string | null;
      refundAmountBob: string;
      refundPointsBob: string;
      pointsReturned: number;
      refundAgreementBob: string;
      restock: boolean;
      createdByName: string | null;
    }>(
      `select r.id, r.return_number as number, r.created_at as "createdAt", r.reason,
              r.refund_method as "refundMethod", r.refund_reference as "refundReference",
              r.refund_amount_bob::text as "refundAmountBob", r.points_refund_bob::text as "refundPointsBob",
              r.agreement_refund_bob::text as "refundAgreementBob", r.points_returned as "pointsReturned", r.restock, u.display_name as "createdByName"
       from sale_returns r left join users u on u.id = r.created_by_user_id
       where r.tenant_id = $1 and r.branch_id = $2 and r.sale_id = $3
       order by r.created_at, r.id`,
      [scope.tenantId, scope.branchId, saleId]
    );
    const lines = await client.query<{
      returnId: string;
      saleItemId: string;
      productName: string;
      presentationName: string;
      quantity: string;
      unitPriceBob: string;
      lineTotalBob: string;
    }>(
      `select ri.sale_return_id as "returnId", ri.sale_item_id as "saleItemId", p.name as "productName",
              pp.name as "presentationName", ri.quantity::text as quantity,
              ri.unit_price_bob::text as "unitPriceBob", ri.line_total_bob::text as "lineTotalBob"
       from sale_return_items ri
       join sale_returns r on r.tenant_id = ri.tenant_id and r.branch_id = ri.branch_id and r.id = ri.sale_return_id
       join sale_items i on i.tenant_id = ri.tenant_id and i.branch_id = ri.branch_id and i.id = ri.sale_item_id
       join product_presentations pp on pp.tenant_id = i.tenant_id and pp.id = i.presentation_id
       join products p on p.tenant_id = pp.tenant_id and p.id = pp.product_id
       where r.tenant_id = $1 and r.branch_id = $2 and r.sale_id = $3
       order by ri.created_at, ri.id`,
      [scope.tenantId, scope.branchId, saleId]
    );
    return headers.rows.map(({ createdAt, ...header }) => ({
      ...header,
      createdAt: createdAt.toISOString(),
      items: lines.rows
        .filter((line) => line.returnId === header.id)
        .map(({ returnId: _returnId, quantity, ...line }) => ({ ...line, quantity: Number(quantity) }))
    }));
  }
}
