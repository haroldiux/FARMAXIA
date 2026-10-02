import { ConflictException, NotFoundException } from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TenantDatabase, type TenantScope } from "../src/database/tenant-database.js";
import { TransfersService } from "../src/transfers/transfers.service.js";

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

// Tenant A: PROFESIONAL plan (no `transfers.approval` feature) — dispatch goes straight from
// REQUESTED to DISPATCHED. Main subject for the happy-path/status-machine/idempotency tests.
const tenantId = "00000000-0000-4000-8000-000000007001";
const legalEntityId = "00000000-0000-4000-8000-000000007002";
const branchOriginId = "00000000-0000-4000-8000-000000007011";
const branchDestinationId = "00000000-0000-4000-8000-000000007012";
const userId = "00000000-0000-4000-8000-000000007021";
const productId = "00000000-0000-4000-8000-000000007041";
const presentationId = "00000000-0000-4000-8000-000000007042";
const batchId = "00000000-0000-4000-8000-000000007051";
const originWarehouseId = "00000000-0000-4000-8000-000000007031";
const destinationWarehouseId = "00000000-0000-4000-8000-000000007032";
const quarantineWarehouseId = "00000000-0000-4000-8000-000000007033";

// Tenant B: PREMIUM plan (has `transfers.approval`) — used for the approval-gating test and as the
// "other tenant" for the RLS isolation test.
const otherTenantId = "00000000-0000-4000-8000-000000007101";
const otherLegalEntityId = "00000000-0000-4000-8000-000000007102";
const otherBranchId = "00000000-0000-4000-8000-000000007111";
const otherUserId = "00000000-0000-4000-8000-000000007121";
const otherProductId = "00000000-0000-4000-8000-000000007141";
const otherPresentationId = "00000000-0000-4000-8000-000000007142";
const otherBatchId = "00000000-0000-4000-8000-000000007151";
const otherOriginWarehouseId = "00000000-0000-4000-8000-000000007131";
const otherDestinationWarehouseId = "00000000-0000-4000-8000-000000007132";

// `transfers.manage` is also what grants cross-branch warehouse visibility (see
// `warehouses_transfers_select` in 0027_transfers.sql), so both test users need a role carrying it.
const roleId = "00000000-0000-4000-8000-000000007091";
const otherRoleId = "00000000-0000-4000-8000-000000007191";

const ownerPool = new Pool({ connectionString: testOwnerUrl });
const database = new TenantDatabase(testAppUrl);
const transfers = new TransfersService(database);
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

const scope: TenantScope = { tenantId, userId, branchId: branchOriginId };
const otherScope: TenantScope = { tenantId: otherTenantId, userId: otherUserId, branchId: otherBranchId };

async function planId(code: string): Promise<string> {
  const result = await ownerPool.query<{ id: string }>("select id from subscription_plans where code = $1", [code]);
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error(`Plan ${code} must be seeded.`);
  }
  return id;
}

async function balanceOf(warehouseId: string, batch: string): Promise<number> {
  const result = await ownerPool.query<{ quantityBase: string }>(
    `select quantity_base as "quantityBase" from inventory_balances where warehouse_id = $1 and batch_id = $2`,
    [warehouseId, batch]
  );
  return result.rows[0] ? Number(result.rows[0].quantityBase) : 0;
}

async function movements(warehouseId: string, batch: string, movementType: string): Promise<number> {
  const result = await ownerPool.query<{ total: string }>(
    `select count(*)::text as total from inventory_movements where warehouse_id = $1 and batch_id = $2 and movement_type = $3`,
    [warehouseId, batch, movementType]
  );
  return Number(result.rows[0]?.total ?? "0");
}

