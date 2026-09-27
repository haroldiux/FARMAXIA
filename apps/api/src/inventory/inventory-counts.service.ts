import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { TenantDatabase, type TenantScope } from "../database/tenant-database.js";
import { AuditService } from "../transversal/audit.service.js";
import { DocumentSequenceService } from "../transversal/document-sequence.service.js";
import { InventoryService } from "./inventory.service.js";

export type CountStatus = "OPEN" | "SUBMITTED" | "APPROVED" | "CANCELED";

export interface CountSummary {
  id: string;
  number: string;
  status: CountStatus;
  warehouseId: string;
  warehouseName: string;
  notes: string | null;
  lineCount: number;
  countedLines: number;
  differenceLines: number | null;
  createdByName: string | null;
  createdAt: string;
  submittedAt: string | null;
  closedAt: string | null;
}

export interface CountLine {
  batchId: string;
  lotCode: string;
  expiresOn: string;
  productName: string;
  presentationName: string;
  countedQuantity: number | null;
  /** Oculto (null) mientras el conteo está abierto: es un conteo ciego. */
  expectedQuantity: number | null;
  difference: number | null;
  countedAt: string | null;
}

export interface CountDetail extends CountSummary {
  lines: CountLine[];
}

export interface CreateCountInput {
  warehouseId: string;
  notes?: string;
}

export interface RecordCountLinesInput {
  lines: Array<{ batchId: string; countedQuantity: number | null }>;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(value: unknown, message: string): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new NotFoundException(message);
  }
  return value;
}

function dateOnly(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

interface SummaryRow {
  id: string;
  number: string;
  status: CountStatus;
  warehouseId: string;
  warehouseName: string;
  notes: string | null;
  lineCount: number;
  countedLines: number;
  differenceLines: number;
  createdByName: string | null;
  createdAt: Date;
  submittedAt: Date | null;
  closedAt: Date | null;
}

const summarySelect = `
  select c.id, c.number, c.status, c.notes,
         c.warehouse_id as "warehouseId", w.name as "warehouseName",
         c.created_at as "createdAt", c.submitted_at as "submittedAt", c.closed_at as "closedAt",
         u.display_name as "createdByName",
         count(l.id)::int as "lineCount",
         count(l.counted_quantity)::int as "countedLines",
         count(l.id) filter (where l.expected_quantity is not null
                               and l.counted_quantity is distinct from l.expected_quantity)::int as "differenceLines"
  from inventory_counts c
  join warehouses w on w.tenant_id = c.tenant_id and w.id = c.warehouse_id
  left join users u on u.id = c.created_by_user_id
  left join inventory_count_lines l on l.count_id = c.id`;

function toSummary(row: SummaryRow): CountSummary {
  const blind = row.status === "OPEN";
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouseName,
    notes: row.notes,
    lineCount: row.lineCount,
    countedLines: row.countedLines,
    differenceLines: blind ? null : row.differenceLines,
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
    submittedAt: iso(row.submittedAt),
    closedAt: iso(row.closedAt)
  };
}

/**
 * Inventario físico con conteo ciego: quien cuenta no ve el stock del sistema. Al
 * enviar el conteo se fija el stock esperado y un usuario con permiso de aprobación
 * revisa las diferencias; al aprobar se generan los ajustes (conciliaciones).
 */
@Injectable()
export class InventoryCountsService {
  private readonly audit = new AuditService();
  private readonly sequences = new DocumentSequenceService();

  constructor(
    @Inject(TenantDatabase) private readonly database: TenantDatabase,
    @Inject(InventoryService) private readonly inventory: InventoryService
  ) {}

