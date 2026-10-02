import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { TenantDatabase, TenantScope } from "../database/tenant-database.js";
import { AuditService } from "../transversal/audit.service.js";
import { DocumentSequenceService } from "../transversal/document-sequence.service.js";
import {
  IdempotencyKeyReusedError,
  IdempotencyService,
  type IdempotentExecutionResult
} from "../transversal/idempotency.service.js";
import { OutboxService } from "../transversal/outbox.service.js";
import type { SalesAccess } from "./sales-history.js";
import { fromUnits, toUnits } from "./sales-money.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refundMethods = ["CASH", "CARD", "QR"] as const;
export type RefundMethod = (typeof refundMethods)[number];

export interface VoidSaleInput {
  idempotencyKey: string;
  reason: string;
}

export interface VoidedSale {
  id: string;
  saleNumber: string;
  status: "VOIDED";
  reason: string;
  voidedAt: string;
  /** Net cash (tendered minus change) removed from the expected cash of the shift. */
  cashReversedBob: string;
}

export interface ReturnLineInput {
  saleItemId: string;
  /** Quantity in the sold presentation units. */
  quantity: number;
}

export interface RegisterReturnInput {
  idempotencyKey: string;
  reason: string;
  refundMethod: RefundMethod | string;
  refundReference?: string;
  restock: boolean;
  lines: readonly ReturnLineInput[];
}

export interface RegisteredReturn {
  id: string;
  returnNumber: string;
  saleId: string;
  saleNumber: string;
  saleStatus: "PARTIALLY_RETURNED" | "RETURNED";
  refundMethod: RefundMethod;
  refundReference: string | null;
  refundAmountBob: string;
  restock: boolean;
  reason: string;
  lines: Array<{ saleItemId: string; quantity: number; unitPriceBob: string; lineTotalBob: string }>;
  createdAt: string;
}

function text(value: unknown, field: string, max: number): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > max) {
    throw new BadRequestException(`${field} must be non-empty and at most ${max} characters.`);
  }
  return normalized;
}

interface NormalizedReturn {
  idempotencyKey: string;
  reason: string;
  refundMethod: RefundMethod;
  refundReference: string | null;
  restock: boolean;
  lines: ReturnLineInput[];
}

function normalizeReturn(input: RegisterReturnInput): NormalizedReturn {
  const idempotencyKey = text(input?.idempotencyKey, "Idempotency key", 255);
  const reason = text(input.reason, "Reason", 200);
  const method = typeof input.refundMethod === "string" ? input.refundMethod.trim().toUpperCase() : "";
  if (!(refundMethods as readonly string[]).includes(method)) {
    throw new BadRequestException("Refund method must be CASH, CARD or QR.");
  }
  const refundMethod = method as RefundMethod;
  let refundReference: string | null = null;
  if (refundMethod === "CASH") {
    if (input.refundReference !== undefined && input.refundReference !== null && input.refundReference !== "") {
      throw new BadRequestException("A reference is not allowed for CASH refunds.");
    }
  } else {
    refundReference = text(input.refundReference, "A reference for CARD and QR refunds", 64);
  }
  if (typeof input.restock !== "boolean") {
    throw new BadRequestException("Restock must be true or false.");
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > 100) {
    throw new BadRequestException("At least one and at most 100 return lines are required.");
  }
  const seen = new Set<string>();
  const lines = input.lines.map((line) => {
    const saleItemId = text(line?.saleItemId, "Sale item ID", 64);
    if (seen.has(saleItemId)) throw new BadRequestException("A sale item can appear only once per return.");
    seen.add(saleItemId);
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0 || line.quantity > 1_000_000_000) {
      throw new BadRequestException("Return quantity must be a positive safe integer.");
    }
    return { saleItemId, quantity: line.quantity };
  });
  return { idempotencyKey, reason, refundMethod, refundReference, restock: input.restock, lines };
}

interface LockedSale {
  id: string;
  saleNumber: string;
  status: string;
  cashShiftId: string;
  warehouseId: string;
  changeAmountBob: string;
}

