import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CashController } from "../src/cash/cash.controller.js";
import { CashService } from "../src/cash/cash.service.js";
import { TenantDatabase, type TenantScope } from "../src/database/tenant-database.js";
import { IdempotencyKeyReusedError } from "../src/transversal/idempotency.service.js";

const developmentDatabaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://farmaxia:local-development-only@localhost:5433/farmaxia";
const developmentAppDatabaseUrl =
  process.env.DATABASE_APP_URL ??
  "postgresql://farmaxia_app:local-development-only@localhost:5433/farmaxia";

function withDatabaseName(connectionString: string, databaseName: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

const testDatabaseUrl =
  process.env.DATABASE_TEST_URL ?? withDatabaseName(developmentDatabaseUrl, "farmaxia_test");
const testAppDatabaseUrl =
  process.env.DATABASE_APP_TEST_URL ??
  withDatabaseName(developmentAppDatabaseUrl, "farmaxia_test");

const tenantId = "00000000-0000-4000-8000-000000000701";
const legalEntityId = "00000000-0000-4000-8000-000000000702";
const branchId = "00000000-0000-4000-8000-000000000703";
const otherBranchId = "00000000-0000-4000-8000-000000000704";
const actorId = "00000000-0000-4000-8000-000000000705";
const secondUserId = "00000000-0000-4000-8000-000000000706";
const otherBranchUserId = "00000000-0000-4000-8000-000000000707";
const inactiveUserId = "00000000-0000-4000-8000-000000000708";
const supervisorId = "00000000-0000-4000-8000-000000000712";
const supervisorRoleId = "00000000-0000-4000-8000-000000000713";
const registerId = "00000000-0000-4000-8000-000000000709";
const secondRegisterId = "00000000-0000-4000-8000-000000000710";
const otherBranchRegisterId = "00000000-0000-4000-8000-000000000711";

const scope: TenantScope = { tenantId, branchId, userId: actorId };
const secondScope: TenantScope = { tenantId, branchId, userId: secondUserId };
const supervisorScope: TenantScope = { tenantId, branchId, userId: supervisorId };
const otherScope: TenantScope = { tenantId, branchId: otherBranchId, userId: actorId };
const ownerPool = new Pool({ connectionString: testDatabaseUrl });
const database = new TenantDatabase(testAppDatabaseUrl);
const cash = new CashService(database);
const controller = new CashController(cash);
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

describe("configurable cash shifts (F6-WEB)", () => {
  beforeAll(async () => {
    await migrate(drizzle(ownerPool), { migrationsFolder });
  });

  beforeEach(async () => {
    await ownerPool.query(`
      truncate table
        cash_shift_controls,
        cash_shift_users,
        cash_shifts,
        inventory_reconciliations,
        inventory_reservations,
        inventory_operation_events,
        payables,
        supplier_invoices,
        inventory_movements,
        inventory_balances,
        goods_receipt_items,
        goods_receipts,
        inventory_batches,
        purchase_order_items,
        purchase_orders,
        suppliers,
        product_homologations,
        presentation_prices,
        product_barcodes,
        price_lists,
        product_presentations,
        products,
        product_categories,
        audit_events,
        idempotency_records,
        outbox_events,
        document_sequences,
        subscription_quota_overrides,
        tenant_resource_usage,
        tenant_subscriptions,
        background_jobs,
        tenant_files,
        auth_sessions,
        user_roles,
        role_permissions,
        permissions,
        roles,
        user_branch_memberships,
        cash_registers,
        warehouses,
        branches,
        legal_entities,
        users,
        tenants
    `);
    await ownerPool.query("insert into tenants (id, slug, name) values ($1, $2, $3)", [
      tenantId,
      "cash-tenant",
      "Cash tenant"
    ]);
    await ownerPool.query(
      "insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, $3, $4)",
      [legalEntityId, tenantId, "Cash SRL", "7000001"]
    );
    await ownerPool.query(
      `insert into branches (id, tenant_id, legal_entity_id, code, name)
       values ($1, $2, $3, 'MAIN', 'Main branch'),
              ($4, $2, $3, 'OTHER', 'Other branch')`,
      [branchId, tenantId, legalEntityId, otherBranchId]
    );
    await ownerPool.query(
      `insert into users (id, email, display_name, password_hash, is_active)
       values ($1, 'actor@cash.test', 'Ada Cash', 'not-a-password', true),
              ($2, 'second@cash.test', 'Bruno Cash', 'not-a-password', true),
              ($3, 'other@cash.test', 'Celia Other', 'not-a-password', true),
              ($4, 'inactive@cash.test', 'Inactive Cash', 'not-a-password', false),
              ($5, 'supervisor@cash.test', 'Dana Supervisor', 'not-a-password', true)`,
      [actorId, secondUserId, otherBranchUserId, inactiveUserId, supervisorId]
    );
    await ownerPool.query(
      `insert into user_branch_memberships (user_id, tenant_id, branch_id)
       values ($1, $4, $5), ($1, $4, $6), ($2, $4, $5), ($3, $4, $6), ($7, $4, $5), ($8, $4, $5)`,
      [actorId, secondUserId, otherBranchUserId, tenantId, branchId, otherBranchId, inactiveUserId, supervisorId]
    );
    await ownerPool.query(
      "insert into permissions (code, description) values ('cash.shift.approve', 'Approve non-zero cash shift differences')"
    );
    await ownerPool.query("insert into roles (id, tenant_id, code) values ($1, $2, 'cash-supervisor')", [
      supervisorRoleId,
      tenantId
    ]);
    await ownerPool.query(
      "insert into role_permissions (role_id, permission_code) values ($1, 'cash.shift.approve')",
      [supervisorRoleId]
    );
    await ownerPool.query("insert into user_roles (user_id, tenant_id, role_id) values ($1, $2, $3)", [
      supervisorId,
      tenantId,
      supervisorRoleId
    ]);
    await ownerPool.query(
      `insert into cash_registers (id, tenant_id, branch_id, code, is_active)
       values ($1, $4, $5, 'CAJA-1', true),
              ($2, $4, $5, 'CAJA-2', true),
              ($3, $4, $6, 'CAJA-OTHER', true)`,
      [registerId, secondRegisterId, otherBranchRegisterId, tenantId, branchId, otherBranchId]
    );
  });

  afterAll(async () => {
    await database.close();
    await ownerPool.end();
  });

  it("lists scoped resources and creates one replayable shift with multiple users", async () => {
    await expect(cash.listRegisters(scope)).resolves.toEqual({
      items: [
        { id: registerId, code: "CAJA-1" },
        { id: secondRegisterId, code: "CAJA-2" }
      ]
    });
    await expect(cash.listEligibleUsers(scope)).resolves.toEqual({
      items: [
        { id: actorId, displayName: "Ada Cash" },
        { id: secondUserId, displayName: "Bruno Cash" },
        { id: supervisorId, displayName: "Dana Supervisor" }
      ]
    });

    const input = {
      idempotencyKey: "cash-shift-001",
      cashRegisterId: registerId,
      scheduledStartAt: "2026-09-22T12:00:00.000Z",
      scheduledEndAt: "2026-09-22T20:00:00.000Z",
      userIds: [actorId, secondUserId]
    };
    const created = await controller.create({ auth: scope } as never, input);
    const replay = await cash.createShift(scope, input);
    expect(replay).toEqual(created);
    expect(created).toMatchObject({
      cashRegisterId: registerId,
      cashRegisterCode: "CAJA-1",
      status: "SCHEDULED",
      users: [
        { id: actorId, displayName: "Ada Cash" },
        { id: secondUserId, displayName: "Bruno Cash" }
      ]
    });
    await expect(cash.listShifts(scope)).resolves.toEqual({ items: [created] });

    const rows = await ownerPool.query("select id from cash_shifts where tenant_id = $1", [tenantId]);
    expect(rows.rowCount).toBe(1);

    const concurrentInput = {
      ...input,
      idempotencyKey: "cash-shift-concurrent-replay",
      cashRegisterId: secondRegisterId
    };
    const [concurrentFirst, concurrentReplay] = await Promise.all([
      cash.createShift(scope, concurrentInput),
      cash.createShift(scope, concurrentInput)
    ]);
    expect(concurrentReplay).toEqual(concurrentFirst);
    const replayRows = await ownerPool.query(
      "select id from cash_shifts where tenant_id = $1 and cash_register_id = $2",
      [tenantId, secondRegisterId]
    );
    expect(replayRows.rowCount).toBe(1);
  });

  it("allows adjacent shifts and rejects sequential or concurrent overlap on one register", async () => {
    await cash.createShift(scope, {
      idempotencyKey: "cash-shift-morning",
      cashRegisterId: registerId,
      scheduledStartAt: "2026-09-22T12:00:00.000Z",
      scheduledEndAt: "2026-09-22T20:00:00.000Z",
      userIds: [actorId]
    });
    await expect(
      cash.createShift(scope, {
        idempotencyKey: "cash-shift-evening",
        cashRegisterId: registerId,
        scheduledStartAt: "2026-09-22T20:00:00.000Z",
        scheduledEndAt: "2026-09-23T04:00:00.000Z",
        userIds: [secondUserId]
      })
    ).resolves.toMatchObject({ status: "SCHEDULED" });
    await expect(
      cash.createShift(scope, {
        idempotencyKey: "cash-shift-overlap",
        cashRegisterId: registerId,
        scheduledStartAt: "2026-09-22T19:59:00.000Z",
        scheduledEndAt: "2026-09-22T21:00:00.000Z",
        userIds: [actorId]
      })
    ).rejects.toMatchObject({ code: "CASH_SHIFT_OVERLAP", statusCode: 409 });

    const concurrent = await Promise.allSettled([
      cash.createShift(scope, {
        idempotencyKey: "cash-shift-concurrent-a",
        cashRegisterId: secondRegisterId,
        scheduledStartAt: "2026-09-24T12:00:00.000Z",
        scheduledEndAt: "2026-09-24T20:00:00.000Z",
        userIds: [actorId]
      }),
      cash.createShift(scope, {
        idempotencyKey: "cash-shift-concurrent-b",
        cashRegisterId: secondRegisterId,
        scheduledStartAt: "2026-09-24T13:00:00.000Z",
        scheduledEndAt: "2026-09-24T18:00:00.000Z",
        userIds: [secondUserId]
      })
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("rejects invalid assignments, cross-branch resources, and conflicting replay payloads", async () => {
    const base = {
      idempotencyKey: "cash-shift-validation",
      cashRegisterId: registerId,
      scheduledStartAt: "2026-09-25T12:00:00.000Z",
      scheduledEndAt: "2026-09-25T20:00:00.000Z",
      userIds: [actorId]
    };
    await expect(cash.createShift(scope, { ...base, userIds: [] })).rejects.toThrow();
    await expect(cash.createShift(scope, { ...base, userIds: [actorId, actorId] })).rejects.toThrow();
    await expect(cash.createShift(scope, { ...base, userIds: [inactiveUserId] })).rejects.toThrow();
    await expect(cash.createShift(scope, { ...base, userIds: [otherBranchUserId] })).rejects.toThrow();
    await expect(cash.createShift(scope, { ...base, cashRegisterId: otherBranchRegisterId })).rejects.toThrow();
    await expect(
      cash.createShift(scope, { ...base, scheduledEndAt: base.scheduledStartAt })
    ).rejects.toThrow();

    await cash.createShift(scope, base);
    await expect(
      cash.createShift(scope, { ...base, cashRegisterId: secondRegisterId })
    ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);

    await expect(cash.listRegisters(otherScope)).resolves.toEqual({
      items: [{ id: otherBranchRegisterId, code: "CAJA-OTHER" }]
    });
  });

  it("opens, counts, and closes a zero-difference shift with exact decimals", async () => {
    const shift = await cash.createShift(scope, {
      idempotencyKey: "cash-control-shift-zero",
      cashRegisterId: registerId,
      scheduledStartAt: "2026-09-26T12:00:00.000Z",
      scheduledEndAt: "2026-09-26T20:00:00.000Z",
      userIds: [actorId]
    });
    const opened = await cash.openShift(scope, shift.id, {
      idempotencyKey: "cash-control-open-zero",
      openingAmountBob: "100.1250"
    });
    expect(opened).toMatchObject({
      cashShiftId: shift.id,
      openingAmountBob: "100.1250",
      expectedAmountBob: "100.1250",
      status: "OPEN"
    });
    expect(await cash.openShift(scope, shift.id, {
      idempotencyKey: "cash-control-open-zero",
      openingAmountBob: "100.1250"
    })).toEqual(opened);
    const closed = await cash.countShift(scope, shift.id, {
      idempotencyKey: "cash-control-count-zero",
      countedAmountBob: "100.1250"
    });
    expect(closed).toMatchObject({
      status: "CLOSED",
      countedAmountBob: "100.1250",
      differenceAmountBob: "0.0000"
    });
  });

  it("requires supervisor approval for non-zero differences", async () => {
    const shift = await cash.createShift(scope, {
      idempotencyKey: "cash-control-shift-difference",
      cashRegisterId: registerId,
      scheduledStartAt: "2026-09-27T12:00:00.000Z",
      scheduledEndAt: "2026-09-27T20:00:00.000Z",
      userIds: [actorId]
    });
    await cash.openShift(scope, shift.id, {
      idempotencyKey: "cash-control-open-difference",
      openingAmountBob: "100.0000"
    });
    const pending = await cash.countShift(scope, shift.id, {
      idempotencyKey: "cash-control-count-difference",
      countedAmountBob: "99.5000"
    });
    expect(pending).toMatchObject({ status: "PENDING_APPROVAL", differenceAmountBob: "-0.5000" });
    await expect(cash.approveShift(scope, shift.id, {
      idempotencyKey: "cash-control-approve-denied",
      approvalNote: "Not a supervisor"
    })).rejects.toThrow();
    const approved = await cash.approveShift(supervisorScope, shift.id, {
      idempotencyKey: "cash-control-approve-difference",
      approvalNote: "Reviewed variance"
    });
    expect(approved).toMatchObject({ status: "CLOSED", approvalNote: "Reviewed variance" });
    expect(await cash.approveShift(supervisorScope, shift.id, {
      idempotencyKey: "cash-control-approve-difference",
      approvalNote: "Reviewed variance"
    })).toEqual(approved);

    const positiveShift = await cash.createShift(scope, {
      idempotencyKey: "cash-control-shift-positive",
      cashRegisterId: secondRegisterId,
      scheduledStartAt: "2026-09-27T21:00:00.000Z",
      scheduledEndAt: "2026-09-28T05:00:00.000Z",
      userIds: [actorId]
    });
    await cash.openShift(scope, positiveShift.id, {
      idempotencyKey: "cash-control-open-positive",
      openingAmountBob: "100.0000"
    });
    await expect(cash.countShift(scope, positiveShift.id, {
      idempotencyKey: "cash-control-count-positive",
      countedAmountBob: "100.5000"
    })).resolves.toMatchObject({ status: "PENDING_APPROVAL", differenceAmountBob: "0.5000" });
  });

  it("denies opening from an unassigned user and isolates controls by branch", async () => {
    const shift = await cash.createShift(scope, {
      idempotencyKey: "cash-control-shift-scope",
      cashRegisterId: registerId,
      scheduledStartAt: "2026-09-29T12:00:00.000Z",
      scheduledEndAt: "2026-09-29T20:00:00.000Z",
      userIds: [actorId]
    });
    await expect(cash.openShift(secondScope, shift.id, {
      idempotencyKey: "cash-control-open-unassigned",
      openingAmountBob: "1.0000"
    })).rejects.toThrow();
    await cash.openShift(scope, shift.id, {
      idempotencyKey: "cash-control-open-scope",
      openingAmountBob: "1.0000"
    });
    await expect(cash.listShifts(otherScope)).resolves.toEqual({ items: [] });
  });

  it("serializes a concurrent count and approval on the control row", async () => {
    const shift = await cash.createShift(scope, {
      idempotencyKey: "cash-control-shift-concurrent",
      cashRegisterId: registerId,
      scheduledStartAt: "2026-09-30T12:00:00.000Z",
      scheduledEndAt: "2026-09-30T20:00:00.000Z",
      userIds: [actorId]
    });
    await cash.openShift(scope, shift.id, {
      idempotencyKey: "cash-control-open-concurrent",
      openingAmountBob: "100.0000"
    });
    const [countResult, approvalResult] = await Promise.allSettled([
      cash.countShift(scope, shift.id, {
        idempotencyKey: "cash-control-count-concurrent",
        countedAmountBob: "99.0000"
      }),
      cash.approveShift(supervisorScope, shift.id, {
        idempotencyKey: "cash-control-approve-concurrent"
      })
    ]);
    expect(countResult.status).toBe("fulfilled");
    expect(["fulfilled", "rejected"]).toContain(approvalResult.status);
    const listed = await cash.listShifts(scope);
    expect(["PENDING_APPROVAL", "CLOSED"]).toContain(listed.items[0]?.control?.status);
  });

  it("rejects malformed money and conflicting control replays", async () => {
    const shift = await cash.createShift(scope, {
      idempotencyKey: "cash-control-shift-invalid",
      cashRegisterId: registerId,
      scheduledStartAt: "2026-09-28T12:00:00.000Z",
      scheduledEndAt: "2026-09-28T20:00:00.000Z",
      userIds: [actorId]
    });
    await expect(cash.openShift(scope, shift.id, {
      idempotencyKey: "cash-control-open-invalid",
      openingAmountBob: "1.23456"
    })).rejects.toThrow();
    await cash.openShift(scope, shift.id, {
      idempotencyKey: "cash-control-open-valid",
      openingAmountBob: "10.0000"
    });
    await expect(cash.countShift(scope, shift.id, {
      idempotencyKey: "cash-control-count-invalid",
      countedAmountBob: "-1.0000"
    })).rejects.toThrow();
    await cash.countShift(scope, shift.id, {
      idempotencyKey: "cash-control-count-valid",
      countedAmountBob: "10.0000"
    });
    await expect(cash.countShift(scope, shift.id, {
      idempotencyKey: "cash-control-count-valid",
      countedAmountBob: "11.0000"
    })).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
  });
});
