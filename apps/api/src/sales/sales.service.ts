import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { TenantDatabase, type TenantScope } from "../database/tenant-database.js";
import { AuditService } from "../transversal/audit.service.js";
import { OutboxService } from "../transversal/outbox.service.js";
import {
  IdempotencyService,
  IdempotencyKeyReusedError,
  type IdempotentExecutionResult
} from "../transversal/idempotency.service.js";

export type SalePaymentMethod = "CASH";

export interface ConfirmSaleLineInput {
  presentationId: string;
  quantity: number;
  unitPriceBob: string;
}

export interface ConfirmSaleInput {
  idempotencyKey: string;
  cashShiftId: string;
  warehouseId: string;
  paymentMethod: SalePaymentMethod | string;
  paidAmountBob: string;
  lines: readonly ConfirmSaleLineInput[];
}

export interface SaleAllocation {
  batchId: string;
  lotCode: string;
  expiresOn: string;
  quantityBase: number;
}

export interface ConfirmedSaleItem {
  presentationId: string;
  quantity: number;
  quantityBase: number;
  unitPriceBob: string;
  lineTotalBob: string;
  allocations: SaleAllocation[];
}

export interface ConfirmedSale {
  id: string;
  cashShiftId: string;
  warehouseId: string;
  status: "CONFIRMED";
  paymentMethod: SalePaymentMethod;
  totalBob: string;
  paidAmountBob: string;
  items: ConfirmedSaleItem[];
}

const decimalPattern = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/;

function text(value: string, field: string, max = 255): string {
  const normalized = value?.trim();
  if (!normalized || normalized.length > max) {
    throw new BadRequestException(`${field} must be non-empty and at most ${max} characters.`);
  }
  return normalized;
}

function decimal(value: string, field: string): string {
  const normalized = value?.trim();
  if (!normalized || !decimalPattern.test(normalized)) {
    throw new BadRequestException(`${field} must be a non-negative decimal with at most 4 places.`);
  }
  return normalized;
}

function quantity(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 1_000_000_000) {
    throw new BadRequestException(`${field} must be a positive safe integer.`);
  }
  return value;
}

export function normalizeSaleInput(input: ConfirmSaleInput): ConfirmSaleInput {
  const paymentMethod = text(input.paymentMethod, "Payment method", 16).toUpperCase();
  if (paymentMethod !== "CASH") {
    throw new BadRequestException("Only CASH payment is supported in this sales workflow.");
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > 100) {
    throw new BadRequestException("At least one and at most 100 sale lines are required.");
  }
  const lines = input.lines.map((line) => ({
    presentationId: text(line.presentationId, "Presentation ID", 64),
    quantity: quantity(line.quantity, "Sale quantity"),
    unitPriceBob: decimal(line.unitPriceBob, "Unit price")
  }));
  return {
    idempotencyKey: text(input.idempotencyKey, "Idempotency key"),
    cashShiftId: text(input.cashShiftId, "Cash shift ID", 64),
    warehouseId: text(input.warehouseId, "Warehouse ID", 64),
    paymentMethod: "CASH",
    paidAmountBob: decimal(input.paidAmountBob, "Paid amount"),
    lines
  };
}

interface FefoRow {
  batchId: string;
  lotCode: string;
  expiresOn: string | Date;
  quantityBase: string;
  reservedBase: string;
}

interface SaleRow {
  id: string;
  totalBob: string;
  paidAmountBob: string;
}

@Injectable()
export class SalesService {
  private readonly idempotency = new IdempotencyService();
  private readonly audit = new AuditService();
  private readonly outbox = new OutboxService();

  constructor(private readonly database: TenantDatabase) {}

  async confirm(scope: TenantScope, input: ConfirmSaleInput): Promise<ConfirmedSale> {
    const normalized = normalizeSaleInput(input);
    try {
      const result = await this.idempotency.execute(
        this.database,
        scope,
        "sales.confirm_cash",
        normalized.idempotencyKey,
        normalized,
        async (client) => ({
          statusCode: 201,
          body: await this.postSale(client, scope, normalized)
        } satisfies IdempotentExecutionResult<ConfirmedSale>)
      );
      return (result.body ?? result.data) as ConfirmedSale;
    } catch (error) {
      if (error instanceof IdempotencyKeyReusedError) {
        throw new ConflictException({ code: error.code, message: error.message });
      }
      throw error;
    }
  }