  async list(scope: TenantScope, status?: string): Promise<{ items: CountSummary[] }> {
    const filter = status && ["OPEN", "SUBMITTED", "APPROVED", "CANCELED"].includes(status) ? status : null;
    return this.database.withScope(scope, async (client) => {
      const result = await client.query<SummaryRow>(
        `${summarySelect}
         where c.tenant_id = $1 and c.branch_id = $2 and ($3::varchar is null or c.status = $3::varchar)
         group by c.id, w.name, u.display_name
         order by c.created_at desc
         limit 100`,
        [scope.tenantId, scope.branchId, filter]
      );
      return { items: result.rows.map(toSummary) };
    });
  }

  async get(scope: TenantScope, id: string): Promise<CountDetail> {
    return this.database.withScope(scope, async (client) => this.detail(client, scope, id));
  }

  async create(scope: TenantScope, input: CreateCountInput): Promise<CountDetail> {
    const warehouseId = requireUuid(input.warehouseId, "Almacén no encontrado en la sucursal activa.");
    const notes = typeof input.notes === "string" && input.notes.trim() ? input.notes.trim().slice(0, 500) : null;
    return this.database.withScope(scope, async (client) => {
      const warehouse = await client.query<{ isActive: boolean }>(
        `select is_active as "isActive" from warehouses where tenant_id = $1 and branch_id = $2 and id = $3`,
        [scope.tenantId, scope.branchId, warehouseId]
      );
      if (!warehouse.rows[0]) {
        throw new NotFoundException("Almacén no encontrado en la sucursal activa.");
      }
      if (!warehouse.rows[0].isActive) {
        throw new ConflictException("El almacén está desactivado.");
      }
      const active = await client.query(
        `select 1 from inventory_counts where tenant_id = $1 and warehouse_id = $2 and status in ('OPEN', 'SUBMITTED')`,
        [scope.tenantId, warehouseId]
      );
      if (active.rowCount) {
        throw new ConflictException("Ya hay un conteo en curso para este almacén.");
      }
      const branch = await client.query<{ code: string }>("select code from branches where tenant_id = $1 and id = $2", [
        scope.tenantId,
        scope.branchId
      ]);
      const sequence = await this.sequences.nextNumberInTransaction(client, "INVENTORY_COUNT");
      const number = `INV-${branch.rows[0]?.code ?? "SUC"}-${sequence.toString().padStart(6, "0")}`;
      const inserted = await client.query<{ id: string }>(
        `insert into inventory_counts (tenant_id, branch_id, warehouse_id, number, notes, created_by_user_id)
         values ($1, $2, $3, $4, $5, $6)
         returning id`,
        [scope.tenantId, scope.branchId, warehouseId, number, notes, scope.userId]
      );
      const countId = inserted.rows[0]!.id;
      // Se cuentan todos los lotes con existencias en el almacén al abrir el conteo.
      const lines = await client.query(
        `insert into inventory_count_lines (tenant_id, branch_id, count_id, batch_id)
         select $1, $2, $3, ib.batch_id
         from inventory_balances ib
         where ib.tenant_id = $1 and ib.warehouse_id = $4 and ib.quantity_base > 0`,
        [scope.tenantId, scope.branchId, countId, warehouseId]
      );
      await this.audit.recordInTransaction(client, {
        action: "inventory.count_opened",
        entityType: "inventory_count",
        entityId: countId,
        payload: { number, warehouseId, lines: lines.rowCount ?? 0 }
      });
      return this.detail(client, scope, countId);
    });
  }