/** Write side for voiding a sale and registering returns. All effects are atomic and idempotent. */
export class SalesReturnsWriter {
  private readonly idempotency = new IdempotencyService();
  private readonly audit = new AuditService();
  private readonly outbox = new OutboxService();
  private readonly sequences = new DocumentSequenceService();

  constructor(private readonly database: TenantDatabase) {}

  async voidSale(
    scope: TenantScope,
    saleId: string,
    input: VoidSaleInput,
    access: SalesAccess
  ): Promise<VoidedSale> {
    const idempotencyKey = text(input?.idempotencyKey, "Idempotency key", 255);
    const reason = text(input.reason, "Reason", 200);
    if (!uuidPattern.test(saleId)) throw new NotFoundException("Sale not found.");
    return this.run<VoidedSale>(scope, "sales.void", idempotencyKey, { saleId, reason }, 200, (client) =>
      this.postVoid(client, scope, saleId, reason, access)
    );
  }

  async registerReturn(
    scope: TenantScope,
    saleId: string,
    input: RegisterReturnInput,
    access: SalesAccess
  ): Promise<RegisteredReturn> {
    const normalized = normalizeReturn(input);
    if (!uuidPattern.test(saleId)) throw new NotFoundException("Sale not found.");
    return this.run<RegisteredReturn>(
      scope,
      "sales.return",
      normalized.idempotencyKey,
      { saleId, ...normalized },
      201,
      (client) => this.postReturn(client, scope, saleId, normalized, access)
    );
  }

  private async run<T>(
    scope: TenantScope,
    operation: string,
    idempotencyKey: string,
    payload: unknown,
    statusCode: number,
    work: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    try {
      const result = await this.idempotency.execute(
        this.database,
        scope,
        operation,
        idempotencyKey,
        payload,
        async (client) => ({ statusCode, body: await work(client) }) satisfies IdempotentExecutionResult<T>
      );
      return (result.body ?? result.data) as T;
    } catch (error) {
      if (error instanceof IdempotencyKeyReusedError) {
        throw new ConflictException({ code: error.code, message: error.message });
      }
      throw error;
    }
  }

  private async lockSale(
    client: PoolClient,
    scope: TenantScope,
    saleId: string,
    access: SalesAccess
  ): Promise<LockedSale> {
    const result = await client.query<LockedSale>(
      `select id, sale_number as "saleNumber", status, cash_shift_id as "cashShiftId",
              warehouse_id as "warehouseId", change_amount_bob::text as "changeAmountBob"
       from sales
       where tenant_id = $1 and branch_id = $2 and id = $3
         and ($4::boolean or created_by_user_id = $5)
       for update`,
      [scope.tenantId, scope.branchId, saleId, access.viewAll, scope.userId]
    );
    const sale = result.rows[0];
    if (!sale) throw new NotFoundException("Sale not found.");
    return sale;
  }

