import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { TenantDatabase, type TenantScope } from "../database/tenant-database.js";

export interface WasteActSummary {
  id: string;
  actNumber: string | null;
  createdAt: string;
  warehouseName: string;
  productName: string;
  presentationName: string;
  lotCode: string;
  expiresOn: string;
  quantityBase: number;
  reason: string;
  disposalMethod: string | null;
  createdByName: string | null;
}

export interface WasteActDocument extends WasteActSummary {
  tenantName: string;
  legalName: string;
  taxId: string;
  branchCode: string;
  branchName: string;
  unitCost: string;
  totalCost: string;
}

export interface ReservationSummary {
  id: string;
  status: "ACTIVE" | "CONSUMED" | "RELEASED" | "EXPIRED";
  warehouseName: string;
  productName: string;
  presentationName: string;
  lotCode: string;
  expiresOn: string;
  quantityBase: number;
  reservedUntil: string;
  createdAt: string;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dateOnly(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

const wasteSelect = `
  select e.id, e.act_number as "actNumber", e.created_at as "createdAt",
         w.name as "warehouseName", p.name as "productName", pp.name as "presentationName",
         b.lot_code as "lotCode", b.expires_on as "expiresOn", b.unit_cost::text as "unitCost",
         e.quantity_base as "quantityBase", e.reason, e.disposal_method as "disposalMethod",
         u.display_name as "createdByName"
  from inventory_operation_events e
  join warehouses w on w.tenant_id = e.tenant_id and w.id = e.warehouse_id
  join inventory_batches b on b.tenant_id = e.tenant_id and b.id = e.batch_id
  join product_presentations pp on pp.tenant_id = b.tenant_id and pp.id = b.presentation_id
  join products p on p.tenant_id = pp.tenant_id and p.id = pp.product_id
  left join users u on u.id = e.created_by_user_id`;

interface WasteRow {
  id: string;
  actNumber: string | null;
  createdAt: Date;
  warehouseName: string;
  productName: string;
  presentationName: string;
  lotCode: string;
  expiresOn: string | Date;
  unitCost: string;
  quantityBase: string;
  reason: string;
  disposalMethod: string | null;
  createdByName: string | null;
}

function toWaste(row: WasteRow): WasteActSummary {
  return {
    id: row.id,
    actNumber: row.actNumber,
    createdAt: row.createdAt.toISOString(),
    warehouseName: row.warehouseName,
    productName: row.productName,
    presentationName: row.presentationName,
    lotCode: row.lotCode,
    expiresOn: dateOnly(row.expiresOn),
    quantityBase: Number(row.quantityBase),
    reason: row.reason,
    disposalMethod: row.disposalMethod,
    createdByName: row.createdByName
  };
}

/** Consultas de documentos de inventario: actas de baja y reservas de la sucursal. */
@Injectable()
export class InventoryRecordsService {
  constructor(@Inject(TenantDatabase) private readonly database: TenantDatabase) {}

  async listWasteActs(scope: TenantScope): Promise<{ items: WasteActSummary[] }> {
    return this.database.withScope(scope, async (client) => {
      const result = await client.query<WasteRow>(
        `${wasteSelect}
         where e.tenant_id = $1 and w.branch_id = $2 and e.operation_type = 'WASTE'
         order by e.created_at desc
         limit 200`,
        [scope.tenantId, scope.branchId]
      );
      return { items: result.rows.map(toWaste) };
    });
  }

  async getWasteAct(scope: TenantScope, id: string): Promise<WasteActDocument> {
    if (!uuidPattern.test(id)) {
      throw new NotFoundException("Acta de baja no encontrada.");
    }
    return this.database.withScope(scope, async (client) => {
      const result = await client.query<WasteRow>(
        `${wasteSelect}
         where e.tenant_id = $1 and w.branch_id = $2 and e.id = $3 and e.operation_type = 'WASTE'`,
        [scope.tenantId, scope.branchId, id]
      );
      const row = result.rows[0];
      if (!row) {
        throw new NotFoundException("Acta de baja no encontrada.");
      }
      const header = await client.query<{
        tenantName: string;
        legalName: string;
        taxId: string;
        branchCode: string;
        branchName: string;
      }>(
        `select t.name as "tenantName", le.legal_name as "legalName", le.tax_id as "taxId",
                br.code as "branchCode", br.name as "branchName"
         from branches br
         join tenants t on t.id = br.tenant_id
         join legal_entities le on le.tenant_id = br.tenant_id and le.id = br.legal_entity_id
         where br.tenant_id = $1 and br.id = $2`,
        [scope.tenantId, scope.branchId]
      );
      const info = header.rows[0]!;
      const quantity = Number(row.quantityBase);
      return {
        ...toWaste(row),
        ...info,
        unitCost: Number(row.unitCost).toFixed(2),
        totalCost: (Number(row.unitCost) * quantity).toFixed(2),
      };
    });
  }

  async listReservations(scope: TenantScope, status?: string): Promise<{ items: ReservationSummary[] }> {
    const filter = status && ["ACTIVE", "CONSUMED", "RELEASED", "EXPIRED"].includes(status) ? status : null;
    return this.database.withScope(scope, async (client) => {
      const result = await client.query<{
        id: string;
        status: ReservationSummary["status"];
        warehouseName: string;
        productName: string;
        presentationName: string;
        lotCode: string;
        expiresOn: string | Date;
        quantityBase: string;
        reservedUntil: Date;
        createdAt: Date;
      }>(
        `select r.id, r.status, w.name as "warehouseName", p.name as "productName",
                pp.name as "presentationName", b.lot_code as "lotCode", b.expires_on as "expiresOn",
                r.quantity_base as "quantityBase", r.expires_at as "reservedUntil", r.created_at as "createdAt"
         from inventory_reservations r
         join warehouses w on w.tenant_id = r.tenant_id and w.id = r.warehouse_id
         join inventory_batches b on b.tenant_id = r.tenant_id and b.id = r.batch_id
         join product_presentations pp on pp.tenant_id = b.tenant_id and pp.id = b.presentation_id
         join products p on p.tenant_id = pp.tenant_id and p.id = pp.product_id
         where r.tenant_id = $1 and w.branch_id = $2 and ($3::varchar is null or r.status = $3::varchar)
         order by (r.status = 'ACTIVE') desc, r.created_at desc
         limit 200`,
        [scope.tenantId, scope.branchId, filter]
      );
      return {
        items: result.rows.map((row) => ({
          id: row.id,
          status: row.status,
          warehouseName: row.warehouseName,
          productName: row.productName,
          presentationName: row.presentationName,
          lotCode: row.lotCode,
          expiresOn: dateOnly(row.expiresOn),
          quantityBase: Number(row.quantityBase),
          reservedUntil: row.reservedUntil.toISOString(),
          createdAt: row.createdAt.toISOString()
        }))
      };
    });
  }
}
