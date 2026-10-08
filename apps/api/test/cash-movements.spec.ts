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

const tenantId = "00000000-0000-4000-8000-000000000b01";
const legalEntityId = "00000000-0000-4000-8000-000000000b02";
const branchId = "00000000-0000-4000-8000-000000000b03";
const otherBranchId = "00000000-0000-4000-8000-000000000b04";
const actorId = "00000000-0000-4000-8000-000000000b05";
const unassignedId = "00000000-0000-4000-8000-000000000b06";
const supervisorId = "00000000-0000-4000-8000-000000000b07";
const supervisorRoleId = "00000000-0000-4000-8000-000000000b08";
const registerId = "00000000-0000-4000-8000-000000000b09";

const scope: TenantScope = { tenantId, branchId, userId: actorId };
const unassignedScope: TenantScope = { tenantId, branchId, userId: unassignedId };
const supervisorScope: TenantScope = { tenantId, branchId, userId: supervisorId };
const otherBranchScope: TenantScope = { tenantId, branchId: otherBranchId, userId: actorId };
const ownerPool = new Pool({ connectionString: testDatabaseUrl });
const database = new TenantDatabase(testAppDatabaseUrl);
const cash = new CashService(database);
const controller = new CashController(cash);
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

let shiftId = "";
let keySeq = 0;
const nextKey = () => `cash-mov-${++keySeq}`;

async function openShift(opening = "100.0000", day = "01"): Promise<string> {
  const shift = await cash.createShift(scope, {
    idempotencyKey: nextKey(),
    cashRegisterId: registerId,
    scheduledStartAt: `2026-10-${day}T12:00:00.000Z`,
    scheduledEndAt: `2026-10-${day}T20:00:00.000Z`,
    userIds: [actorId]
  });
  await cash.openShift(scope, shift.id, { idempotencyKey: nextKey(), openingAmountBob: opening });
  return shift.id;
}