  private async postVoid(
    client: PoolClient,
    scope: TenantScope,
    saleId: string,
    reason: string,
    access: SalesAccess
  ): Promise<VoidedSale> {
    const sale = await this.lockSale(client, scope, saleId, access);
    if (sale.status !== "CONFIRMED") {
      throw new ConflictException(
        `The sale cannot be voided: its status is ${sale.status}. Only sales without returns can be voided.`
      );
    }
    const control = await client.query<{ status: string }>(
      `select status from cash_shift_controls
       where tenant_id = $1 and branch_id = $2 and cash_shift_id = $3
       for update`,
      [scope.tenantId, scope.branchId, sale.cashShiftId]
    );
    if (control.rows[0]?.status !== "OPEN") {
      throw new ConflictException(
        "An open cash shift is required: the cash shift of the sale is already closed."
      );
    }

    const cash = await client.query<{ net: string }>(
      `select (coalesce(sum(amount_bob), 0) - $4::numeric)::text as net
       from sale_payments where tenant_id = $1 and branch_id = $2 and sale_id = $3 and method = 'CASH'`,
      [scope.tenantId, scope.branchId, saleId, sale.changeAmountBob]
    );
    const cashReversedBob = fromUnits(toUnits(cash.rows[0]?.net ?? "0"));
    const drawer = await client.query(
      `update cash_shift_controls
       set expected_amount_bob = expected_amount_bob - $4::numeric
       where tenant_id = $1 and branch_id = $2 and cash_shift_id = $3
         and status = 'OPEN' and expected_amount_bob - $4::numeric >= 0`,
      [scope.tenantId, scope.branchId, sale.cashShiftId, cashReversedBob]
    );
    if (drawer.rowCount !== 1) {
      throw new ConflictException({
        code: "CASH_VOID_EXCEEDS_EXPECTED",
        message: "The void cannot take the expected cash of the shift below zero."
      });
    }

    // Stock goes back to the exact batches the sale consumed; FEFO is never re-run.
    const allocations = await client.query<{ batchId: string; quantityBase: string }>(
      `select a.batch_id as "batchId", sum(a.quantity_base)::text as "quantityBase"
       from sale_allocations a
       join sale_items i on i.tenant_id = a.tenant_id and i.branch_id = a.branch_id and i.id = a.sale_item_id
       where i.tenant_id = $1 and i.branch_id = $2 and i.sale_id = $3
       group by a.batch_id order by a.batch_id`,
      [scope.tenantId, scope.branchId, saleId]
    );
    for (const row of allocations.rows) {
      await this.restoreStock(client, scope, sale.warehouseId, row.batchId, row.quantityBase, "SALE_VOID", "SALE_VOID", saleId);
    }

    await client.query(
      `update sale_payments set reversed_at = now()
       where tenant_id = $1 and branch_id = $2 and sale_id = $3 and method in ('CARD', 'QR')`,
      [scope.tenantId, scope.branchId, saleId]
    );
    const updated = await client.query<{ voidedAt: Date }>(
      `update sales set status = 'VOIDED', voided_at = now(), voided_by_user_id = $4, void_reason = $5
       where tenant_id = $1 and branch_id = $2 and id = $3
       returning voided_at as "voidedAt"`,
      [scope.tenantId, scope.branchId, saleId, scope.userId, reason]
    );
    const voidedAt = updated.rows[0]?.voidedAt;
    if (!voidedAt) throw new Error("Sale was not voided.");

    await this.audit.recordInTransaction(client, scope, {
      action: "sales.sale_voided",
      entityType: "sale",
      entityId: saleId,
      payload: {
        saleNumber: sale.saleNumber,
        reason,
        cashShiftId: sale.cashShiftId,
        cashReversedBob,
        restoredBatches: allocations.rows.length
      }
    });
    await this.outbox.enqueueInTransaction(client, scope, {
      aggregateType: "sale",
      aggregateId: saleId,
      eventType: "sales.sale_voided",
      payload: { saleId, saleNumber: sale.saleNumber, cashReversedBob }
    });
    return {
      id: saleId,
      saleNumber: sale.saleNumber,
      status: "VOIDED",
      reason,
      voidedAt: voidedAt.toISOString(),
      cashReversedBob
    };
  }

  private async restoreStock(
    client: PoolClient,
    scope: TenantScope,
    warehouseId: string,
    batchId: string,
    quantityBase: string,
    movementType: string,
    referenceType: string,
    referenceId: string
  ): Promise<void> {
    await client.query(
      `insert into inventory_balances (tenant_id, warehouse_id, batch_id, quantity_base, reserved_base)
       values ($1, $2, $3, $4::bigint, 0)
       on conflict (tenant_id, warehouse_id, batch_id)
       do update set quantity_base = inventory_balances.quantity_base + excluded.quantity_base, updated_at = now()`,
      [scope.tenantId, warehouseId, batchId, quantityBase]
    );
    await client.query(
      `insert into inventory_movements
         (tenant_id, warehouse_id, batch_id, movement_type, movement_direction, quantity_base, reference_type, reference_id)
       values ($1, $2, $3, $4, 'IN', $5::bigint, $6, $7)`,
      [scope.tenantId, warehouseId, batchId, movementType, quantityBase, referenceType, referenceId]
    );
  }

