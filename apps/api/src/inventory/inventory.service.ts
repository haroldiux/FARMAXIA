import { Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import { TenantDatabase, type TenantScope } from "../database/tenant-database.js";
import {
  IdempotencyService,
  type IdempotentExecutionResult
} from "../transversal/idempotency.service.js";
import { AuditService } from "../transversal/audit.service.js";

export interface ReconcileInput {
  idempotencyKey: string;
  warehouseId: string;
  batchId: string;
  countedQuantity: number;
  reason: string;
}

export interface ReconcileResult {
  reconciliationId: string;
  warehouseId: string;
  batchId: string;
  expectedQuantity: number;
  countedQuantity: number;
  deltaQuantity: number;
  quantityBase: number;
}

export interface InventoryBalance {
  warehouseId: string;
  batchId: string;
  quantityBase: number;
  reservedBase: number;
  availableQuantity: number;
}

export interface ReserveFefoInput {
  idempotencyKey: string;
  warehouseId: string;
  presentationId: string;
  quantityRequested: number;
  expiresAt: string;
}

export interface FefoAllocation {
  reservationId: string;
  batchId: string;
  lotCode: string;
  expiresOn: string;
  quantityBase: number;
}

export interface ReserveFefoResult {
  warehouseId: string;
  presentationId: string;
  quantityRequested: number;
  totalBaseUnits: number;
  expiresAt: string;
  allocations: FefoAllocation[];
}

export interface ReservationLifecycleInput {
  reservationId: string;
  idempotencyKey: string;
}

export interface ConsumeReservationInput extends ReservationLifecycleInput {
  referenceType: string;
  referenceId: string;
}

export interface ReservationLifecycleResult {
  reservationId: string;
  status: "ACTIVE" | "CONSUMED" | "RELEASED" | "EXPIRED";
  warehouseId: string;
  batchId: string;
  quantityBase: number;
  quantityAfter: number;
  reservedAfter: number;
}

export interface ExpireReservationsResult {
  expiredCount: number;
  reservationIds: string[];
}

interface BalanceRow {
  quantityBase: string;
  reservedBase: string;
}

interface ReconciliationRow {
  id: string;
}

interface UpdatedBalanceRow {
  quantityBase: string;
}

interface ReservationRow {
  id: string;
  warehouseId: string;
  batchId: string;
  quantityBase: string;
  status: "ACTIVE" | "CONSUMED" | "RELEASED" | "EXPIRED";
  expiresAt: Date;
}

interface FefoBatchRow {
  batchId: string;
  lotCode: string;
  expiresOn: string | Date;
  quantityBase: string;
  reservedBase: string;
}

interface PresentationFactorRow {
  baseUnitFactor: string;
}

interface ReservationBalanceRow {
  quantityBase: string;
  reservedBase: string;
}

function text(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${field} must be non-empty and at most ${maxLength} characters.`);
  }
  return normalized;
}

function nonNegativeQuantity(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer.`);
  }
  return value;
}

