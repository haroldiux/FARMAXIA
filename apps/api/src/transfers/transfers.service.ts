import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { TenantDatabase, type TenantScope } from "../database/tenant-database.js";
import { FeatureService } from "../subscriptions/feature.service.js";
import { AuditService } from "../transversal/audit.service.js";
import { IdempotencyService, type IdempotentExecutionResult } from "../transversal/idempotency.service.js";
import { OutboxService } from "../transversal/outbox.service.js";

export type TransferStatus =
  | "REQUESTED"
  | "APPROVED"
  | "DISPATCHED"
  | "PARTIALLY_RECEIVED"
  | "RECEIVED"
  | "REJECTED"
  | "CANCELLED";

export interface TransferItemRequestInput {
  presentationId: string;
  batchId: string;
  requestedQty: number;
}

export interface RequestTransferInput {
  idempotencyKey: string;
  originWarehouseId: string;
  destinationWarehouseId: string;
  items: readonly TransferItemRequestInput[];
}

export interface TransferItemSummary {
  id: string;
  presentationId: string;
  batchId: string;
  requestedQty: number;
  dispatchedQty: number | null;
  receivedQty: number;
  differenceReason: string | null;
}

export interface TransferDetail {
  id: string;
  originWarehouseId: string;
  destinationWarehouseId: string;
  status: TransferStatus;
  requestedByUserId: string;
  dispatchedByUserId: string | null;
  dispatchedAt: string | null;
  completedAt: string | null;
  approvedAt: string | null;
  approvedByUserId: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  items: TransferItemSummary[];
}

export interface TransferListResult {
  items: TransferDetail[];
}

export interface TransferStockLookupItem {
  presentationId: string;
  productName: string;
  presentationName: string;
  batchId: string;
  lotCode: string | null;
  availableQty: number;
}

export interface TransferStockLookupResult {
  items: TransferStockLookupItem[];
}

export interface TransferWarehouseOption {
  id: string;
  name: string;
  branchId: string;
  branchName: string | null;
  warehouseType: string;
}

export interface TransferWarehouseListResult {
  items: TransferWarehouseOption[];
}

export interface DispatchTransferInput {
  idempotencyKey: string;
}

export interface ReceiveTransferItemInput {
  itemId: string;
  receivedQty: number;
  differenceReason?: string;
}

export interface ReceiveTransferInput {
  idempotencyKey: string;
  items: readonly ReceiveTransferItemInput[];
}

interface NormalizedReceiveInput {
  idempotencyKey: string;
  items: readonly { itemId: string; receivedQty: number; differenceReason: string | undefined }[];
}

export interface ApproveTransferInput {
  idempotencyKey: string;
}

export interface RejectTransferInput {
  idempotencyKey: string;
  reason: string;
}

interface NormalizedRejectInput {
  idempotencyKey: string;
  reason: string;
}

function text(value: unknown, field: string, maxLength: number): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > maxLength) {
    throw new BadRequestException(`${field} es obligatorio (máximo ${maxLength} caracteres).`);
  }
  return normalized;
}

function optionalText(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return text(value, field, maxLength);
}

function positiveQty(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new BadRequestException(`${field} debe ser un número entero positivo.`);
  }
  return value;
}

function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) {
    throw new Error(message);
  }
  return row;
}

interface WarehouseRow {
  id: string;
  warehouseType: string;
}