  async recordLines(scope: TenantScope, id: string, input: RecordCountLinesInput): Promise<CountDetail> {
    const countId = requireUuid(id, "Conteo no encontrado.");
    if (!Array.isArray(input?.lines) || input.lines.length === 0 || input.lines.length > 2000) {
      throw new BadRequestException("Envía entre 1 y 2000 líneas contadas.");
    }
    for (const line of input.lines) {
      const quantity = line.countedQuantity;
      if (quantity !== null && (!Number.isSafeInteger(quantity) || quantity < 0)) {
        throw new BadRequestException("Las cantidades contadas deben ser enteros de 0 o más.");
      }
    }
    return this.database.withScope(scope, async (client) => {
      const count = await this.lockCount(client, scope, countId);
      if (count.status !== "OPEN") {
        throw new ConflictException("Solo se pueden registrar cantidades en un conteo abierto.");
      }
      for (const line of input.lines) {
        const updated = await client.query(
          `update inventory_count_lines
           set counted_quantity = $3,
               counted_by_user_id = case when $3::bigint is null then null else $4::uuid end,
               counted_at = case when $3::bigint is null then null else now() end
           where count_id = $1 and batch_id = $2`,
          [countId, requireUuid(line.batchId, "Lote fuera del conteo."), line.countedQuantity, scope.userId]
        );
        if (!updated.rowCount) {
          throw new BadRequestException("Uno de los lotes no pertenece a este conteo.");
        }
      }
      return this.detail(client, scope, countId);
    });
  }

  async submit(scope: TenantScope, id: string): Promise<CountDetail> {
    const countId = requireUuid(id, "Conteo no encontrado.");
    return this.database.withScope(scope, async (client) => {
      const count = await this.lockCount(client, scope, countId);
      if (count.status !== "OPEN") {
        throw new ConflictException("El conteo ya fue enviado o cerrado.");
      }
      const pending = await client.query<{ total: number }>(
        "select count(*)::int as total from inventory_count_lines where count_id = $1 and counted_quantity is null",
        [countId]
      );
      if (pending.rows[0]!.total > 0) {
        throw new ConflictException(`Faltan ${pending.rows[0]!.total} lotes por contar.`);
      }
      // Se fija el stock del sistema en el momento del envío para la revisión.
      await client.query(
        `update inventory_count_lines l
         set expected_quantity = coalesce((
           select ib.quantity_base from inventory_balances ib
           where ib.tenant_id = l.tenant_id and ib.warehouse_id = $2 and ib.batch_id = l.batch_id
         ), 0)
         where l.count_id = $1`,
        [countId, count.warehouseId]
      );
      await client.query(
        `update inventory_counts set status = 'SUBMITTED', submitted_by_user_id = $2, submitted_at = now()
         where id = $1`,
        [countId, scope.userId]
      );
      await this.audit.recordInTransaction(client, {
        action: "inventory.count_submitted",
        entityType: "inventory_count",
        entityId: countId,
        payload: { number: count.number }
      });
      return this.detail(client, scope, countId);
    });
  }

  async approve(scope: TenantScope, id: string): Promise<CountDetail> {
    const countId = requireUuid(id, "Conteo no encontrado.");
    return this.database.withScope(scope, async (client) => {
      const count = await this.lockCount(client, scope, countId);
      if (count.status !== "SUBMITTED") {
        throw new ConflictException("Solo se aprueba un conteo enviado a revisión.");
      }
      const lines = await client.query<{ batchId: string; countedQuantity: string }>(
        `select batch_id as "batchId", counted_quantity as "countedQuantity"
         from inventory_count_lines where count_id = $1 order by batch_id`,
        [countId]
      );
      let adjusted = 0;
      for (const line of lines.rows) {
        try {
          // El ajuste se hace contra el stock actual (ver D37).
          const result = await this.inventory.applyReconciliation(client, scope, {
            idempotencyKey: `count:${countId}:${line.batchId}`,
            warehouseId: count.warehouseId,
            batchId: line.batchId,
            countedQuantity: Number(line.countedQuantity),
            reason: `Conteo físico ${count.number}`,
            countId
          });
          if (result.deltaQuantity !== 0) {
            adjusted += 1;
          }
        } catch (error) {
          if (error instanceof Error && error.message.includes("reserved")) {
            throw new ConflictException("Un lote quedaría con menos stock que sus reservas activas. Libera o consume las reservas y vuelve a aprobar.");
          }
          throw error;
        }
      }
      await client.query(
        "update inventory_counts set status = 'APPROVED', closed_by_user_id = $2, closed_at = now() where id = $1",
        [countId, scope.userId]
      );
      await this.audit.recordInTransaction(client, {
        action: "inventory.count_approved",
        entityType: "inventory_count",
        entityId: countId,
        payload: { number: count.number, lines: lines.rowCount ?? 0, adjustedLines: adjusted }
      });
      return this.detail(client, scope, countId);
    });
  }