  private async postReturn(
    client: PoolClient,
    scope: TenantScope,
    saleId: string,
    input: NormalizedReturn,
    access: SalesAccess
  ): Promise<RegisteredReturn> {
    const sale = await this.lockSale(client, scope, saleId, access);
    if (sale.status !== "CONFIRMED" && sale.status !== "PARTIALLY_RETURNED") {
      throw new ConflictException(`The sale accepts no returns: its status is ${sale.status}.`);
    }

    const items = await client.query<{
      id: string;
      quantity: string;
      quantityBase: string;
      unitPriceBob: string;
      returned: string;
    }>(
      `select i.id, i.quantity::text as quantity, i.quantity_base::text as "quantityBase",
              i.unit_price_bob::text as "unitPriceBob",
              coalesce((select sum(ri.quantity) from sale_return_items ri
                         where ri.tenant_id = i.tenant_id and ri.branch_id = i.branch_id and ri.sale_item_id = i.id), 0)::text as returned
       from sale_items i
       where i.tenant_id = $1 and i.branch_id = $2 and i.sale_id = $3
       for update of i`,
      [scope.tenantId, scope.branchId, saleId]
    );
    const byId = new Map(items.rows.map((row) => [row.id, row]));

    let refundUnits = 0n;
    const priced = input.lines.map((line) => {
      const item = uuidPattern.test(line.saleItemId) ? byId.get(line.saleItemId) : undefined;
      if (!item) throw new NotFoundException("Sale item not found in this sale.");
      const returnable = Number(item.quantity) - Number(item.returned);
      if (line.quantity > returnable) {
        throw new ConflictException({
          code: "RETURN_EXCEEDS_SOLD",
          message: "The return quantity exceeds what remains returnable for the sale item.",
          saleItemId: item.id,
          returnable
        });
      }
      const lineUnits = toUnits(item.unitPriceBob) * BigInt(line.quantity);
      refundUnits += lineUnits;
      const factor = Number(item.quantityBase) / Number(item.quantity);
      return { item, line, lineTotalBob: fromUnits(lineUnits), quantityBase: factor * line.quantity };
    });
    const refundAmountBob = fromUnits(refundUnits);
    if (refundUnits <= 0n) {
      throw new BadRequestException("The refund amount must be greater than zero.");
    }

    const returnNumber = await this.nextReturnNumber(client, scope);

    let cashShiftId: string | null = null;
    let cashMovementId: string | null = null;
    if (input.refundMethod === "CASH") {
      const shift = await client.query<{ id: string }>(
        `select control.cash_shift_id as id
         from cash_shift_controls control
         join cash_shift_users assignment
           on assignment.tenant_id = control.tenant_id and assignment.branch_id = control.branch_id
          and assignment.cash_shift_id = control.cash_shift_id
         join cash_shifts shift
           on shift.tenant_id = control.tenant_id and shift.branch_id = control.branch_id
          and shift.id = control.cash_shift_id
         where control.tenant_id = $1 and control.branch_id = $2 and control.status = 'OPEN'
           and assignment.user_id = $3 and shift.status = 'SCHEDULED'
         order by control.opened_at desc, control.cash_shift_id
         limit 1
         for update of control`,
        [scope.tenantId, scope.branchId, scope.userId]
      );
      cashShiftId = shift.rows[0]?.id ?? null;
      if (!cashShiftId) {
        throw new ConflictException(
          "An open cash shift assigned to the authenticated user is required to refund in cash."
        );
      }
      const drawer = await client.query(
        `update cash_shift_controls
         set expected_amount_bob = expected_amount_bob - $4::numeric
         where tenant_id = $1 and branch_id = $2 and cash_shift_id = $3
           and status = 'OPEN' and expected_amount_bob - $4::numeric >= 0`,
        [scope.tenantId, scope.branchId, cashShiftId, refundAmountBob]
      );
      if (drawer.rowCount !== 1) {
        throw new ConflictException({
          code: "CASH_REFUND_EXCEEDS_EXPECTED",
          message: "The cash refund cannot exceed the expected cash of the shift."
        });
      }
      const movement = await client.query<{ id: string }>(
        `insert into cash_movements (tenant_id, branch_id, cash_shift_id, type, amount_bob, reason, category, created_by_user_id)
         values ($1, $2, $3, 'OUT', $4::numeric, $5, 'OTHER', $6)
         returning id`,
        [
          scope.tenantId,
          scope.branchId,
          cashShiftId,
          refundAmountBob,
          `Devolución ${returnNumber} (venta ${sale.saleNumber})`,
          scope.userId
        ]
      );
      cashMovementId = movement.rows[0]?.id ?? null;
    }

    const header = await client.query<{ id: string; createdAt: Date }>(
      `insert into sale_returns
         (tenant_id, branch_id, sale_id, return_number, refund_method, refund_reference, refund_amount_bob,
          reason, restock, cash_shift_id, cash_movement_id, created_by_user_id)
       values ($1, $2, $3, $4, $5, $6, $7::numeric, $8, $9, $10, $11, $12)
       returning id, created_at as "createdAt"`,
      [
        scope.tenantId,
        scope.branchId,
        saleId,
        returnNumber,
        input.refundMethod,
        input.refundReference,
        refundAmountBob,
        input.reason,
        input.restock,
        cashShiftId,
        cashMovementId,
        scope.userId
      ]
    );
    const returnRow = header.rows[0];
    if (!returnRow) throw new Error("Return was not created.");

    for (const entry of priced) {
      const inserted = await client.query<{ id: string }>(
        `insert into sale_return_items
           (tenant_id, branch_id, sale_return_id, sale_item_id, quantity, quantity_base, unit_price_bob, line_total_bob)
         values ($1, $2, $3, $4, $5::bigint, $6::bigint, $7::numeric, $8::numeric)
         returning id`,
        [
          scope.tenantId,
          scope.branchId,
          returnRow.id,
          entry.item.id,
          entry.line.quantity,
          entry.quantityBase,
          entry.item.unitPriceBob,
          entry.lineTotalBob
        ]
      );
      const returnItemId = inserted.rows[0]?.id;
      if (!returnItemId) throw new Error("Return item was not created.");
      if (input.restock) {
        await this.restockLine(client, scope, sale, returnRow.id, returnItemId, entry.item.id, entry.quantityBase);
      }
    }

    const totals = await client.query<{ sold: string; returned: string }>(
      `select sum(i.quantity)::text as sold,
              coalesce((select sum(ri.quantity) from sale_return_items ri
                         join sale_items si on si.tenant_id = ri.tenant_id and si.branch_id = ri.branch_id and si.id = ri.sale_item_id
                        where si.tenant_id = $1 and si.branch_id = $2 and si.sale_id = $3), 0)::text as returned
       from sale_items i where i.tenant_id = $1 and i.branch_id = $2 and i.sale_id = $3`,
      [scope.tenantId, scope.branchId, saleId]
    );
    const saleStatus = totals.rows[0]?.sold === totals.rows[0]?.returned ? "RETURNED" : "PARTIALLY_RETURNED";
    await client.query(
      "update sales set status = $4 where tenant_id = $1 and branch_id = $2 and id = $3",
      [scope.tenantId, scope.branchId, saleId, saleStatus]
    );

    await this.audit.recordInTransaction(client, scope, {
      action: "sales.sale_returned",
      entityType: "sale_return",
      entityId: returnRow.id,
      payload: {
        saleId,
        saleNumber: sale.saleNumber,
        returnNumber,
        reason: input.reason,
        refundMethod: input.refundMethod,
        refundAmountBob,
        restock: input.restock,
        cashShiftId,
        saleStatus
      }
    });
    await this.outbox.enqueueInTransaction(client, scope, {
      aggregateType: "sale_return",
      aggregateId: returnRow.id,
      eventType: "sales.sale_returned",
      payload: { saleReturnId: returnRow.id, saleId, returnNumber, refundAmountBob, restock: input.restock }
    });
    return {
      id: returnRow.id,
      returnNumber,
      saleId,
      saleNumber: sale.saleNumber,
      saleStatus,
      refundMethod: input.refundMethod,
      refundReference: input.refundReference,
      refundAmountBob,
      restock: input.restock,
      reason: input.reason,
      lines: priced.map((entry) => ({
        saleItemId: entry.item.id,
        quantity: entry.line.quantity,
        unitPriceBob: entry.item.unitPriceBob,
        lineTotalBob: entry.lineTotalBob
      })),
      createdAt: returnRow.createdAt.toISOString()
    };
  }