function positiveQuantity(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer.`);
  }
  return value;
}

function futureTimestamp(value: string): string {
  const normalized = value.trim();
  const timestamp = new Date(normalized);
  if (!normalized || Number.isNaN(timestamp.getTime()) || timestamp.getTime() <= Date.now()) {
    throw new Error("Expiration timestamp must be a valid future date.");
  }
  return timestamp.toISOString();
}

function safeProduct(left: number, right: number, field: string): number {
  const product = left * right;
  if (!Number.isSafeInteger(product)) {
    throw new Error(`${field} exceeds the safe integer range.`);
  }
  return product;
}

function dateOnly(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return value.slice(0, 10);
}

function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) {
    throw new Error(message);
  }
  return row;
}

@Injectable()
export class InventoryService {
  private readonly idempotency = new IdempotencyService();
  private readonly audit = new AuditService();

  constructor(private readonly database: TenantDatabase) {}

  async reconcile(scope: TenantScope, input: ReconcileInput): Promise<ReconcileResult> {
    const normalized = this.normalizeReconcile(input);
    const result = await this.idempotency.execute(
      this.database,
      scope,
      "inventory.reconcile",
      normalized.idempotencyKey,
      normalized,
      async (client) => this.postReconciliation(client, scope, normalized)
    );
    return (result.body ?? result.data) as ReconcileResult;
  }

  async getBalance(
    scope: TenantScope,
    warehouseId: string,
    batchId: string
  ): Promise<InventoryBalance | null> {
    const warehouse = text(warehouseId, "Warehouse ID", 64);
    const batch = text(batchId, "Batch ID", 64);
    return this.database.withScope(scope, async (client) => {
      const result = await client.query<BalanceRow>(
        `select quantity_base as "quantityBase", reserved_base as "reservedBase"
         from inventory_balances
         where tenant_id = $1 and warehouse_id = $2 and batch_id = $3`,
        [scope.tenantId, warehouse, batch]
      );
      const row = result.rows[0];
      if (!row) {
        return null;
      }
      const quantityBase = Number(row.quantityBase);
      const reservedBase = Number(row.reservedBase);
      return {
        warehouseId: warehouse,
        batchId: batch,
        quantityBase,
        reservedBase,
        availableQuantity: quantityBase - reservedBase
      };
    });
  }

  async reserveFefo(scope: TenantScope, input: ReserveFefoInput): Promise<ReserveFefoResult> {
    const normalized = this.normalizeReserve(input);
    const result = await this.idempotency.execute(
      this.database,
      scope,
      "inventory.reserve_fefo",
      normalized.idempotencyKey,
      normalized,
      async (client) => this.postFefoReservation(client, scope, normalized)
    );
    return (result.body ?? result.data) as ReserveFefoResult;
  }

  async releaseReservation(
    scope: TenantScope,
    input: ReservationLifecycleInput
  ): Promise<ReservationLifecycleResult> {
    const normalized = this.normalizeLifecycle(input);
    const result = await this.idempotency.execute(
      this.database,
      scope,
      "inventory.release_reservation",
      normalized.idempotencyKey,
      normalized,
      async (client) => this.postRelease(client, scope, normalized)
    );
    return (result.body ?? result.data) as ReservationLifecycleResult;
  }

  async consumeReservation(
    scope: TenantScope,
    input: ConsumeReservationInput
  ): Promise<ReservationLifecycleResult> {
    const normalized = this.normalizeConsume(input);
    const result = await this.idempotency.execute(
      this.database,
      scope,
      "inventory.consume_reservation",
      normalized.idempotencyKey,
      normalized,
      async (client) => this.postConsume(client, scope, normalized)
    );
    return (result.body ?? result.data) as ReservationLifecycleResult;
  }

  async expireReservations(scope: TenantScope): Promise<ExpireReservationsResult> {
    return this.database.withScope(scope, async (client) => {
      const expiredRows = await client.query<ReservationRow>(
        `select id,
                warehouse_id as "warehouseId",
                batch_id as "batchId",
                quantity_base as "quantityBase",
                status,
                expires_at as "expiresAt"
         from inventory_reservations
         where tenant_id = $1
           and status = 'ACTIVE'
           and expires_at <= now()
         order by id asc
         for update`,
        [scope.tenantId]
      );
      const reservationIds: string[] = [];
      for (const reservation of expiredRows.rows) {
        await this.finalizeExpired(client, scope, reservation);
        reservationIds.push(reservation.id);
      }
      return { expiredCount: reservationIds.length, reservationIds };
    });
  }

  private normalizeReconcile(input: ReconcileInput): ReconcileInput {
    return {
      idempotencyKey: text(input.idempotencyKey, "Idempotency key", 255),
      warehouseId: text(input.warehouseId, "Warehouse ID", 64),
      batchId: text(input.batchId, "Batch ID", 64),
      countedQuantity: nonNegativeQuantity(input.countedQuantity, "Counted quantity"),
      reason: text(input.reason, "Reason", 255)
    };
  }

  private normalizeReserve(input: ReserveFefoInput): ReserveFefoInput {
    return {
      idempotencyKey: text(input.idempotencyKey, "Idempotency key", 255),
      warehouseId: text(input.warehouseId, "Warehouse ID", 64),
      presentationId: text(input.presentationId, "Presentation ID", 64),
      quantityRequested: positiveQuantity(input.quantityRequested, "Requested quantity"),
      expiresAt: futureTimestamp(input.expiresAt)
    };
  }

  private normalizeLifecycle(input: ReservationLifecycleInput): ReservationLifecycleInput {
    return {
      reservationId: text(input.reservationId, "Reservation ID", 64),
      idempotencyKey: text(input.idempotencyKey, "Idempotency key", 255)
    };
  }

  private normalizeConsume(input: ConsumeReservationInput): ConsumeReservationInput {
    return {
      ...this.normalizeLifecycle(input),
      referenceType: text(input.referenceType, "Reference type", 80),
      referenceId: text(input.referenceId, "Reference ID", 100)
    };
  }

  private async postFefoReservation(
    client: PoolClient,
    scope: TenantScope,
    input: ReserveFefoInput
  ): Promise<IdempotentExecutionResult<ReserveFefoResult>> {
    const presentationResult = await client.query<PresentationFactorRow>(
      `select base_unit_factor as "baseUnitFactor"
       from product_presentations
       where tenant_id = $1 and id = $2 and is_sellable = true`,
      [scope.tenantId, input.presentationId]
    );
    const presentation = requireRow(
      presentationResult.rows[0],
      "Sellable presentation is not available in this scope."
    );
    const requestedBaseUnits = safeProduct(
      input.quantityRequested,
      Number(presentation.baseUnitFactor),
      "Requested base units"
    );

    const candidateResult = await client.query<FefoBatchRow>(
      `select ib.batch_id as "batchId",
              b.lot_code as "lotCode",
              b.expires_on as "expiresOn",
              ib.quantity_base as "quantityBase",
              ib.reserved_base as "reservedBase"
       from inventory_balances ib
       join inventory_batches b
         on b.tenant_id = ib.tenant_id and b.id = ib.batch_id
       join warehouses w
         on w.tenant_id = ib.tenant_id and w.id = ib.warehouse_id
       where ib.tenant_id = $1
         and ib.warehouse_id = $2
         and b.presentation_id = $3
         and b.status = 'AVAILABLE'
         and b.expires_on >= current_date
         and w.branch_id = $4
         and w.is_dispatch_enabled = true
         and ib.quantity_base > ib.reserved_base
       order by b.expires_on asc, ib.batch_id asc
       for update of ib, b`,
      [scope.tenantId, input.warehouseId, input.presentationId, scope.branchId]
    );
    const availableBaseUnits = candidateResult.rows.reduce(
      (total, row) => total + Number(row.quantityBase) - Number(row.reservedBase),
      0
    );
    if (availableBaseUnits < requestedBaseUnits) {
      throw new Error(
        `Insufficient available inventory. Required: ${requestedBaseUnits} base units, available: ${availableBaseUnits}.`
      );
    }

    let remaining = requestedBaseUnits;
    const allocations: FefoAllocation[] = [];
    for (const candidate of candidateResult.rows) {
      if (remaining <= 0) {
        break;
      }
      const available = Number(candidate.quantityBase) - Number(candidate.reservedBase);
      const quantityBase = Math.min(remaining, available);
      const reservationResult = await client.query<{ id: string }>(
        `insert into inventory_reservations
           (tenant_id, warehouse_id, batch_id, quantity_base, idempotency_key, expires_at)
         values ($1, $2, $3, $4, $5, $6)
         returning id`,
        [
          scope.tenantId,
          input.warehouseId,
          candidate.batchId,
          quantityBase,
          input.idempotencyKey,
          input.expiresAt
        ]
      );
      const reservation = requireRow(reservationResult.rows[0], "Inventory reservation was not created.");
      const updatedBalance = await client.query<ReservationBalanceRow>(
        `update inventory_balances
         set reserved_base = reserved_base + $4, updated_at = now()
         where tenant_id = $1 and warehouse_id = $2 and batch_id = $3
         returning quantity_base as "quantityBase", reserved_base as "reservedBase"`,
        [scope.tenantId, input.warehouseId, candidate.batchId, quantityBase]
      );
      const balance = requireRow(updatedBalance.rows[0], "Inventory balance was not updated.");
      await this.audit.recordInTransaction(client, {
        action: "inventory.reserved",
        entityType: "inventory_reservation",
        entityId: reservation.id,
        payload: {
          warehouseId: input.warehouseId,
          batchId: candidate.batchId,
          quantityBase,
          expiresAt: input.expiresAt,
          quantityAfter: Number(balance.quantityBase),
          reservedAfter: Number(balance.reservedBase)
        }
      });
      allocations.push({
        reservationId: reservation.id,
        batchId: candidate.batchId,
        lotCode: candidate.lotCode,
        expiresOn: dateOnly(candidate.expiresOn),
        quantityBase
      });
      remaining -= quantityBase;
    }

    return {
      statusCode: 201,
      body: {
        warehouseId: input.warehouseId,
        presentationId: input.presentationId,
        quantityRequested: input.quantityRequested,
        totalBaseUnits: requestedBaseUnits,
        expiresAt: input.expiresAt,
        allocations
      }
    };
  }

  private async postRelease(
    client: PoolClient,
    scope: TenantScope,
    input: ReservationLifecycleInput
  ): Promise<IdempotentExecutionResult<ReservationLifecycleResult>> {
    const reservation = await this.lockReservation(client, scope, input.reservationId);
    if (reservation.status !== "ACTIVE") {
      return { statusCode: 200, body: await this.reservationResult(client, scope, reservation) };
    }
    if (reservation.expiresAt.getTime() <= Date.now()) {
      await this.finalizeExpired(client, scope, reservation);
      return {
        statusCode: 200,
        body: await this.reservationResult(client, scope, { ...reservation, status: "EXPIRED" })
      };
    }
    const balance = await this.decrementReserved(client, scope, reservation);
    await client.query(
      `update inventory_reservations
       set status = 'RELEASED', released_at = now()
       where tenant_id = $1 and id = $2`,
      [scope.tenantId, reservation.id]
    );
    await this.audit.recordInTransaction(client, {
      action: "inventory.reservation_released",
      entityType: "inventory_reservation",
      entityId: reservation.id,
      payload: { quantityBase: Number(reservation.quantityBase) }
    });
    return {
      statusCode: 200,
      body: this.lifecycleResult(reservation, "RELEASED", balance)
    };
  }

  private async postConsume(
    client: PoolClient,
    scope: TenantScope,
    input: ConsumeReservationInput
  ): Promise<IdempotentExecutionResult<ReservationLifecycleResult>> {
    const reservation = await this.lockReservation(client, scope, input.reservationId);
    if (reservation.status !== "ACTIVE") {
      return { statusCode: 200, body: await this.reservationResult(client, scope, reservation) };
    }
    if (reservation.expiresAt.getTime() <= Date.now()) {
      await this.finalizeExpired(client, scope, reservation);
      return { statusCode: 200, body: await this.reservationResult(client, scope, { ...reservation, status: "EXPIRED" }) };
    }
    const balanceResult = await client.query<ReservationBalanceRow>(
      `update inventory_balances
       set quantity_base = quantity_base - $4,
           reserved_base = reserved_base - $4,
           updated_at = now()
       where tenant_id = $1 and warehouse_id = $2 and batch_id = $3
         and quantity_base >= $4 and reserved_base >= $4
       returning quantity_base as "quantityBase", reserved_base as "reservedBase"`,
      [scope.tenantId, reservation.warehouseId, reservation.batchId, Number(reservation.quantityBase)]
    );
    const balance = requireRow(balanceResult.rows[0], "Reservation cannot be consumed from available stock.");
    await client.query(
      `insert into inventory_movements
         (tenant_id, warehouse_id, batch_id, movement_type, movement_direction,
          quantity_base, reference_type, reference_id)
       values ($1, $2, $3, 'RESERVATION_CONSUME', 'OUT', $4, $5, $6)`,
      [
        scope.tenantId,
        reservation.warehouseId,
        reservation.batchId,
        Number(reservation.quantityBase),
        input.referenceType,
        input.referenceId
      ]
    );
    await client.query(
      `update inventory_reservations
       set status = 'CONSUMED', consumed_at = now()
       where tenant_id = $1 and id = $2`,
      [scope.tenantId, reservation.id]
    );
    await this.audit.recordInTransaction(client, {
      action: "inventory.reservation_consumed",
      entityType: "inventory_reservation",
      entityId: reservation.id,
      payload: {
        quantityBase: Number(reservation.quantityBase),
        referenceType: input.referenceType,
        referenceId: input.referenceId
      }
    });
    return {
      statusCode: 200,
      body: this.lifecycleResult(reservation, "CONSUMED", balance)
    };
  }

  private async lockReservation(
    client: PoolClient,
    scope: TenantScope,
    reservationId: string
  ): Promise<ReservationRow> {
    const result = await client.query<ReservationRow>(
      `select id,
              warehouse_id as "warehouseId",
              batch_id as "batchId",
              quantity_base as "quantityBase",
              status,
              expires_at as "expiresAt"
       from inventory_reservations
       where tenant_id = $1 and id = $2
       for update`,
      [scope.tenantId, reservationId]
    );
    return requireRow(result.rows[0], "Inventory reservation is not available in this scope.");
  }

  private async reservationResult(
    client: PoolClient,
    scope: TenantScope,
    reservation: ReservationRow
  ): Promise<ReservationLifecycleResult> {
    const balanceResult = await client.query<ReservationBalanceRow>(
      `select quantity_base as "quantityBase", reserved_base as "reservedBase"
       from inventory_balances
       where tenant_id = $1 and warehouse_id = $2 and batch_id = $3`,
      [scope.tenantId, reservation.warehouseId, reservation.batchId]
    );
    const balance = requireRow(balanceResult.rows[0], "Inventory balance is not available in this scope.");
    return this.lifecycleResult(reservation, reservation.status, balance);
  }

  private lifecycleResult(
    reservation: ReservationRow,
    status: ReservationLifecycleResult["status"],
    balance: ReservationBalanceRow
  ): ReservationLifecycleResult {
    return {
      reservationId: reservation.id,
      status,
      warehouseId: reservation.warehouseId,
      batchId: reservation.batchId,
      quantityBase: Number(reservation.quantityBase),
      quantityAfter: Number(balance.quantityBase),
      reservedAfter: Number(balance.reservedBase)
    };
  }

  private async decrementReserved(
    client: PoolClient,
    scope: TenantScope,
    reservation: ReservationRow
  ): Promise<ReservationBalanceRow> {
    const result = await client.query<ReservationBalanceRow>(
      `update inventory_balances
       set reserved_base = reserved_base - $4, updated_at = now()
       where tenant_id = $1 and warehouse_id = $2 and batch_id = $3
         and reserved_base >= $4
       returning quantity_base as "quantityBase", reserved_base as "reservedBase"`,
      [scope.tenantId, reservation.warehouseId, reservation.batchId, Number(reservation.quantityBase)]
    );
    return requireRow(result.rows[0], "Inventory reservation counter cannot be released.");
  }

  private async finalizeExpired(
    client: PoolClient,
    scope: TenantScope,
    reservation: ReservationRow
  ): Promise<void> {
    const balance = await this.decrementReserved(client, scope, reservation);
    await client.query(
      `update inventory_reservations
       set status = 'EXPIRED', released_at = now()
       where tenant_id = $1 and id = $2 and status = 'ACTIVE'`,
      [scope.tenantId, reservation.id]
    );
    await this.audit.recordInTransaction(client, {
      action: "inventory.reservation_expired",
      entityType: "inventory_reservation",
      entityId: reservation.id,
      payload: {
        quantityBase: Number(reservation.quantityBase),
        quantityAfter: Number(balance.quantityBase),
        reservedAfter: Number(balance.reservedBase)
      }
    });
  }

  private async postReconciliation(
    client: PoolClient,
    scope: TenantScope,
    input: ReconcileInput
  ): Promise<IdempotentExecutionResult<ReconcileResult>> {
    const balanceResult = await client.query<BalanceRow>(
      `select quantity_base as "quantityBase", reserved_base as "reservedBase"
       from inventory_balances
       where tenant_id = $1 and warehouse_id = $2 and batch_id = $3
       for update`,
      [scope.tenantId, input.warehouseId, input.batchId]
    );
    const balance = requireRow(
      balanceResult.rows[0],
      "Inventory balance is not available in this scope."
    );
    const expectedQuantity = Number(balance.quantityBase);
    const deltaQuantity = input.countedQuantity - expectedQuantity;

    const reconciliationResult = await client.query<ReconciliationRow>(
      `insert into inventory_reconciliations
         (tenant_id, warehouse_id, batch_id, idempotency_key,
          expected_quantity, counted_quantity, delta_quantity, reason)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id`,
      [
        scope.tenantId,
        input.warehouseId,
        input.batchId,
        input.idempotencyKey,
        expectedQuantity,
        input.countedQuantity,
        deltaQuantity,
        input.reason
      ]
    );
    const reconciliation = requireRow(
      reconciliationResult.rows[0],
      "Inventory reconciliation was not created."
    );

    let quantityBase = expectedQuantity;
    if (deltaQuantity > 0) {
      const updated = await client.query<UpdatedBalanceRow>(
        `update inventory_balances
         set quantity_base = quantity_base + $4, updated_at = now()
         where tenant_id = $1 and warehouse_id = $2 and batch_id = $3
         returning quantity_base as "quantityBase"`,
        [scope.tenantId, input.warehouseId, input.batchId, deltaQuantity]
      );
      quantityBase = Number(requireRow(updated.rows[0], "Inventory balance was not updated.").quantityBase);
    } else if (deltaQuantity < 0) {
      const decrease = Math.abs(deltaQuantity);
      const updated = await client.query<UpdatedBalanceRow>(
        `update inventory_balances
         set quantity_base = quantity_base - $4, updated_at = now()
         where tenant_id = $1 and warehouse_id = $2 and batch_id = $3
           and quantity_base - $4 >= reserved_base
         returning quantity_base as "quantityBase"`,
        [scope.tenantId, input.warehouseId, input.batchId, decrease]
      );
      if (updated.rows.length === 0) {
        throw new Error("Inventory adjustment would reduce available stock below reserved units.");
      }
      quantityBase = Number(requireRow(updated.rows[0], "Inventory balance was not updated.").quantityBase);
    }

    if (deltaQuantity !== 0) {
      await client.query(
        `insert into inventory_movements
           (tenant_id, warehouse_id, batch_id, movement_type, movement_direction,
            quantity_base, reference_type, reference_id)
         values ($1, $2, $3, 'ADJUSTMENT', $4, $5, 'INVENTORY_RECONCILIATION', $6)`,
        [
          scope.tenantId,
          input.warehouseId,
          input.batchId,
          deltaQuantity > 0 ? "IN" : "OUT",
          Math.abs(deltaQuantity),
          reconciliation.id
        ]
      );
    }

    await this.audit.recordInTransaction(client, {
      action: "inventory.reconciled",
      entityType: "inventory_reconciliation",
      entityId: reconciliation.id,
      payload: {
        warehouseId: input.warehouseId,
        batchId: input.batchId,
        expectedQuantity,
        countedQuantity: input.countedQuantity,
        deltaQuantity,
        quantityBase
      }
    });

    return {
      statusCode: 200,
      body: {
        reconciliationId: reconciliation.id,
        warehouseId: input.warehouseId,
        batchId: input.batchId,
        expectedQuantity,
        countedQuantity: input.countedQuantity,
        deltaQuantity,
        quantityBase
      }
    };
  }
}
