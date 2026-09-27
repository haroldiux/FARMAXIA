import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { TenantDatabase, type TenantScope } from "../database/tenant-database.js";
import { AuditService } from "../transversal/audit.service.js";

export type WarehouseType = "GENERAL" | "CENTRAL" | "QUARANTINE" | "COLD";

export interface WarehouseDetail {
  id: string;
  name: string;
  warehouseType: WarehouseType;
  isDispatchEnabled: boolean;
  isActive: boolean;
  batchCount: number;
  stockBase: number;
  reservedBase: number;
  createdAt: string;
}

export interface CreateWarehouseInput {
  name: string;
  warehouseType?: WarehouseType;
  isDispatchEnabled?: boolean;
}

export interface UpdateWarehouseInput {
  name?: string;
  warehouseType?: WarehouseType;
  isDispatchEnabled?: boolean;
  isActive?: boolean;
}

const warehouseTypes: WarehouseType[] = ["GENERAL", "CENTRAL", "QUARANTINE", "COLD"];

function warehouseName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (name.length < 2 || name.length > 160) {
    throw new BadRequestException("El nombre del almacén debe tener entre 2 y 160 caracteres.");
  }
  return name;
}

function warehouseType(value: unknown): WarehouseType {
  if (!warehouseTypes.includes(value as WarehouseType)) {
    throw new BadRequestException("Tipo de almacén no válido.");
  }
  return value as WarehouseType;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new BadRequestException(`${field} debe ser verdadero o falso.`);
  }
  return value;
}

const detailColumns = `
  w.id,
  w.name,
  w.warehouse_type as "warehouseType",
  w.is_dispatch_enabled as "isDispatchEnabled",
  w.is_active as "isActive",
  w.created_at as "createdAt",
  count(ib.batch_id) filter (where ib.quantity_base > 0)::int as "batchCount",
  coalesce(sum(ib.quantity_base), 0)::text as "stockBase",
  coalesce(sum(ib.reserved_base), 0)::text as "reservedBase"`;

interface DetailRow extends Omit<WarehouseDetail, "stockBase" | "reservedBase" | "createdAt"> {
  stockBase: string;
  reservedBase: string;
  createdAt: Date;
}

function toDetail(row: DetailRow): WarehouseDetail {
  return {
    ...row,
    stockBase: Number(row.stockBase),
    reservedBase: Number(row.reservedBase),
    createdAt: row.createdAt.toISOString()
  };
}

/**
 * Alta y configuración de almacenes de la sucursal activa: central, cuarentena y
 * cadena de frío. De un almacén de cuarentena nunca se despacha a ventas.
 */
@Injectable()
export class WarehousesService {
  private readonly audit = new AuditService();

  constructor(@Inject(TenantDatabase) private readonly database: TenantDatabase) {}

  async list(scope: TenantScope, includeInactive = false): Promise<{ items: WarehouseDetail[] }> {
    return this.database.withScope(scope, async (client) => {
      const result = await client.query<DetailRow>(
        `select ${detailColumns}
         from warehouses w
         left join inventory_balances ib on ib.tenant_id = w.tenant_id and ib.warehouse_id = w.id
         where w.tenant_id = $1 and w.branch_id = $2 and ($3::boolean or w.is_active)
         group by w.id
         order by w.is_active desc, w.name asc`,
        [scope.tenantId, scope.branchId, includeInactive]
      );
      return { items: result.rows.map(toDetail) };
    });
  }

  async create(scope: TenantScope, input: CreateWarehouseInput): Promise<WarehouseDetail> {
    const name = warehouseName(input.name);
    const type = warehouseType(input.warehouseType ?? "GENERAL");
    const requestedDispatch = optionalBoolean(input.isDispatchEnabled, "Despacho");
    // Cuarentena nunca despacha; los demás despachan salvo que se indique lo contrario.
    const isDispatchEnabled = type === "QUARANTINE" ? false : requestedDispatch ?? true;
    if (type === "QUARANTINE" && requestedDispatch === true) {
      throw new BadRequestException("Un almacén de cuarentena no puede despachar ventas.");
    }
    return this.database.withScope(scope, async (client) => {
      await this.assertUniqueName(client, scope, name);
      const inserted = await client.query<{ id: string }>(
        `insert into warehouses (tenant_id, branch_id, name, warehouse_type, is_dispatch_enabled)
         values ($1, $2, $3, $4, $5)
         returning id`,
        [scope.tenantId, scope.branchId, name, type, isDispatchEnabled]
      );
      const id = inserted.rows[0]!.id;
      await this.audit.recordInTransaction(client, {
        action: "inventory.warehouse_created",
        entityType: "warehouse",
        entityId: id,
        payload: { name, warehouseType: type, isDispatchEnabled }
      });
      return this.detail(client, scope, id);
    });
  }