  /**
   * Puts returned units back into the batches the line consumed, latest expiry first, never above
   * what each batch gave and never into a quarantined, disposed or expired batch.
   */
  private async restockLine(
    client: PoolClient,
    scope: TenantScope,
    sale: LockedSale,
    saleReturnId: string,
    returnItemId: string,
    saleItemId: string,
    quantityBase: number
  ): Promise<void> {
    const batches = await client.query<{
      batchId: string;
      lotCode: string;
      status: string;
      usable: boolean;
      capacity: string;
    }>(
      `select a.batch_id as "batchId", b.lot_code as "lotCode", b.status,
              (b.status = 'AVAILABLE' and b.expires_on >= current_date) as usable,
              (a.quantity_base - coalesce((
                 select sum(ra.quantity_base) from sale_return_allocations ra
                  join sale_return_items ri on ri.tenant_id = ra.tenant_id and ri.branch_id = ra.branch_id and ri.id = ra.sale_return_item_id
                 where ri.tenant_id = a.tenant_id and ri.branch_id = a.branch_id and ri.sale_item_id = a.sale_item_id
                   and ra.batch_id = a.batch_id), 0))::text as capacity
       from sale_allocations a
       join inventory_batches b on b.tenant_id = a.tenant_id and b.id = a.batch_id
       where a.tenant_id = $1 and a.branch_id = $2 and a.sale_item_id = $3
       order by b.expires_on desc, b.id desc`,
      [scope.tenantId, scope.branchId, saleItemId]
    );
    let remaining = quantityBase;
    for (const batch of batches.rows) {
      if (remaining === 0) break;
      const take = Math.min(remaining, Number(batch.capacity));
      if (take <= 0) continue;
      if (!batch.usable) {
        throw new ConflictException({
          code: "RESTOCK_BATCH_NOT_AVAILABLE",
          message: `Cannot restock into lot ${batch.lotCode} (${batch.status === "AVAILABLE" ? "expired" : batch.status.toLowerCase()}). Register the return with restock set to false.`,
          lotCode: batch.lotCode
        });
      }
      await this.restoreStock(client, scope, sale.warehouseId, batch.batchId, String(take), "SALE_RETURN", "SALE_RETURN", saleReturnId);
      await client.query(
        `insert into sale_return_allocations (tenant_id, branch_id, sale_return_item_id, batch_id, quantity_base)
         values ($1, $2, $3, $4, $5::bigint)`,
        [scope.tenantId, scope.branchId, returnItemId, batch.batchId, take]
      );
      remaining -= take;
    }
    if (remaining !== 0) {
      throw new ConflictException("The units to restock exceed what the original batches supplied.");
    }
  }

  private async nextReturnNumber(client: PoolClient, scope: TenantScope): Promise<string> {
    const branch = await client.query<{ code: string }>(
      "select code from branches where tenant_id = $1 and id = $2",
      [scope.tenantId, scope.branchId]
    );
    const number = await this.sequences.nextNumberInTransaction(client, "SALE_RETURN");
    return `D-${branch.rows[0]?.code ?? "SUC"}-${number.toString().padStart(6, "0")}`;
  }
}