interface TransferRow {
  id: string;
  originWarehouseId: string;
  destinationWarehouseId: string;
  status: TransferStatus;
  requestedByUserId: string;
  dispatchedByUserId: string | null;
  dispatchedAt: Date | null;
  completedAt: Date | null;
  approvedAt: Date | null;
  approvedByUserId: string | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface TransferItemRow {
  id: string;
  transferId: string;
  presentationId: string;
  batchId: string;
  requestedQty: string;
  dispatchedQty: string | null;
  receivedQty: string;
  differenceReason: string | null;
}

interface TransferStockLookupRow {
  presentationId: string;
  productName: string;
  presentationName: string;
  batchId: string;
  lotCode: string | null;
  availableQty: string;
}

interface TransferWarehouseOptionRow {
  id: string;
  name: string;
  branchId: string;
  branchName: string | null;
  warehouseType: string;
}

function toItemSummary(row: TransferItemRow): TransferItemSummary {
  return {
    id: row.id,
    presentationId: row.presentationId,
    batchId: row.batchId,
    requestedQty: Number(row.requestedQty),
    dispatchedQty: row.dispatchedQty === null ? null : Number(row.dispatchedQty),
    receivedQty: Number(row.receivedQty),
    differenceReason: row.differenceReason
  };
}

function toDetail(row: TransferRow, items: TransferItemSummary[]): TransferDetail {
  return {
    id: row.id,
    originWarehouseId: row.originWarehouseId,
    destinationWarehouseId: row.destinationWarehouseId,
    status: row.status,
    requestedByUserId: row.requestedByUserId,
    dispatchedByUserId: row.dispatchedByUserId,
    dispatchedAt: row.dispatchedAt ? row.dispatchedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    approvedByUserId: row.approvedByUserId,
    rejectedAt: row.rejectedAt ? row.rejectedAt.toISOString() : null,
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    items
  };
}

const itemColumns = `id, transfer_id as "transferId", presentation_id as "presentationId", batch_id as "batchId",
  requested_qty as "requestedQty", dispatched_qty as "dispatchedQty", received_qty as "receivedQty",
  difference_reason as "differenceReason"`;

const transferColumns = `id, origin_warehouse_id as "originWarehouseId", destination_warehouse_id as "destinationWarehouseId",
  status, requested_by_user_id as "requestedByUserId", dispatched_by_user_id as "dispatchedByUserId",
  dispatched_at as "dispatchedAt", completed_at as "completedAt",
  approved_at as "approvedAt", approved_by_user_id as "approvedByUserId",
  rejected_at as "rejectedAt", rejection_reason as "rejectionReason",
  created_at as "createdAt", updated_at as "updatedAt"`;

/**
 * Module 7 (F14): branch-to-branch transfers. Stock leaves the origin's inventory_balances at
 * DISPATCH and enters the destination's at RECEPTION, by the quantity actually received (D55).
 * Approval gating (D53) is enforced in `dispatchTransfer` by checking the `transfers.approval`
 * SaaS feature; `approveTransfer`/`rejectTransfer` (T2) are the endpoints that move a transfer out
 * of REQUESTED into APPROVED or REJECTED. A REJECTED transfer can never reach DISPATCHED or
 * (PARTIALLY_)RECEIVED again: `postDispatch`/`postReceive` already require an exact status match
 * (REQUESTED/APPROVED for dispatch, DISPATCHED/PARTIALLY_RECEIVED for receive), so REJECTED falls
 * through to the existing ConflictException with no extra check needed.
 */
@Injectable()
export class TransfersService {
  private readonly idempotency = new IdempotencyService();
  private readonly audit = new AuditService();
  private readonly outbox = new OutboxService();
  private readonly features: FeatureService;

  constructor(@Inject(TenantDatabase) private readonly database: TenantDatabase) {
    this.features = new FeatureService(this.database);
  }

  async requestTransfer(scope: TenantScope, input: RequestTransferInput): Promise<TransferDetail> {
    const normalized = this.normalizeRequest(input);
    const result = await this.idempotency.execute(
      this.database,
      scope,
      "transfers.request",
      normalized.idempotencyKey,
      normalized,
      async (client) => this.postRequest(client, scope, normalized)
    );
    return (result.body ?? result.data) as TransferDetail;
  }

  async dispatchTransfer(scope: TenantScope, transferId: string, input: DispatchTransferInput): Promise<TransferDetail> {
    const id = text(transferId, "ID del traspaso", 64);
    const idempotencyKey = text(input?.idempotencyKey, "Idempotency key", 255);
    const requiresApproval = await this.features.isEnabled(scope, "transfers.approval");
    const result = await this.idempotency.execute(
      this.database,
      scope,
      "transfers.dispatch",
      idempotencyKey,
      { transferId: id, requiresApproval },
      async (client) => this.postDispatch(client, scope, id, requiresApproval)
    );
    return (result.body ?? result.data) as TransferDetail;
  }