describe("cash movements (module 5 T4)", () => {
  beforeAll(async () => {
    await migrate(drizzle(ownerPool), { migrationsFolder });
  });

  beforeEach(async () => {
    await ownerPool.query(`
      truncate table
        cash_movements, cash_shift_controls, cash_shift_users, cash_shifts,
        audit_events, idempotency_records, outbox_events, user_roles, role_permissions,
        permissions, roles, user_branch_memberships, cash_registers, branches,
        legal_entities, users, tenants
      cascade
    `);
    await ownerPool.query("insert into tenants (id, slug, name) values ($1, 'mov-tenant', 'Mov')", [tenantId]);
    await ownerPool.query(
      "insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, 'Mov SRL', '7000002')",
      [legalEntityId, tenantId]
    );
    await ownerPool.query(
      `insert into branches (id, tenant_id, legal_entity_id, code, name)
       values ($1, $3, $4, 'MAIN', 'Main'), ($2, $3, $4, 'OTHER', 'Other')`,
      [branchId, otherBranchId, tenantId, legalEntityId]
    );
    await ownerPool.query(
      `insert into users (id, email, display_name, password_hash, is_active)
       values ($1, 'a@mov.test', 'Ada', 'x', true), ($2, 'u@mov.test', 'Uma', 'x', true),
              ($3, 'sup@mov.test', 'Sup', 'x', true)`,
      [actorId, unassignedId, supervisorId]
    );
    await ownerPool.query(
      `insert into user_branch_memberships (user_id, tenant_id, branch_id)
       values ($1, $4, $5), ($1, $4, $6), ($2, $4, $5), ($3, $4, $5)`,
      [actorId, unassignedId, supervisorId, tenantId, branchId, otherBranchId]
    );
    await ownerPool.query(
      "insert into permissions (code, description) values ('cash.shift.approve', 'Approve') on conflict do nothing"
    );
    await ownerPool.query("insert into roles (id, tenant_id, code) values ($1, $2, 'sup')", [supervisorRoleId, tenantId]);
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
      "insert into cash_registers (id, tenant_id, branch_id, code, is_active) values ($1, $2, $3, 'CAJA-1', true)",
      [registerId, tenantId, branchId]
    );
    shiftId = await openShift("100.0000");
  });

  afterAll(async () => {
    await database.close();
    await ownerPool.end();
  });

  it("IN adds and OUT subtracts from the expected cash, audited with an outbox event", async () => {
    const received = await controller.createMovement({ auth: scope } as never, shiftId, {
      idempotencyKey: nextKey(),
      type: "IN",
      amountBob: "50.2500",
      reason: "  Change fund  ",
      category: "CHANGE_FUND"
    });
    expect(received).toMatchObject({
      type: "IN",
      amountBob: "50.2500",
      reason: "Change fund",
      category: "CHANGE_FUND",
      expectedAmountBob: "150.2500"
    });
    const out = await cash.createMovement(scope, shiftId, {
      idempotencyKey: nextKey(),
      type: "OUT",
      amountBob: "20.1000",
      reason: "Cleaning supplies"
    });
    expect(out).toMatchObject({ type: "OUT", category: null, expectedAmountBob: "130.1500" });

    const listed = await cash.listMovements(scope, shiftId);
    expect(listed.items.map((item) => item.type)).toEqual(["IN", "OUT"]);
    expect(listed.summary).toEqual({
      openingAmountBob: "100.0000",
      cashSalesBob: "0.0000",
      movementsInBob: "50.2500",
      movementsOutBob: "20.1000",
      expectedAmountBob: "130.1500"
    });
    const audit = await ownerPool.query(
      "select count(*)::int as n from audit_events where action = 'cash.movement_registered'"
    );
    expect(audit.rows[0].n).toBe(2);
    const outbox = await ownerPool.query(
      "select count(*)::int as n from outbox_events where event_type = 'cash.movement_registered'"
    );
    expect(outbox.rows[0].n).toBe(2);
    const shifts = await cash.listShifts(scope);
    expect(shifts.items[0]?.control).toMatchObject({
      movementsInBob: "50.2500",
      movementsOutBob: "20.1000",
      cashSalesBob: "0.0000",
      expectedAmountBob: "130.1500"
    });
  });

  it("rejects an OUT larger than the expected cash but allows draining it exactly", async () => {
    await expect(
      cash.createMovement(scope, shiftId, {
        idempotencyKey: nextKey(),
        type: "OUT",
        amountBob: "100.0001",
        reason: "Too much"
      })
    ).rejects.toMatchObject({ response: { code: "CASH_MOVEMENT_EXCEEDS_EXPECTED" } });
    await expect(
      cash.createMovement(scope, shiftId, {
        idempotencyKey: nextKey(),
        type: "OUT",
        amountBob: "100.0000",
        reason: "Deposit all",
        category: "DEPOSIT"
      })
    ).resolves.toMatchObject({ expectedAmountBob: "0.0000" });
  });

  it("rejects closed or unopened shifts, unassigned users and cross-branch access", async () => {
    const input = (reason = "Petty") => ({
      idempotencyKey: nextKey(),
      type: "IN" as const,
      amountBob: "5",
      reason
    });
    await expect(cash.createMovement(unassignedScope, shiftId, input())).rejects.toThrow();
    await expect(cash.createMovement(otherBranchScope, shiftId, input())).rejects.toThrow();
    await expect(cash.listMovements(otherBranchScope, shiftId)).rejects.toThrow();

    const scheduled = await cash.createShift(scope, {
      idempotencyKey: nextKey(),
      cashRegisterId: registerId,
      scheduledStartAt: "2026-10-02T12:00:00.000Z",
      scheduledEndAt: "2026-10-02T20:00:00.000Z",
      userIds: [actorId]
    });
    await expect(cash.createMovement(scope, scheduled.id, input())).rejects.toThrow();

    await cash.countShift(scope, shiftId, { idempotencyKey: nextKey(), countedAmountBob: "100" });
    await expect(cash.createMovement(scope, shiftId, input())).rejects.toMatchObject({ status: 409 });
    const rows = await ownerPool.query("select count(*)::int as n from cash_movements");
    expect(rows.rows[0].n).toBe(0);
  });

  it("rejects invalid type, amount, reason and category", async () => {
    const base = { type: "IN", amountBob: "10", reason: "ok" };
    const attempt = (patch: Record<string, unknown>) =>
      cash.createMovement(scope, shiftId, { ...base, idempotencyKey: nextKey(), ...patch } as never);
    await expect(attempt({ type: "SIDEWAYS" })).rejects.toThrow();
    await expect(attempt({ amountBob: "0" })).rejects.toThrow();
    await expect(attempt({ amountBob: "0.0000" })).rejects.toThrow();
    await expect(attempt({ amountBob: "-5" })).rejects.toThrow();
    await expect(attempt({ amountBob: "1.23456" })).rejects.toThrow();
    await expect(attempt({ amountBob: "abc" })).rejects.toThrow();
    await expect(attempt({ reason: "   " })).rejects.toThrow();
    await expect(attempt({ reason: "r".repeat(201) })).rejects.toThrow();
    await expect(attempt({ category: "BRIBES" })).rejects.toThrow();
    const rows = await ownerPool.query("select count(*)::int as n from cash_movements");
    expect(rows.rows[0].n).toBe(0);
  });

  it("replays an idempotent request once and rejects a conflicting payload", async () => {
    const input = {
      idempotencyKey: "cash-mov-replay",
      type: "IN" as const,
      amountBob: "10",
      reason: "Replay"
    };
    const [first, second] = await Promise.all([
      cash.createMovement(scope, shiftId, input),
      cash.createMovement(scope, shiftId, input)
    ]);
    expect(second).toEqual(first);
    await expect(cash.createMovement(scope, shiftId, { ...input, amountBob: "11" })).rejects.toBeInstanceOf(
      IdempotencyKeyReusedError
    );
    const rows = await ownerPool.query("select count(*)::int as n from cash_movements");
    expect(rows.rows[0].n).toBe(1);
    const control = await ownerPool.query("select expected_amount_bob::text as e from cash_shift_controls");
    expect(control.rows[0].e).toBe("110.0000");
  });

  it("lists movements for a supervisor and keeps rows immutable and branch-isolated", async () => {
    await cash.createMovement(scope, shiftId, {
      idempotencyKey: nextKey(),
      type: "IN",
      amountBob: "1",
      reason: "One"
    });
    await expect(cash.listMovements(supervisorScope, shiftId)).resolves.toMatchObject({
      items: [{ reason: "One" }]
    });
    await expect(ownerPool.query("update cash_movements set reason = 'x'")).rejects.toThrow(/immutable/);
    await expect(ownerPool.query("delete from cash_movements")).rejects.toThrow(/immutable/);
    const rows = await database.withScope(otherBranchScope, (client) =>
      client.query("select 1 from cash_movements")
    );
    expect(rows.rowCount).toBe(0);
  });

  it("uses movements when counting the shift", async () => {
    await cash.createMovement(scope, shiftId, {
      idempotencyKey: nextKey(),
      type: "IN",
      amountBob: "40",
      reason: "Float"
    });
    await cash.createMovement(scope, shiftId, {
      idempotencyKey: nextKey(),
      type: "OUT",
      amountBob: "15.5",
      reason: "Expense",
      category: "EXPENSE"
    });
    const counted = await cash.countShift(scope, shiftId, {
      idempotencyKey: nextKey(),
      countedAmountBob: "124.5000"
    });
    expect(counted).toMatchObject({
      expectedAmountBob: "124.5000",
      differenceAmountBob: "0.0000",
      status: "CLOSED",
      movementsInBob: "40.0000",
      movementsOutBob: "15.5000"
    });

    const shift2 = await openShift("10", "03");
    await cash.createMovement(scope, shift2, {
      idempotencyKey: nextKey(),
      type: "OUT",
      amountBob: "4",
      reason: "Expense"
    });
    const short = await cash.countShift(scope, shift2, { idempotencyKey: nextKey(), countedAmountBob: "10" });
    expect(short).toMatchObject({
      expectedAmountBob: "6.0000",
      differenceAmountBob: "4.0000",
      status: "PENDING_APPROVAL"
    });
  });
});