  private async postSale(
    client: PoolClient,
    scope: TenantScope,
    input: ConfirmSaleInput
  ): Promise<ConfirmedSale> {
    const shift = await client.query<{ id: string }>(
      `select control.cash_shift_id as id
       from cash_shift_controls control
       join cash_shift_users assignment
         on assignment.tenant_id = control.tenant_id
        and assignment.branch_id = control.branch_id
        and assignment.cash_shift_id = control.cash_shift_id
       join users app_user on app_user.id = assignment.user_id
       join cash_shifts shift
         on shift.tenant_id = control.tenant_id
        and shift.branch_id = control.branch_id
        and shift.id = control.cash_shift_id
       where control.tenant_id = $1 and control.branch_id = $2
         and control.cash_shift_id = $3 and control.status = 'OPEN'
         and assignment.user_id = $4 and app_user.is_active = true
         and shift.status = 'SCHEDULED'
       for update of control` ,
      [scope.tenantId, scope.branchId, input.cashShiftId, scope.userId]
    );
    if (!shift.rows[0]) {
      throw new ConflictException("An OPEN cash shift assigned to the authenticated user is required.");
    }

    const warehouse = await client.query<{ id: string }>(
      `select id from warehouses
       where tenant_id = $1 and branch_id = $2 and id = $3 and is_dispatch_enabled = true
       for key share`,
      [scope.tenantId, scope.branchId, input.warehouseId]
    );
    if (!warehouse.rows[0]) {
      throw new NotFoundException("The warehouse is not available for this branch.");
    }

    const sale = await client.query<SaleRow>(
      `insert into sales
         (tenant_id, branch_id, cash_shift_id, warehouse_id, status, total_amount_bob, paid_amount_bob, created_by_user_id)
       values ($1, $2, $3, $4, 'CONFIRMED', 0, $5, $6)
       returning id, total_amount_bob::text as "totalBob", paid_amount_bob::text as "paidAmountBob"`,
      [scope.tenantId, scope.branchId, input.cashShiftId, input.warehouseId, input.paidAmountBob, scope.userId]
    );
    const saleRow = sale.rows[0];
    if (!saleRow) throw new Error("Sale was not created.");

    const items: ConfirmedSaleItem[] = [];
    let totalBob = "0";
    for (const line of input.lines) {
      const presentation = await client.query<{ id: string; factor: string }>(
        `select id, base_unit_factor::text as factor
         from product_presentations
         where tenant_id = $1 and id = $2 and is_sellable = true
         for key share`,
        [scope.tenantId, line.presentationId]
      );
      const presentationRow = presentation.rows[0];
      if (!presentationRow) {
        throw new NotFoundException("The product presentation is not available in this tenant.");
      }
      const factor = Number(presentationRow.factor);
      const quantityBase = factor * line.quantity;
      if (!Number.isSafeInteger(quantityBase)) {
        throw new BadRequestException("Sale quantity exceeds the safe base-unit limit.");
      }

      const allocationRows = await client.query<FefoRow>(
        `select b.id as "batchId", b.lot_code as "lotCode", b.expires_on as "expiresOn",
                ib.quantity_base::text as "quantityBase", ib.reserved_base::text as "reservedBase"
         from inventory_balances ib
         join inventory_batches b on b.tenant_id = ib.tenant_id and b.id = ib.batch_id
         where ib.tenant_id = $1 and ib.warehouse_id = $2 and b.presentation_id = $3
           and b.status = 'AVAILABLE' and b.expires_on >= current_date
           and ib.quantity_base > ib.reserved_base
         order by b.expires_on asc, b.id asc
         for update of ib`,
        [scope.tenantId, input.warehouseId, line.presentationId]
      );
      const available = allocationRows.rows.reduce(
        (sum, row) => sum + Number(row.quantityBase) - Number(row.reservedBase),
        0
      );
      if (available < quantityBase) {
        throw new ConflictException("Insufficient available FEFO inventory for the sale line.");
      }

      const item = await client.query<{ id: string; lineTotalBob: string }>(
        `insert into sale_items
           (tenant_id, branch_id, sale_id, presentation_id, quantity, quantity_base, unit_price_bob, line_total_bob)
         values ($1, $2, $3, $4, $5, $6, $7, ($5::numeric * $7::numeric))
         returning id, line_total_bob::text as "lineTotalBob"`,
        [scope.tenantId, scope.branchId, saleRow.id, line.presentationId, line.quantity, quantityBase, line.unitPriceBob]
      );
      const itemRow = item.rows[0];
      if (!itemRow) throw new Error("Sale item was not created.");

      let remaining = quantityBase;
      const allocations: SaleAllocation[] = [];
      for (const row of allocationRows.rows) {
        if (remaining === 0) break;
        const availableRow = Number(row.quantityBase) - Number(row.reservedBase);
        const take = Math.min(remaining, availableRow);
        await client.query(
          `update inventory_balances
           set quantity_base = quantity_base - $4, updated_at = now()
           where tenant_id = $1 and warehouse_id = $2 and batch_id = $3
             and quantity_base - reserved_base >= $4`,
          [scope.tenantId, input.warehouseId, row.batchId, take]
        );
        await client.query(
          `insert into inventory_movements
             (tenant_id, warehouse_id, batch_id, movement_type, movement_direction, quantity_base, reference_type, reference_id)
           values ($1, $2, $3, 'SALE', 'OUT', $4, 'SALE', $5)`,
          [scope.tenantId, input.warehouseId, row.batchId, take, saleRow.id]
        );
        await client.query(
          `insert into sale_allocations (tenant_id, branch_id, sale_item_id, batch_id, quantity_base)
           values ($1, $2, $3, $4, $5)`,
          [scope.tenantId, scope.branchId, itemRow.id, row.batchId, take]
        );
        allocations.push({
          batchId: row.batchId,
          lotCode: row.lotCode,
          expiresOn: new Date(row.expiresOn).toISOString().slice(0, 10),
          quantityBase: take
        });
        remaining -= take;
      }
      totalBob = await this.sumTotal(client, saleRow.id);
      items.push({
        presentationId: line.presentationId,
        quantity: line.quantity,
        quantityBase,
        unitPriceBob: line.unitPriceBob,
        lineTotalBob: itemRow.lineTotalBob,
        allocations
      });
    }

    const total = await this.sumTotal(client, saleRow.id);
    const paidCheck = await client.query<{ matches: boolean }>(
      `select $1::numeric = $2::numeric as matches`,
      [input.paidAmountBob, total]
    );
    if (!paidCheck.rows[0]?.matches) {
      throw new BadRequestException("Paid amount must equal the exact sale total.");
    }
    await client.query(
      `update sales set total_amount_bob = $4::numeric
       where tenant_id = $1 and branch_id = $2 and id = $3`,
      [scope.tenantId, scope.branchId, saleRow.id, total]
    );
    await client.query(
      `insert into sale_payments (tenant_id, branch_id, sale_id, method, amount_bob)
       values ($1, $2, $3, 'CASH', $4)`,
      [scope.tenantId, scope.branchId, saleRow.id, input.paidAmountBob]
    );
    await client.query(
      `update cash_shift_controls
       set expected_amount_bob = expected_amount_bob + $4::numeric
       where tenant_id = $1 and branch_id = $2 and cash_shift_id = $3 and status = 'OPEN'`,
      [scope.tenantId, scope.branchId, input.cashShiftId, total]
    );
    await this.audit.recordInTransaction(client, scope, {
      action: "sales.cash_sale_confirmed",
      entityType: "sale",
      entityId: saleRow.id,
      payload: { cashShiftId: input.cashShiftId, warehouseId: input.warehouseId, totalBob: total }
    });
    await this.outbox.enqueueInTransaction(client, scope, {
      aggregateType: "sale",
      aggregateId: saleRow.id,
      eventType: "sales.cash_sale_confirmed",
      payload: { saleId: saleRow.id, totalBob: total }
    });
    return {
      id: saleRow.id,
      cashShiftId: input.cashShiftId,
      warehouseId: input.warehouseId,
      status: "CONFIRMED",
      paymentMethod: "CASH",
      totalBob: total,
      paidAmountBob: input.paidAmountBob,
      items
    };
  }

  private async sumTotal(client: PoolClient, saleId: string): Promise<string> {
    const result = await client.query<{ total: string }>(
      `select coalesce(sum(line_total_bob), 0)::text as total from sale_items where sale_id = $1`,
      [saleId]
    );
    return result.rows[0]?.total ?? "0";
  }
}