  async update(scope: TenantScope, id: string, input: UpdateWarehouseInput): Promise<WarehouseDetail> {
    return this.database.withScope(scope, async (client) => {
      const current = await this.detail(client, scope, id, true);
      const name = input.name === undefined ? current.name : warehouseName(input.name);
      const type = input.warehouseType === undefined ? current.warehouseType : warehouseType(input.warehouseType);
      const requestedDispatch = optionalBoolean(input.isDispatchEnabled, "Despacho");
      const isActive = optionalBoolean(input.isActive, "Activo") ?? current.isActive;
      if (type === "QUARANTINE" && requestedDispatch === true) {
        throw new BadRequestException("Un almacén de cuarentena no puede despachar ventas.");
      }
      const isDispatchEnabled = type === "QUARANTINE" ? false : requestedDispatch ?? current.isDispatchEnabled;
      if (name !== current.name) {
        await this.assertUniqueName(client, scope, name, id);
      }
      if (current.isActive && !isActive) {
        if (current.stockBase > 0 || current.reservedBase > 0) {
          throw new ConflictException("No se puede desactivar un almacén con stock o reservas. Transfiere o da de baja el stock primero.");
        }
        const activeCount = await client.query<{ total: number }>(
          `select count(*)::int as total from inventory_counts
           where tenant_id = $1 and warehouse_id = $2 and status in ('OPEN', 'SUBMITTED')`,
          [scope.tenantId, id]
        );
        if (activeCount.rows[0]!.total > 0) {
          throw new ConflictException("El almacén tiene un conteo de inventario en curso.");
        }
      }
      await client.query(
        `update warehouses
         set name = $3, warehouse_type = $4, is_dispatch_enabled = $5, is_active = $6, updated_at = now()
         where tenant_id = $1 and id = $2`,
        [scope.tenantId, id, name, type, isDispatchEnabled, isActive]
      );
      await this.audit.recordInTransaction(client, {
        action: "inventory.warehouse_updated",
        entityType: "warehouse",
        entityId: id,
        payload: {
          before: {
            name: current.name,
            warehouseType: current.warehouseType,
            isDispatchEnabled: current.isDispatchEnabled,
            isActive: current.isActive
          },
          after: { name, warehouseType: type, isDispatchEnabled, isActive }
        }
      });
      return this.detail(client, scope, id);
    });
  }

  private async assertUniqueName(client: PoolClient, scope: TenantScope, name: string, exceptId?: string) {
    const existing = await client.query(
      `select 1 from warehouses
       where tenant_id = $1 and branch_id = $2 and lower(name) = lower($3) and ($4::uuid is null or id <> $4::uuid)`,
      [scope.tenantId, scope.branchId, name, exceptId ?? null]
    );
    if (existing.rowCount) {
      throw new ConflictException("Ya existe un almacén con ese nombre en la sucursal.");
    }
  }

  private async detail(client: PoolClient, scope: TenantScope, id: string, lock = false): Promise<WarehouseDetail> {
    if (lock) {
      await client.query("select id from warehouses where tenant_id = $1 and branch_id = $2 and id = $3 for update", [
        scope.tenantId,
        scope.branchId,
        id
      ]);
    }
    const result = await client.query<DetailRow>(
      `select ${detailColumns}
       from warehouses w
       left join inventory_balances ib on ib.tenant_id = w.tenant_id and ib.warehouse_id = w.id
       where w.tenant_id = $1 and w.branch_id = $2 and w.id = $3
       group by w.id`,
      [scope.tenantId, scope.branchId, id]
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException("Almacén no encontrado en la sucursal activa.");
    }
    return toDetail(row);
  }
}