  /**
   * REQUESTED -> APPROVED (D53/T2). Only meaningful on a plan with the `transfers.approval`
   * feature (Premium): a tenant without it dispatches directly from REQUESTED, so approving
   * there would be a no-op pretending to gate something that was never gated — rejected with a
   * clear `BadRequestException` instead of silently succeeding.
   */
  async approveTransfer(scope: TenantScope, transferId: string, input: ApproveTransferInput): Promise<TransferDetail> {
    const id = text(transferId, "ID del traspaso", 64);
    const idempotencyKey = text(input?.idempotencyKey, "Idempotency key", 255);
    const requiresApproval = await this.features.isEnabled(scope, "transfers.approval");
    if (!requiresApproval) {
      throw new BadRequestException(
        "Este plan no requiere aprobación de traspasos (solo el plan Premium la exige); el traspaso se despacha directamente."
      );
    }
    const result = await this.idempotency.execute(
      this.database,
      scope,
      "transfers.approve",
      idempotencyKey,
      { transferId: id },
      async (client) => this.postApprove(client, scope, id)
    );
    return (result.body ?? result.data) as TransferDetail;
  }

  /**
   * REQUESTED or APPROVED -> REJECTED (D53/T2, design decision beyond D53-D56: rejection is also
   * allowed from APPROVED, since an approver may change their mind before dispatch actually
   * happens; dispatch is the point of no return, not approval). REJECTED is terminal: dispatch and
   * receive already require an exact status match, so neither can ever act on a rejected transfer.
   */
  async rejectTransfer(scope: TenantScope, transferId: string, input: RejectTransferInput): Promise<TransferDetail> {
    const id = text(transferId, "ID del traspaso", 64);
    const normalized = this.normalizeReject(input);
    const result = await this.idempotency.execute(
      this.database,
      scope,
      "transfers.reject",
      normalized.idempotencyKey,
      { transferId: id, reason: normalized.reason },
      async (client) => this.postReject(client, scope, id, normalized.reason)
    );
    return (result.body ?? result.data) as TransferDetail;
  }

  async receiveTransfer(scope: TenantScope, transferId: string, input: ReceiveTransferInput): Promise<TransferDetail> {
    const id = text(transferId, "ID del traspaso", 64);
    const normalized = this.normalizeReceive(input);
    const result = await this.idempotency.execute(
      this.database,
      scope,
      "transfers.receive",
      normalized.idempotencyKey,
      { transferId: id, items: normalized.items },
      async (client) => this.postReceive(client, scope, id, normalized)
    );
    return (result.body ?? result.data) as TransferDetail;
  }

  async list(scope: TenantScope): Promise<TransferListResult> {
    return this.database.withScope(scope, async (client) => {
      const transferRows = await client.query<TransferRow>(
        `select ${transferColumns} from transfers order by created_at desc, id asc`
      );
      const items: TransferDetail[] = [];
      for (const row of transferRows.rows) {
        const itemRows = await client.query<TransferItemRow>(
          `select ${itemColumns} from transfer_items where tenant_id = $1 and transfer_id = $2 order by created_at asc, id asc`,
          [scope.tenantId, row.id]
        );
        items.push(toDetail(row, itemRows.rows.map(toItemSummary)));
      }
      return { items };
    });
  }

  async detail(scope: TenantScope, transferId: string): Promise<TransferDetail> {
    const id = text(transferId, "ID del traspaso", 64);
    return this.database.withScope(scope, async (client) => this.loadDetail(client, scope, id));
  }

  /**
   * Tenant-wide warehouse picker for building a transfer request (a second gap found while
   * implementing T3, closed within this same module/edit surface, not inventory's): neither
   * `GET /api/v1/inventory/warehouses` (branch-scoped to the caller's current branch) nor
   * `GET /api/v1/branches` (gated by `users.manage`, which `transfers.manage` holders like
   * `almacenero` don't have) lets a transfer requester see the *destination* branch's warehouses.
   * Reuses the `warehouses_transfers_select` RLS escape hatch from 0027_transfers.sql (T1) for
   * tenant-wide `warehouses` visibility. `branches` is LEFT JOINed, not INNER JOINed: the
   * `branches_branch_isolation` RLS policy (0003) still restricts `branches` rows to the caller's
   * own current branch, so an INNER JOIN would silently drop every warehouse belonging to another
   * branch; LEFT JOIN keeps the warehouse row and simply leaves `branchName` null when the
   * warehouse's branch isn't one the RLS policy lets this caller read a `branches` row for.
   */
  async listWarehouseOptions(scope: TenantScope): Promise<TransferWarehouseListResult> {
    return this.database.withScope(scope, async (client) => {
      const result = await client.query<TransferWarehouseOptionRow>(
        `select w.id, w.name, w.branch_id as "branchId", br.name as "branchName",
                w.warehouse_type as "warehouseType"
         from warehouses w
         left join branches br on br.tenant_id = w.tenant_id and br.id = w.branch_id
         where w.tenant_id = $1 and w.is_active
         order by w.name asc, w.id asc`,
        [scope.tenantId]
      );
      return { items: result.rows };
    });
  }