  async cancel(scope: TenantScope, id: string): Promise<CountDetail> {
    const countId = requireUuid(id, "Conteo no encontrado.");
    return this.database.withScope(scope, async (client) => {
      const count = await this.lockCount(client, scope, countId);
      if (count.status !== "OPEN" && count.status !== "SUBMITTED") {
        throw new ConflictException("El conteo ya está cerrado.");
      }
      await client.query(
        "update inventory_counts set status = 'CANCELED', closed_by_user_id = $2, closed_at = now() where id = $1",
        [countId, scope.userId]
      );
      await this.audit.recordInTransaction(client, {
        action: "inventory.count_canceled",
        entityType: "inventory_count",
        entityId: countId,
        payload: { number: count.number, previousStatus: count.status }
      });
      return this.detail(client, scope, countId);
    });
  }

  private async lockCount(client: PoolClient, scope: TenantScope, countId: string) {
    const result = await client.query<{ status: CountStatus; number: string; warehouseId: string }>(
      `select status, number, warehouse_id as "warehouseId"
       from inventory_counts where tenant_id = $1 and branch_id = $2 and id = $3 for update`,
      [scope.tenantId, scope.branchId, countId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException("Conteo no encontrado.");
    }
    return row;
  }

  private async detail(client: PoolClient, scope: TenantScope, id: string): Promise<CountDetail> {
    const countId = requireUuid(id, "Conteo no encontrado.");
    const header = await client.query<SummaryRow>(
      `${summarySelect}
       where c.tenant_id = $1 and c.branch_id = $2 and c.id = $3
       group by c.id, w.name, u.display_name`,
      [scope.tenantId, scope.branchId, countId]
    );
    const row = header.rows[0];
    if (!row) {
      throw new NotFoundException("Conteo no encontrado.");
    }
    const summary = toSummary(row);
    const blind = summary.status === "OPEN";
    const lines = await client.query<{
      batchId: string;
      lotCode: string;
      expiresOn: string | Date;
      productName: string;
      presentationName: string;
      countedQuantity: string | null;
      expectedQuantity: string | null;
      countedAt: Date | null;
    }>(
      `select l.batch_id as "batchId", b.lot_code as "lotCode", b.expires_on as "expiresOn",
              p.name as "productName", pp.name as "presentationName",
              l.counted_quantity as "countedQuantity", l.expected_quantity as "expectedQuantity",
              l.counted_at as "countedAt"
       from inventory_count_lines l
       join inventory_batches b on b.tenant_id = l.tenant_id and b.id = l.batch_id
       join product_presentations pp on pp.tenant_id = b.tenant_id and pp.id = b.presentation_id
       join products p on p.tenant_id = pp.tenant_id and p.id = pp.product_id
       where l.count_id = $1
       order by p.name, pp.name, b.expires_on, b.lot_code`,
      [countId]
    );
    return {
      ...summary,
      lines: lines.rows.map((line) => {
        const counted = line.countedQuantity === null ? null : Number(line.countedQuantity);
        const expected = blind || line.expectedQuantity === null ? null : Number(line.expectedQuantity);
        return {
          batchId: line.batchId,
          lotCode: line.lotCode,
          expiresOn: dateOnly(line.expiresOn),
          productName: line.productName,
          presentationName: line.presentationName,
          countedQuantity: counted,
          expectedQuantity: expected,
          difference: counted !== null && expected !== null ? counted - expected : null,
          countedAt: iso(line.countedAt)
        };
      })
    };
  }
}
