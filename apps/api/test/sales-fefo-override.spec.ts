import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PERMISSIONS_KEY } from "../src/auth/auth.decorators.js";
import { TenantDatabase, type TenantScope } from "../src/database/tenant-database.js";
import { systemRoles } from "../src/identity/role-templates.js";
import { SalesController } from "../src/sales/sales.controller.js";
import { SalesService } from "../src/sales/sales.service.js";

function withDatabaseName(connectionString: string, databaseName: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}
const testOwnerUrl =
  process.env.DATABASE_TEST_URL ??
  withDatabaseName(process.env.DATABASE_URL ?? "postgresql://farmaxia:local-development-only@localhost:5433/farmaxia", "farmaxia_test");
const testAppUrl =
  process.env.DATABASE_APP_TEST_URL ??
  withDatabaseName("postgresql://farmaxia_app:local-development-only@localhost:5433/farmaxia", "farmaxia_test");

const id = (n: number) => `00000000-0000-4000-8000-0000000072${String(n).padStart(2, "0")}`;
const tenantId = id(1);
const legalEntityId = id(2);
const branchId = id(3);
const cashierId = id(10);
const supervisorId = id(11);
const warehouseId = id(20);
const warehouse2Id = id(21);
const productId = id(30);
const presentationId = id(31);
const product2Id = id(32);
const presentation2Id = id(33);
const batchSoonId = id(40);
const batchLaterId = id(41);
const batchQuarantinedId = id(42);
const batchExpiredId = id(43);
const batchOtherWarehouseId = id(44);
const batchOtherProductId = id(45);
const registerId = id(50);
const shiftId = id(60);

const ownerPool = new Pool({ connectionString: testOwnerUrl });
const database = new TenantDatabase(testAppUrl);
const sales = new SalesService(database);
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

const cashierScope: TenantScope = { tenantId, userId: cashierId, branchId };
const supervisorScope: TenantScope = { tenantId, userId: supervisorId, branchId };
const viewAll = { viewAll: true };
const allowed = { canOverrideFefo: true };

let counter = 0;
const key = () => `fefo-${++counter}`;

function line(batchId?: string, quantity = 1) {
  return { presentationId, quantity, unitPriceBob: "12.5000", ...(batchId ? { batchId } : {}) };
}

function sale(
  lines: ReturnType<typeof line>[],
  extra: Record<string, unknown> = {},
  access?: { canOverrideFefo: boolean }
) {
  const total = (lines.reduce((sum, l) => sum + l.quantity, 0) * 12.5).toFixed(4);
  return sales.confirm(
    cashierScope,
    {
      idempotencyKey: key(),
      cashShiftId: shiftId,
      warehouseId,
      payments: [{ method: "CASH", amountBob: total }],
      lines,
      ...extra
    } as Parameters<SalesService["confirm"]>[1],
    access
  );
}

async function stock(): Promise<Record<string, number>> {
  const result = await ownerPool.query<{ lot: string; q: string }>(
    `select b.lot_code as lot, ib.quantity_base::text as q from inventory_balances ib
     join inventory_batches b on b.id = ib.batch_id where ib.warehouse_id = $1 order by b.lot_code`,
    [warehouseId]
  );
  return Object.fromEntries(result.rows.map((row) => [row.lot, Number(row.q)]));
}