  /**
   * Stock lookup for building a transfer request (T3 gap closed): which presentations/batches
   * have positive available stock (quantity_base minus reserved_base, so a batch currently held
   * by a FEFO sales reservation is not offered for transfer) at a given warehouse. Gated by the
   * class-level `transfers.manage` permission only (no `sales.fefo.override` cross-module reuse,
   * per the task's explicit instruction) — `fetchWarehouse` also gives tenant-wide warehouse
   * visibility via the `warehouses_transfers_select` RLS policy, same as every other lookup here.
   */
  async lookupStock(scope: TenantScope, warehouseId: string): Promise<TransferStockLookupResult> {
    const id = text(warehouseId, "Almacén", 64);
    return this.database.withScope(scope, async (client) => {
      await this.fetchWarehouse(client, scope, id);
      const result = await client.query<TransferStockLookupRow>(
        `select pp.id as "presentationId", p.name as "productName", pp.name as "presentationName",
                ib.batch_id as "batchId", b.lot_code as "lotCode",
                (ib.quantity_base - ib.reserved_base)::text as "availableQty"
         from inventory_balances ib
         join inventory_batches b on b.tenant_id = ib.tenant_id and b.id = ib.batch_id
         join product_presentations pp on pp.tenant_id = b.tenant_id and pp.id = b.presentation_id
         join products p on p.tenant_id = pp.tenant_id and p.id = pp.product_id
         where ib.tenant_id = $1 and ib.warehouse_id = $2 and (ib.quantity_base - ib.reserved_base) > 0
         order by p.name, pp.name, b.lot_code`,
        [scope.tenantId, id]
      );
      return {
        items: result.rows.map((row) => ({
          presentationId: row.presentationId,
          productName: row.productName,
          presentationName: row.presentationName,
          batchId: row.batchId,
          lotCode: row.lotCode,
          availableQty: Number(row.availableQty)
        }))
      };
    });
  }

  private async loadDetail(client: PoolClient, scope: TenantScope, transferId: string): Promise<TransferDetail> {
    const transferResult = await client.query<TransferRow>(
      `select ${transferColumns} from transfers where tenant_id = $1 and id = $2`,
      [scope.tenantId, transferId]
    );
    const row = transferResult.rows[0];
    if (!row) {
      throw new NotFoundException("Traspaso no encontrado.");
    }
    const itemRows = await client.query<TransferItemRow>(
      `select ${itemColumns} from transfer_items where tenant_id = $1 and transfer_id = $2 order by created_at asc, id asc`,
      [scope.tenantId, transferId]
    );
    return toDetail(row, itemRows.rows.map(toItemSummary));
  }

  private normalizeRequest(input: RequestTransferInput): RequestTransferInput {
    const idempotencyKey = text(input?.idempotencyKey, "Idempotency key", 255);
    const originWarehouseId = text(input?.originWarehouseId, "Almacén de origen", 64);
    const destinationWarehouseId = text(input?.destinationWarehouseId, "Almacén de destino", 64);
    if (originWarehouseId === destinationWarehouseId) {
      throw new BadRequestException("El almacén de origen y el de destino deben ser distintos.");
    }
    const rawItems = Array.isArray(input?.items) ? input.items : [];
    if (rawItems.length === 0) {
      throw new BadRequestException("El traspaso debe incluir al menos un ítem.");
    }
    const items = rawItems.map((item, index) => ({
      presentationId: text(item?.presentationId, `Presentación del ítem ${index + 1}`, 64),
      batchId: text(item?.batchId, `Lote del ítem ${index + 1}`, 64),
      requestedQty: positiveQty(item?.requestedQty, `Cantidad solicitada del ítem ${index + 1}`)
    }));
    return { idempotencyKey, originWarehouseId, destinationWarehouseId, items };
  }