describe("F14 module 7: branch-to-branch transfers (T1)", () => {
  beforeAll(async () => {
    await migrate(drizzle(ownerPool), { migrationsFolder });
  });

  beforeEach(async () => {
    await ownerPool.query("truncate table tenants, users cascade");
    // Defensive: some other spec files truncate the global `permissions` catalog in their own
    // beforeEach (e.g. cash-movements.spec.ts) without reseeding every code. Re-assert ours here
    // (idempotent) so this file's role_permissions inserts never depend on suite run order.
    await ownerPool.query(
      `insert into permissions (code, description, label, module, sort_order) values
         ('transfers.manage', 'Request, dispatch and receive branch-to-branch transfers', 'Solicitar, despachar y recibir traspasos', 'Traspasos', 36),
         ('transfers.approve', 'Approve branch-to-branch transfer requests before dispatch', 'Aprobar traspasos antes del despacho', 'Traspasos', 37)
       on conflict (code) do nothing`
    );

    // Tenant A — PROFESIONAL (transfers enabled, transfers.approval NOT enabled).
    await ownerPool.query("insert into tenants (id, slug, name) values ($1, 'transfers-pharmacy', 'Farmacia Traspasos')", [tenantId]);
    await ownerPool.query("insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, 'Farmacia Traspasos SRL', '7000701')", [
      legalEntityId,
      tenantId
    ]);
    await ownerPool.query("insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, 'ORIGEN', 'Sucursal Origen')", [
      branchOriginId,
      tenantId,
      legalEntityId
    ]);
    await ownerPool.query("insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, 'DESTINO', 'Sucursal Destino')", [
      branchDestinationId,
      tenantId,
      legalEntityId
    ]);
    await ownerPool.query("insert into users (id, email, display_name, password_hash) values ($1, 'traspasos@example.test', 'Almacenero', 'x')", [
      userId
    ]);
    await ownerPool.query("insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $2, $3)", [
      userId,
      tenantId,
      branchOriginId
    ]);
    await ownerPool.query("insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $2, $3)", [
      userId,
      tenantId,
      branchDestinationId
    ]);
    await ownerPool.query(
      "insert into warehouses (id, tenant_id, branch_id, name, warehouse_type) values ($1, $2, $3, 'Central Origen', 'GENERAL')",
      [originWarehouseId, tenantId, branchOriginId]
    );
    await ownerPool.query(
      "insert into warehouses (id, tenant_id, branch_id, name, warehouse_type) values ($1, $2, $3, 'Central Destino', 'GENERAL')",
      [destinationWarehouseId, tenantId, branchDestinationId]
    );
    await ownerPool.query(
      "insert into warehouses (id, tenant_id, branch_id, name, warehouse_type, is_dispatch_enabled) values ($1, $2, $3, 'Cuarentena', 'QUARANTINE', false)",
      [quarantineWarehouseId, tenantId, branchOriginId]
    );
    await ownerPool.query("insert into products (id, tenant_id, name) values ($1, $2, 'Amoxicilina 500 mg')", [productId, tenantId]);
    await ownerPool.query(
      "insert into product_presentations (id, tenant_id, product_id, name, base_unit_factor) values ($1, $2, $3, 'Caja x 10', 10)",
      [presentationId, tenantId, productId]
    );
    await ownerPool.query(
      "insert into inventory_batches (id, tenant_id, presentation_id, lot_code, expires_on, unit_cost) values ($1, $2, $3, 'LOT-T14', current_date + 180, 8.0000)",
      [batchId, tenantId, presentationId]
    );
    await ownerPool.query(
      "insert into inventory_balances (tenant_id, warehouse_id, batch_id, quantity_base, reserved_base) values ($1, $2, $3, 50, 0)",
      [tenantId, originWarehouseId, batchId]
    );
    const profesionalPlanId = await planId("PROFESIONAL");
    await ownerPool.query(
      "insert into tenant_subscriptions (tenant_id, plan_id, status, starts_at) values ($1, $2, 'ACTIVE', now())",
      [tenantId, profesionalPlanId]
    );
    await ownerPool.query("insert into roles (id, tenant_id, code) values ($1, $2, 'almacenero')", [roleId, tenantId]);
    await ownerPool.query("insert into role_permissions (role_id, permission_code) values ($1, 'transfers.manage'), ($1, 'transfers.approve')", [
      roleId
    ]);
    await ownerPool.query("insert into user_roles (user_id, tenant_id, role_id) values ($1, $2, $3)", [userId, tenantId, roleId]);

    // Tenant B — PREMIUM (transfers.approval enabled).
    await ownerPool.query("insert into tenants (id, slug, name) values ($1, 'transfers-premium', 'Farmacia Premium')", [otherTenantId]);
    await ownerPool.query(
      "insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, 'Farmacia Premium SRL', '7000711')",
      [otherLegalEntityId, otherTenantId]
    );
    await ownerPool.query("insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, 'MAIN', 'Central')", [
      otherBranchId,
      otherTenantId,
      otherLegalEntityId
    ]);
    await ownerPool.query("insert into users (id, email, display_name, password_hash) values ($1, 'premium@example.test', 'Encargado', 'x')", [
      otherUserId
    ]);
    await ownerPool.query("insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $2, $3)", [
      otherUserId,
      otherTenantId,
      otherBranchId
    ]);
    await ownerPool.query(
      "insert into warehouses (id, tenant_id, branch_id, name, warehouse_type) values ($1, $2, $3, 'Origen Premium', 'GENERAL')",
      [otherOriginWarehouseId, otherTenantId, otherBranchId]
    );
    await ownerPool.query(
      "insert into warehouses (id, tenant_id, branch_id, name, warehouse_type) values ($1, $2, $3, 'Destino Premium', 'GENERAL')",
      [otherDestinationWarehouseId, otherTenantId, otherBranchId]
    );
    await ownerPool.query("insert into products (id, tenant_id, name) values ($1, $2, 'Ibuprofeno 400 mg')", [otherProductId, otherTenantId]);
    await ownerPool.query(
      "insert into product_presentations (id, tenant_id, product_id, name, base_unit_factor) values ($1, $2, $3, 'Caja x 20', 20)",
      [otherPresentationId, otherTenantId, otherProductId]
    );
    await ownerPool.query(
      "insert into inventory_batches (id, tenant_id, presentation_id, lot_code, expires_on, unit_cost) values ($1, $2, $3, 'LOT-PREMIUM', current_date + 180, 5.0000)",
      [otherBatchId, otherTenantId, otherPresentationId]
    );
    await ownerPool.query(
      "insert into inventory_balances (tenant_id, warehouse_id, batch_id, quantity_base, reserved_base) values ($1, $2, $3, 30, 0)",
      [otherTenantId, otherOriginWarehouseId, otherBatchId]
    );
    const premiumPlanId = await planId("PREMIUM");
    await ownerPool.query(
      "insert into tenant_subscriptions (tenant_id, plan_id, status, starts_at) values ($1, $2, 'ACTIVE', now())",
      [otherTenantId, premiumPlanId]
    );
    await ownerPool.query("insert into roles (id, tenant_id, code) values ($1, $2, 'encargado')", [otherRoleId, otherTenantId]);
    await ownerPool.query(
      "insert into role_permissions (role_id, permission_code) values ($1, 'transfers.manage'), ($1, 'transfers.approve')",
      [otherRoleId]
    );
    await ownerPool.query("insert into user_roles (user_id, tenant_id, role_id) values ($1, $2, $3)", [
      otherUserId,
      otherTenantId,
      otherRoleId
    ]);
  });

  afterAll(async () => {
    await database.close();
    await ownerPool.end();
  });

  it("creates a REQUESTED transfer with its items", async () => {
    const detail = await transfers.requestTransfer(scope, {
      idempotencyKey: "req-001",
      originWarehouseId,
      destinationWarehouseId,
      items: [{ presentationId, batchId, requestedQty: 10 }]
    });

    expect(detail.status).toBe("REQUESTED");
    expect(detail.originWarehouseId).toBe(originWarehouseId);
    expect(detail.destinationWarehouseId).toBe(destinationWarehouseId);
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0]).toMatchObject({ requestedQty: 10, dispatchedQty: null, receivedQty: 0 });
  });

  it("rejects a request where origin equals destination", async () => {
    await expect(
      transfers.requestTransfer(scope, {
        idempotencyKey: "req-002",
        originWarehouseId,
        destinationWarehouseId: originWarehouseId,
        items: [{ presentationId, batchId, requestedQty: 5 }]
      })
    ).rejects.toThrow(/distintos/);
  });

  it("rejects a request to dispatch from a QUARANTINE warehouse", async () => {
    await expect(
      transfers.requestTransfer(scope, {
        idempotencyKey: "req-003",
        originWarehouseId: quarantineWarehouseId,
        destinationWarehouseId,
        items: [{ presentationId, batchId, requestedQty: 5 }]
      })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("dispatches directly from REQUESTED on a plan without transfers.approval (PROFESIONAL), decrements origin balance and writes a TRANSFER_OUT movement", async () => {
    const created = await transfers.requestTransfer(scope, {
      idempotencyKey: "req-004",
      originWarehouseId,
      destinationWarehouseId,
      items: [{ presentationId, batchId, requestedQty: 20 }]
    });

    const dispatched = await transfers.dispatchTransfer(scope, created.id, { idempotencyKey: "dis-004" });

    expect(dispatched.status).toBe("DISPATCHED");
    expect(dispatched.items[0]).toMatchObject({ dispatchedQty: 20 });
    expect(await balanceOf(originWarehouseId, batchId)).toBe(30);
    expect(await movements(originWarehouseId, batchId, "TRANSFER_OUT")).toBe(1);
  });

  it("never lets the origin balance go negative: dispatch fails when stock is insufficient", async () => {
    const created = await transfers.requestTransfer(scope, {
      idempotencyKey: "req-005",
      originWarehouseId,
      destinationWarehouseId,
      items: [{ presentationId, batchId, requestedQty: 999 }]
    });

    await expect(transfers.dispatchTransfer(scope, created.id, { idempotencyKey: "dis-005" })).rejects.toBeInstanceOf(
      ConflictException
    );
    expect(await balanceOf(originWarehouseId, batchId)).toBe(50);
  });

  it("is idempotent on dispatch: repeating the same idempotency key does not double-decrement or double-insert the movement", async () => {
    const created = await transfers.requestTransfer(scope, {
      idempotencyKey: "req-006",
      originWarehouseId,
      destinationWarehouseId,
      items: [{ presentationId, batchId, requestedQty: 15 }]
    });

    await transfers.dispatchTransfer(scope, created.id, { idempotencyKey: "dis-006" });
    await transfers.dispatchTransfer(scope, created.id, { idempotencyKey: "dis-006" });

    expect(await balanceOf(originWarehouseId, batchId)).toBe(35);
    expect(await movements(originWarehouseId, batchId, "TRANSFER_OUT")).toBe(1);
  });

  it("leaves PARTIALLY_RECEIVED when less than dispatched is received, and RECEIVED only once everything is received (D54)", async () => {
    const created = await transfers.requestTransfer(scope, {
      idempotencyKey: "req-007",
      originWarehouseId,
      destinationWarehouseId,
      items: [{ presentationId, batchId, requestedQty: 20 }]
    });
    const dispatched = await transfers.dispatchTransfer(scope, created.id, { idempotencyKey: "dis-007" });
    const itemId = dispatched.items[0]!.id;

    const partial = await transfers.receiveTransfer(
      { ...scope, branchId: branchDestinationId },
      created.id,
      { idempotencyKey: "rec-007a", items: [{ itemId, receivedQty: 12 }] }
    );
    expect(partial.status).toBe("PARTIALLY_RECEIVED");
    expect(partial.items[0]).toMatchObject({ receivedQty: 12, dispatchedQty: 20 });
    expect(await balanceOf(destinationWarehouseId, batchId)).toBe(12);
    expect(await movements(destinationWarehouseId, batchId, "TRANSFER_IN")).toBe(1);

    const complete = await transfers.receiveTransfer(
      { ...scope, branchId: branchDestinationId },
      created.id,
      { idempotencyKey: "rec-007b", items: [{ itemId, receivedQty: 8, differenceReason: "Caja dañada en tránsito" }] }
    );
    expect(complete.status).toBe("RECEIVED");
    expect(complete.items[0]).toMatchObject({ receivedQty: 20, dispatchedQty: 20, differenceReason: "Caja dañada en tránsito" });
    expect(await balanceOf(destinationWarehouseId, batchId)).toBe(20);
    expect(await movements(destinationWarehouseId, batchId, "TRANSFER_IN")).toBe(2);
  });

  it("is idempotent on receive: repeating the same idempotency key does not double-credit the destination", async () => {
    const created = await transfers.requestTransfer(scope, {
      idempotencyKey: "req-008",
      originWarehouseId,
      destinationWarehouseId,
      items: [{ presentationId, batchId, requestedQty: 10 }]
    });
    const dispatched = await transfers.dispatchTransfer(scope, created.id, { idempotencyKey: "dis-008" });
    const itemId = dispatched.items[0]!.id;

    const destinationScope = { ...scope, branchId: branchDestinationId };
    await transfers.receiveTransfer(destinationScope, created.id, { idempotencyKey: "rec-008", items: [{ itemId, receivedQty: 10 }] });
    await transfers.receiveTransfer(destinationScope, created.id, { idempotencyKey: "rec-008", items: [{ itemId, receivedQty: 10 }] });

    expect(await balanceOf(destinationWarehouseId, batchId)).toBe(10);
    expect(await movements(destinationWarehouseId, batchId, "TRANSFER_IN")).toBe(1);
  });

  it("is visible from both the origin and the destination branch", async () => {
    const created = await transfers.requestTransfer(scope, {
      idempotencyKey: "req-009",
      originWarehouseId,
      destinationWarehouseId,
      items: [{ presentationId, batchId, requestedQty: 5 }]
    });

    const fromDestination = await transfers.detail({ ...scope, branchId: branchDestinationId }, created.id);
    expect(fromDestination.id).toBe(created.id);
  });

  it("isolates tenants via RLS: another tenant cannot read or act on this transfer", async () => {
    const created = await transfers.requestTransfer(scope, {
      idempotencyKey: "req-010",
      originWarehouseId,
      destinationWarehouseId,
      items: [{ presentationId, batchId, requestedQty: 5 }]
    });

    await expect(transfers.detail(otherScope, created.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      transfers.dispatchTransfer(otherScope, created.id, { idempotencyKey: "dis-010-cross-tenant" })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("T3: listWarehouseOptions lists all tenant warehouses across branches, with branchName null for a branch outside the caller's own RLS visibility", async () => {
    const result = await transfers.listWarehouseOptions(scope);

    const ids = result.items.map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining([originWarehouseId, destinationWarehouseId, quarantineWarehouseId]));

    const origin = result.items.find((item) => item.id === originWarehouseId);
    expect(origin).toMatchObject({ branchId: branchOriginId, branchName: "Sucursal Origen" });

    // Destination warehouse belongs to a branch other than the caller's current branch
    // (branchOriginId): branches_branch_isolation (0003) hides that branches row, so the LEFT JOIN
    // leaves branchName null rather than dropping the warehouse row entirely.
    const destination = result.items.find((item) => item.id === destinationWarehouseId);
    expect(destination).toMatchObject({ branchId: branchDestinationId, branchName: null });
  });

  it("T3: listWarehouseOptions is tenant-isolated via RLS", async () => {
    const result = await transfers.listWarehouseOptions(scope);
    expect(result.items.some((item) => item.id === otherOriginWarehouseId)).toBe(false);
  });

  it("T3: lookupStock returns positive available stock at the origin warehouse, excluding reserved quantity", async () => {
    // A second batch at the same warehouse fully reserved by a (simulated) FEFO sales hold must be
    // excluded: available = quantity_base - reserved_base, and this one is 0.
    const reservedBatchId = "00000000-0000-4000-8000-000000007052";
    await ownerPool.query(
      "insert into inventory_batches (id, tenant_id, presentation_id, lot_code, expires_on, unit_cost) values ($1, $2, $3, 'LOT-RESERVED', current_date + 90, 3.0000)",
      [reservedBatchId, tenantId, presentationId]
    );
    await ownerPool.query(
      "insert into inventory_balances (tenant_id, warehouse_id, batch_id, quantity_base, reserved_base) values ($1, $2, $3, 10, 10)",
      [tenantId, originWarehouseId, reservedBatchId]
    );

    const result = await transfers.lookupStock(scope, originWarehouseId);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      presentationId,
      batchId,
      lotCode: "LOT-T14",
      availableQty: 50
    });
    expect(result.items.some((item) => item.batchId === reservedBatchId)).toBe(false);
  });

  it("T3: lookupStock is tenant-isolated via RLS: another tenant's warehouse is not found", async () => {
    await expect(transfers.lookupStock(otherScope, originWarehouseId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("D53: on a PREMIUM plan (transfers.approval enabled), dispatch is rejected until the transfer is APPROVED", async () => {
    const created = await transfers.requestTransfer(otherScope, {
      idempotencyKey: "req-011",
      originWarehouseId: otherOriginWarehouseId,
      destinationWarehouseId: otherDestinationWarehouseId,
      items: [{ presentationId: otherPresentationId, batchId: otherBatchId, requestedQty: 5 }]
    });

    await expect(
      transfers.dispatchTransfer(otherScope, created.id, { idempotencyKey: "dis-011a" })
    ).rejects.toBeInstanceOf(ConflictException);

    // T2 (approve endpoint) is not implemented yet; simulate the approval it would perform.
    await ownerPool.query("update transfers set status = 'APPROVED' where tenant_id = $1 and id = $2", [otherTenantId, created.id]);

    const dispatched = await transfers.dispatchTransfer(otherScope, created.id, { idempotencyKey: "dis-011b" });
    expect(dispatched.status).toBe("DISPATCHED");
  });
});
