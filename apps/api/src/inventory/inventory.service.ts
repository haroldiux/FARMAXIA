import type { PoolClient } from "pg";
import type { TenantDatabase, TenantScope } from "../database/tenant-database.js";
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

function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) {
    throw new Error(message);
  }
  return row;
}

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

  private normalizeReconcile(input: ReconcileInput): ReconcileInput {
    return {
      idempotencyKey: text(input.idempotencyKey, "Idempotency key", 255),
      warehouseId: text(input.warehouseId, "Warehouse ID", 64),
      batchId: text(input.batchId, "Batch ID", 64),
      countedQuantity: nonNegativeQuantity(input.countedQuantity, "Counted quantity"),
      reason: text(input.reason, "Reason", 255)
    };
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