describe("Module 5 T6 authorized FEFO lot override", () => {
  beforeAll(async () => {
    await migrate(drizzle(ownerPool), { migrationsFolder });
  });

  beforeEach(async () => {
    counter = 0;
    await ownerPool.query("truncate table tenants, users cascade");
    await ownerPool.query("insert into tenants (id, slug, name) values ($1, 'fefo-pharmacy', 'Farmacia Lotes')", [tenantId]);
    await ownerPool.query(
      "insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, 'Lotes SRL', '7000801')",
      [legalEntityId, tenantId]
    );
    await ownerPool.query(
      "insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, 'MAIN', 'Central')",
      [branchId, tenantId, legalEntityId]
    );
    await ownerPool.query(
      `insert into users (id, email, display_name, password_hash)
       values ($1, 'fefo1@example.test', 'Cajero', 'x'), ($2, 'fefo2@example.test', 'Supervisor', 'x')`,
      [cashierId, supervisorId]
    );
    await ownerPool.query(
      "insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $3, $4), ($2, $3, $4)",
      [cashierId, supervisorId, tenantId, branchId]
    );
    await ownerPool.query(
      `insert into warehouses (id, tenant_id, branch_id, name, warehouse_type)
       values ($1, $3, $4, 'Central', 'CENTRAL'), ($2, $3, $4, 'Anexo', 'CENTRAL')`,
      [warehouseId, warehouse2Id, tenantId, branchId]
    );
    await ownerPool.query(
      "insert into products (id, tenant_id, name) values ($1, $3, 'Paracetamol 500 mg'), ($2, $3, 'Ibuprofeno 400 mg')",
      [productId, product2Id, tenantId]
    );
    await ownerPool.query(
      `insert into product_presentations (id, tenant_id, product_id, name, base_unit_factor)
       values ($1, $3, $4, 'Caja x 10', 10), ($2, $3, $5, 'Caja x 10', 10)`,
      [presentationId, presentation2Id, tenantId, productId, product2Id]
    );
    await ownerPool.query("insert into price_lists (id, tenant_id, name, currency) values ($1, $2, 'General', 'BOB')", [id(90), tenantId]);
    await ownerPool.query(
      `insert into presentation_prices (tenant_id, price_list_id, presentation_id, amount, valid_from)
       values ($1, $2, $3, 12.5000, now() - interval '1 day'), ($1, $2, $4, 12.5000, now() - interval '1 day')`,
      [tenantId, id(90), presentationId, presentation2Id]
    );
    await ownerPool.query(
      `insert into inventory_batches (id, tenant_id, presentation_id, lot_code, expires_on, unit_cost, status) values
         ($1, $7, $8, 'LOT-SOON', current_date + 60, 5, 'AVAILABLE'),
         ($2, $7, $8, 'LOT-LATER', current_date + 400, 5, 'AVAILABLE'),
         ($3, $7, $8, 'LOT-QUAR', current_date + 100, 5, 'QUARANTINED'),
         ($4, $7, $8, 'LOT-OLD', current_date - 1, 5, 'AVAILABLE'),
         ($5, $7, $8, 'LOT-ANNEX', current_date + 90, 5, 'AVAILABLE'),
         ($6, $7, $9, 'LOT-OTHERP', current_date + 90, 5, 'AVAILABLE')`,
      [batchSoonId, batchLaterId, batchQuarantinedId, batchExpiredId, batchOtherWarehouseId, batchOtherProductId, tenantId, presentationId, presentation2Id]
    );
    await ownerPool.query(
      `insert into inventory_balances (tenant_id, warehouse_id, batch_id, quantity_base, reserved_base) values
         ($1, $2, $3, 20, 0), ($1, $2, $4, 50, 0), ($1, $2, $5, 50, 0), ($1, $2, $6, 50, 0),
         ($1, $7, $8, 50, 0), ($1, $2, $9, 50, 0)`,
      [tenantId, warehouseId, batchSoonId, batchLaterId, batchQuarantinedId, batchExpiredId, warehouse2Id, batchOtherWarehouseId, batchOtherProductId]
    );
    await ownerPool.query(
      "insert into cash_registers (id, tenant_id, branch_id, code, is_active) values ($1, $2, $3, 'CAJA-1', true)",
      [registerId, tenantId, branchId]
    );
    await ownerPool.query(
      `insert into cash_shifts (id, tenant_id, branch_id, cash_register_id, scheduled_start_at, scheduled_end_at, status, created_by_user_id)
       values ($1, $2, $3, $4, now() - interval '1 hour', now() + interval '8 hours', 'SCHEDULED', $5)`,
      [shiftId, tenantId, branchId, registerId, cashierId]
    );
    await ownerPool.query(
      "insert into cash_shift_users (tenant_id, branch_id, cash_shift_id, user_id) values ($1, $2, $3, $4)",
      [tenantId, branchId, shiftId, cashierId]
    );
    await ownerPool.query(
      `insert into cash_shift_controls (tenant_id, branch_id, cash_shift_id, opening_amount_bob, expected_amount_bob, status, opened_by_user_id, opened_at)
       values ($1, $2, $3, '100.0000', '100.0000', 'OPEN', $4, now())`,
      [tenantId, branchId, shiftId, cashierId]
    );
  });

  afterAll(async () => {
    await database.close();
    await ownerPool.end();
  });

  it("consumes the chosen batch instead of FEFO and marks the line as overridden", async () => {
    const confirmed = await sale([line(batchLaterId, 2)], { overrideReason: "  Cliente pide lote mas largo " }, allowed);
    expect(await stock()).toMatchObject({ "LOT-LATER": 30, "LOT-SOON": 20 });
    expect(confirmed.items[0]).toMatchObject({ fefoOverride: true, fefoOverrideReason: "Cliente pide lote mas largo" });
    expect(confirmed.items[0]!.allocations).toEqual([
      expect.objectContaining({ batchId: batchLaterId, lotCode: "LOT-LATER", quantityBase: 20 })
    ]);
    const rows = await ownerPool.query(
      `select i.fefo_override, i.fefo_override_reason, a.fefo_override as a_override
       from sale_items i join sale_allocations a on a.sale_item_id = i.id`
    );
    expect(rows.rows).toEqual([{ fefo_override: true, fefo_override_reason: "Cliente pide lote mas largo", a_override: true }]);
    const detail = await sales.detail(cashierScope, confirmed.id, viewAll);
    expect(detail.items[0]).toMatchObject({ fefoOverride: true, fefoOverrideReason: "Cliente pide lote mas largo" });
    expect(detail.items[0]!.allocations[0]).toMatchObject({ lotCode: "LOT-LATER", fefoOverride: true });
  });

  it("leaves lines without batchId on plain FEFO and not marked", async () => {
    const confirmed = await sale([line(undefined, 1)]);
    expect(await stock()).toMatchObject({ "LOT-SOON": 10, "LOT-LATER": 50 });
    expect(confirmed.items[0]).toMatchObject({ fefoOverride: false, fefoOverrideReason: null });
  });

  it("rejects an override without the permission (403 FEFO_OVERRIDE_FORBIDDEN) and moves no stock", async () => {
    for (const access of [undefined, { canOverrideFefo: false }]) {
      await expect(sale([line(batchLaterId)], { overrideReason: "x" }, access)).rejects.toMatchObject({
        status: 403,
        response: expect.objectContaining({ code: "FEFO_OVERRIDE_FORBIDDEN" })
      });
    }
    expect(await stock()).toMatchObject({ "LOT-LATER": 50, "LOT-SOON": 20 });
  });

  it("requires a reason of at most 200 characters when a line chooses a batch", async () => {
    await expect(sale([line(batchLaterId)], {}, allowed)).rejects.toThrow(/override reason/i);
    await expect(sale([line(batchLaterId)], { overrideReason: "   " }, allowed)).rejects.toThrow(/override reason/i);
    await expect(sale([line(batchLaterId)], { overrideReason: "x".repeat(201) }, allowed)).rejects.toThrow(/override reason/i);
    expect(await stock()).toMatchObject({ "LOT-LATER": 50 });
  });

  it("rejects quarantined, expired, other-warehouse, other-product and unknown batches with 409 codes", async () => {
    const cases: Array<[string, string]> = [
      [batchQuarantinedId, "FEFO_BATCH_UNAVAILABLE"],
      [batchExpiredId, "FEFO_BATCH_UNAVAILABLE"],
      [batchOtherWarehouseId, "FEFO_BATCH_NOT_FOUND"],
      [batchOtherProductId, "FEFO_BATCH_MISMATCH"],
      ["00000000-0000-4000-8000-00000000ffff", "FEFO_BATCH_NOT_FOUND"]
    ];
    for (const [batchId, code] of cases) {
      await expect(sale([line(batchId)], { overrideReason: "motivo" }, allowed)).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({ code })
      });
    }
    expect(await stock()).toMatchObject({ "LOT-SOON": 20, "LOT-LATER": 50, "LOT-QUAR": 50, "LOT-OLD": 50 });
  });

  it("rejects a chosen batch without enough unreserved stock", async () => {
    await expect(sale([line(batchSoonId, 3)], { overrideReason: "motivo" }, allowed)).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: "FEFO_BATCH_INSUFFICIENT" })
    });
    await ownerPool.query("update inventory_balances set reserved_base = 45 where batch_id = $1", [batchLaterId]);
    await expect(sale([line(batchLaterId, 1)], { overrideReason: "motivo" }, allowed)).rejects.toMatchObject({
      response: expect.objectContaining({ code: "FEFO_BATCH_INSUFFICIENT" })
    });
    expect(await stock()).toMatchObject({ "LOT-SOON": 20, "LOT-LATER": 50 });
  });

  it("records a sales.fefo_override audit event with the chosen and the FEFO batch", async () => {
    const confirmed = await sale([line(batchLaterId, 1)], { overrideReason: "Pedido del medico" }, allowed);
    const audit = await ownerPool.query("select entity_id, payload from audit_events where action = 'sales.fefo_override'");
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].entity_id).toBe(confirmed.id);
    expect(audit.rows[0].payload).toMatchObject({
      presentationId,
      chosenBatchId: batchLaterId,
      fefoBatchId: batchSoonId,
      reason: "Pedido del medico"
    });
    await sale([line(undefined, 1)]);
    expect((await ownerPool.query("select 1 from audit_events where action = 'sales.fefo_override'")).rowCount).toBe(1);
  });

  it("voiding an overridden sale restores the chosen batch, not the FEFO one", async () => {
    const confirmed = await sale([line(batchLaterId, 2)], { overrideReason: "motivo" }, allowed);
    expect(await stock()).toMatchObject({ "LOT-LATER": 30, "LOT-SOON": 20 });
    await sales.voidSale(supervisorScope, confirmed.id, { idempotencyKey: key(), reason: "error" }, viewAll);
    expect(await stock()).toMatchObject({ "LOT-LATER": 50, "LOT-SOON": 20 });
  });

  it("replays idempotently and hashes batchId and reason into the request", async () => {
    const input = {
      idempotencyKey: "fefo-replay",
      cashShiftId: shiftId,
      warehouseId,
      payments: [{ method: "CASH", amountBob: "12.5000" }],
      lines: [line(batchLaterId, 1)],
      overrideReason: "motivo"
    } as Parameters<SalesService["confirm"]>[1];
    const first = await sales.confirm(cashierScope, input, allowed);
    const replay = await sales.confirm(cashierScope, input, allowed);
    expect(replay.id).toBe(first.id);
    expect(await stock()).toMatchObject({ "LOT-LATER": 40 });
    await expect(
      sales.confirm(cashierScope, { ...input, overrideReason: "otro motivo" } as typeof input, allowed)
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: expect.stringMatching(/IDEMPOTENCY/i) }) });
    await expect(
      sales.confirm(cashierScope, { ...input, lines: [line(batchSoonId, 1)] } as typeof input, allowed)
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: expect.stringMatching(/IDEMPOTENCY/i) }) });
  });

  it("lists the available batches of a presentation in FEFO order with the suggestion flagged", async () => {
    const result = await sales.listBatches(supervisorScope, { presentationId, warehouseId });
    expect(result.items.map((item) => item.lotCode)).toEqual(["LOT-SOON", "LOT-LATER"]);
    expect(result.items[0]).toMatchObject({ batchId: batchSoonId, availableBase: 20, fefoSuggested: true });
    expect(result.items[1]).toMatchObject({ availableBase: 50, fefoSuggested: false });
    await expect(sales.listBatches(supervisorScope, { presentationId: "bad", warehouseId })).rejects.toThrow();
  });

  it("protects the batch listing and grants sales.fefo.override to owner, regente and encargado only", () => {
    const perms = Reflect.getMetadata(PERMISSIONS_KEY, SalesController.prototype.batches as object) as string[];
    expect(perms).toEqual(["sales.fefo.override"]);
    const holders = systemRoles
      .filter((role) => (role.permissions as readonly string[]).includes("sales.fefo.override"))
      .map((role) => role.code)
      .sort();
    expect(holders).toEqual(["encargado", "owner", "regente"]);
  });
});