  private normalizeReceive(input: ReceiveTransferInput): NormalizedReceiveInput {
    const idempotencyKey = text(input?.idempotencyKey, "Idempotency key", 255);
    const rawItems = Array.isArray(input?.items) ? input.items : [];
    if (rawItems.length === 0) {
      throw new BadRequestException("La recepción debe incluir al menos un ítem.");
    }
    const items = rawItems.map((item, index) => ({
      itemId: text(item?.itemId, `ID del ítem ${index + 1}`, 64),
      receivedQty: positiveQty(item?.receivedQty, `Cantidad recibida del ítem ${index + 1}`),
      differenceReason: optionalText(item?.differenceReason, `Motivo de diferencia del ítem ${index + 1}`, 255)
    }));
    return { idempotencyKey, items };
  }

  private normalizeReject(input: RejectTransferInput): NormalizedRejectInput {
    const idempotencyKey = text(input?.idempotencyKey, "Idempotency key", 255);
    const reason = text(input?.reason, "Motivo de rechazo", 255);
    return { idempotencyKey, reason };
  }

  /**
   * Reads a warehouse by tenant-wide visibility (not scoped to the caller's current branch): a
   * transfer's origin or destination is frequently in a branch other than the requester's own, and
   * `warehouses_transfers_select` (0027_transfers.sql) grants `transfers.manage` holders tenant-wide
   * SELECT on warehouses for exactly this reason. No row lock is taken: nothing here writes to
   * `warehouses` itself, only validates it exists, is active, and reads its type.
   */
  private async fetchWarehouse(client: PoolClient, scope: TenantScope, warehouseId: string): Promise<WarehouseRow> {
    const result = await client.query<WarehouseRow>(
      `select id, warehouse_type as "warehouseType" from warehouses
       where tenant_id = $1 and id = $2 and is_active`,
      [scope.tenantId, warehouseId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException("El almacén indicado no existe en esta farmacia.");
    }
    return row;
  }

  private async lockTransfer(client: PoolClient, scope: TenantScope, transferId: string): Promise<TransferRow> {
    const result = await client.query<TransferRow>(
      `select ${transferColumns} from transfers where tenant_id = $1 and id = $2 for update`,
      [scope.tenantId, transferId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException("Traspaso no encontrado.");
    }
    return row;
  }

  private async postRequest(
    client: PoolClient,
    scope: TenantScope,
    input: RequestTransferInput
  ): Promise<IdempotentExecutionResult<TransferDetail>> {
    const origin = await this.fetchWarehouse(client, scope, input.originWarehouseId);
    await this.fetchWarehouse(client, scope, input.destinationWarehouseId);
    if (origin.warehouseType === "QUARANTINE") {
      throw new ConflictException("No se puede despachar traspasos desde un almacén de cuarentena.");
    }

    const inserted = await client.query<{ id: string }>(
      `insert into transfers (tenant_id, origin_warehouse_id, destination_warehouse_id, status, requested_by_user_id)
       values ($1, $2, $3, 'REQUESTED', $4)
       returning id`,
      [scope.tenantId, input.originWarehouseId, input.destinationWarehouseId, scope.userId]
    );
    const transferId = requireRow(inserted.rows[0], "Transfer was not created.").id;

    for (const item of input.items) {
      await client.query(
        `insert into transfer_items (tenant_id, transfer_id, presentation_id, batch_id, requested_qty)
         values ($1, $2, $3, $4, $5)`,
        [scope.tenantId, transferId, item.presentationId, item.batchId, item.requestedQty]
      );
    }

    await this.audit.recordInTransaction(client, scope, {
      action: "transfers.requested",
      entityType: "transfer",
      entityId: transferId,
      payload: {
        originWarehouseId: input.originWarehouseId,
        destinationWarehouseId: input.destinationWarehouseId,
        itemCount: input.items.length
      }
    });
    await this.outbox.enqueueInTransaction(client, scope, {
      aggregateType: "transfer",
      aggregateId: transferId,
      eventType: "transfers.requested",
      payload: { transferId }
    });

    const detail = await this.loadDetail(client, scope, transferId);
    return { statusCode: 201, body: detail };
  }

  private async postApprove(
    client: PoolClient,
    scope: TenantScope,
    transferId: string
  ): Promise<IdempotentExecutionResult<TransferDetail>> {
    const transfer = await this.lockTransfer(client, scope, transferId);
    if (transfer.status !== "REQUESTED") {
      throw new ConflictException("Solo se puede aprobar un traspaso que esté en estado solicitado.");
    }

    await client.query(
      `update transfers
       set status = 'APPROVED', approved_at = now(), approved_by_user_id = $3, updated_at = now()
       where tenant_id = $1 and id = $2`,
      [scope.tenantId, transferId, scope.userId]
    );

    await this.audit.recordInTransaction(client, scope, {
      action: "transfers.approved",
      entityType: "transfer",
      entityId: transferId,
      payload: {}
    });
    await this.outbox.enqueueInTransaction(client, scope, {
      aggregateType: "transfer",
      aggregateId: transferId,
      eventType: "transfers.approved",
      payload: { transferId }
    });

    const detail = await this.loadDetail(client, scope, transferId);
    return { statusCode: 200, body: detail };
  }

  private async postReject(
    client: PoolClient,
    scope: TenantScope,
    transferId: string,
    reason: string
  ): Promise<IdempotentExecutionResult<TransferDetail>> {
    const transfer = await this.lockTransfer(client, scope, transferId);
    if (transfer.status !== "REQUESTED" && transfer.status !== "APPROVED") {
      throw new ConflictException("Solo se puede rechazar un traspaso solicitado o aprobado.");
    }

    await client.query(
      `update transfers
       set status = 'REJECTED', rejected_at = now(), rejection_reason = $3, updated_at = now()
       where tenant_id = $1 and id = $2`,
      [scope.tenantId, transferId, reason]
    );

    await this.audit.recordInTransaction(client, scope, {
      action: "transfers.rejected",
      entityType: "transfer",
      entityId: transferId,
      payload: { reason }
    });
    await this.outbox.enqueueInTransaction(client, scope, {
      aggregateType: "transfer",
      aggregateId: transferId,
      eventType: "transfers.rejected",
      payload: { transferId }
    });

    const detail = await this.loadDetail(client, scope, transferId);
    return { statusCode: 200, body: detail };
  }

  private async postDispatch(
    client: PoolClient,
    scope: TenantScope,
    transferId: string,
    requiresApproval: boolean
  ): Promise<IdempotentExecutionResult<TransferDetail>> {
    const transfer = await this.lockTransfer(client, scope, transferId);
    const requiredStatus: TransferStatus = requiresApproval ? "APPROVED" : "REQUESTED";
    if (transfer.status !== requiredStatus) {
      throw new ConflictException(
        requiresApproval
          ? "El traspaso debe estar aprobado antes de despacharse (plan Premium)."
          : "El traspaso ya fue despachado, está en otro estado, o no está en estado solicitado."
      );
    }

    const itemsResult = await client.query<TransferItemRow>(
      `select ${itemColumns} from transfer_items where tenant_id = $1 and transfer_id = $2 for update`,
      [scope.tenantId, transferId]
    );

    for (const item of itemsResult.rows) {
      const requestedQty = Number(item.requestedQty);
      const updatedBalance = await client.query(
        `update inventory_balances
         set quantity_base = quantity_base - $4, updated_at = now()
         where tenant_id = $1 and warehouse_id = $2 and batch_id = $3 and quantity_base >= $4
         returning quantity_base`,
        [scope.tenantId, transfer.originWarehouseId, item.batchId, requestedQty]
      );
      if (updatedBalance.rowCount !== 1) {
        throw new ConflictException(`Stock insuficiente en el almacén de origen para el lote ${item.batchId}.`);
      }

      await client.query(`update transfer_items set dispatched_qty = $3 where tenant_id = $1 and id = $2`, [
        scope.tenantId,
        item.id,
        requestedQty
      ]);

      await client.query(
        `insert into inventory_movements
           (tenant_id, warehouse_id, batch_id, movement_type, movement_direction, quantity_base, reference_type, reference_id)
         values ($1, $2, $3, 'TRANSFER_OUT', 'OUT', $4, 'transfer', $5)`,
        [scope.tenantId, transfer.originWarehouseId, item.batchId, requestedQty, transferId]
      );
    }

    await client.query(
      `update transfers
       set status = 'DISPATCHED', dispatched_by_user_id = $3, dispatched_at = now(), updated_at = now()
       where tenant_id = $1 and id = $2`,
      [scope.tenantId, transferId, scope.userId]
    );

    await this.audit.recordInTransaction(client, scope, {
      action: "transfers.dispatched",
      entityType: "transfer",
      entityId: transferId,
      payload: { itemCount: itemsResult.rows.length }
    });
    await this.outbox.enqueueInTransaction(client, scope, {
      aggregateType: "transfer",
      aggregateId: transferId,
      eventType: "transfers.dispatched",
      payload: { transferId }
    });

    const detail = await this.loadDetail(client, scope, transferId);
    return { statusCode: 200, body: detail };
  }

  private async postReceive(
    client: PoolClient,
    scope: TenantScope,
    transferId: string,
    input: NormalizedReceiveInput
  ): Promise<IdempotentExecutionResult<TransferDetail>> {
    const transfer = await this.lockTransfer(client, scope, transferId);
    if (transfer.status !== "DISPATCHED" && transfer.status !== "PARTIALLY_RECEIVED") {
      throw new ConflictException("El traspaso debe estar despachado para registrar una recepción.");
    }

    for (const receiveItem of input.items) {
      const itemResult = await client.query<TransferItemRow>(
        `select ${itemColumns} from transfer_items where tenant_id = $1 and id = $2 and transfer_id = $3 for update`,
        [scope.tenantId, receiveItem.itemId, transferId]
      );
      const item = itemResult.rows[0];
      if (!item) {
        throw new NotFoundException(`Ítem de traspaso ${receiveItem.itemId} no encontrado.`);
      }
      if (item.dispatchedQty === null) {
        throw new ConflictException("El ítem todavía no fue despachado.");
      }
      const dispatchedQty = Number(item.dispatchedQty);
      const alreadyReceived = Number(item.receivedQty);
      const pending = dispatchedQty - alreadyReceived;
      if (receiveItem.receivedQty > pending) {
        throw new BadRequestException(`La cantidad recibida excede lo pendiente para el ítem ${item.id}.`);
      }

      await client.query(
        `update transfer_items
         set received_qty = received_qty + $3, difference_reason = coalesce($4, difference_reason)
         where tenant_id = $1 and id = $2`,
        [scope.tenantId, item.id, receiveItem.receivedQty, receiveItem.differenceReason ?? null]
      );

      await client.query(
        `insert into inventory_balances (tenant_id, warehouse_id, batch_id, quantity_base, reserved_base)
         values ($1, $2, $3, $4, 0)
         on conflict (tenant_id, warehouse_id, batch_id)
         do update set quantity_base = inventory_balances.quantity_base + excluded.quantity_base, updated_at = now()`,
        [scope.tenantId, transfer.destinationWarehouseId, item.batchId, receiveItem.receivedQty]
      );

      await client.query(
        `insert into inventory_movements
           (tenant_id, warehouse_id, batch_id, movement_type, movement_direction, quantity_base, reference_type, reference_id)
         values ($1, $2, $3, 'TRANSFER_IN', 'IN', $4, 'transfer', $5)`,
        [scope.tenantId, transfer.destinationWarehouseId, item.batchId, receiveItem.receivedQty, transferId]
      );
    }

    const allItemsResult = await client.query<TransferItemRow>(
      `select ${itemColumns} from transfer_items where tenant_id = $1 and transfer_id = $2`,
      [scope.tenantId, transferId]
    );
    const fullyReceived = allItemsResult.rows.every(
      (row) => row.dispatchedQty !== null && Number(row.receivedQty) === Number(row.dispatchedQty)
    );
    const newStatus: TransferStatus = fullyReceived ? "RECEIVED" : "PARTIALLY_RECEIVED";

    await client.query(
      `update transfers
       set status = $3::varchar, completed_at = case when $3::varchar = 'RECEIVED' then now() else completed_at end, updated_at = now()
       where tenant_id = $1 and id = $2`,
      [scope.tenantId, transferId, newStatus]
    );

    await this.audit.recordInTransaction(client, scope, {
      action: "transfers.received",
      entityType: "transfer",
      entityId: transferId,
      payload: { status: newStatus, itemCount: input.items.length }
    });
    await this.outbox.enqueueInTransaction(client, scope, {
      aggregateType: "transfer",
      aggregateId: transferId,
      eventType: newStatus === "RECEIVED" ? "transfers.received" : "transfers.partially_received",
      payload: { transferId, status: newStatus }
    });

    const detail = await this.loadDetail(client, scope, transferId);
    return { statusCode: 200, body: detail };
  }
}
