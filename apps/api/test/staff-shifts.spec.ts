import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TenantDatabase, type TenantScope } from "../src/database/tenant-database.js";
import { systemRoles, tenantPermissions } from "../src/identity/role-templates.js";
import { StaffShiftsService } from "../src/staff/staff-shifts.service.js";

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

const id = (n: number) => `00000000-0000-4000-8000-${String(920000 + n).padStart(12, "0")}`;
const tenantId = id(1);
const legalEntityId = id(2);
const branchA = id(11);
const branchB = id(12);
const managerId = id(21);
const cashierId = id(22);
const otherBranchUserId = id(23);

const ownerPool = new Pool({ connectionString: testOwnerUrl });
const database = new TenantDatabase(testAppUrl);
const shifts = new StaffShiftsService(database);
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
const managerScope: TenantScope = { tenantId, userId: managerId, branchId: branchA };
const cashierScope: TenantScope = { tenantId, userId: cashierId, branchId: branchA };
const branchBScope: TenantScope = { tenantId, userId: otherBranchUserId, branchId: branchB };

const HOUR = 3_600_000;
const at = (offsetHours: number) => new Date(Date.now() + offsetHours * HOUR).toISOString();

async function setPlan(planCode: string): Promise<void> {
  await ownerPool.query("delete from tenant_subscriptions where tenant_id = $1", [tenantId]);
  const plan = await ownerPool.query<{ id: string }>("select id from subscription_plans where code = $1", [planCode]);
  await ownerPool.query(
    "insert into tenant_subscriptions (tenant_id, plan_id, status, starts_at) values ($1, $2, 'ACTIVE', now())",
    [tenantId, plan.rows[0]!.id]
  );
}

async function rejection(promise: Promise<unknown>): Promise<{ error: unknown; body: Record<string, unknown> }> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  );
  expect(error).not.toBeNull();
  const response = (error as { getResponse?: () => unknown }).getResponse?.();
  return { error, body: (response ?? {}) as Record<string, unknown> };
}

describe("F16 staff shifts (T1 schema + T2 service)", () => {
  beforeAll(async () => {
    await migrate(drizzle(ownerPool), { migrationsFolder });
  });
  afterAll(async () => {
    await database.close();
    await ownerPool.end();
  });

  beforeEach(async () => {
    await ownerPool.query("truncate table tenants, users cascade");
    await ownerPool.query("insert into tenants (id, slug, name) values ($1, 'staff-shifts', 'Farmacia Personal')", [tenantId]);
    await ownerPool.query("insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, 'Farmacia Personal SRL', '7009201')", [legalEntityId, tenantId]);
    await ownerPool.query("insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, 'MAIN', 'Central'), ($4, $2, $3, 'SUR', 'Sur')", [branchA, tenantId, legalEntityId, branchB]);
    await ownerPool.query(
      `insert into users (id, email, display_name, password_hash) values
         ($1, 'staff-manager@example.test', 'Encargada', 'x'),
         ($2, 'staff-cajero@example.test', 'Cajero', 'x'),
         ($3, 'staff-sur@example.test', 'Vendedor Sur', 'x')`,
      [managerId, cashierId, otherBranchUserId]
    );
    await ownerPool.query(
      `insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $4, $5), ($2, $4, $5), ($3, $4, $6)`,
      [managerId, cashierId, otherBranchUserId, tenantId, branchA, branchB]
    );
    await setPlan("PROFESIONAL");
  });

  describe("T1 schema and permissions", () => {
    it("registers the three Personal permissions in the templates and the permissions table", async () => {
      const codes = ["staff.shifts.manage", "staff.commissions.manage", "staff.reports.read"];
      expect(tenantPermissions.filter((p) => codes.includes(p.code)).map((p) => p.module)).toEqual(["Personal", "Personal", "Personal"]);
      const roleHas = (role: string) =>
        codes.filter((code) => (systemRoles.find((r) => r.code === role)!.permissions as readonly string[]).includes(code));
      expect(roleHas("owner")).toEqual(codes);
      expect(roleHas("regente")).toEqual(["staff.shifts.manage", "staff.reports.read"]);
      expect(roleHas("encargado")).toEqual(["staff.shifts.manage", "staff.reports.read"]);
      expect(roleHas("cajero")).toEqual([]);
      // Other suites truncate the global permissions catalog, so assert the migration seeds them instead.
      const migration = readFileSync(resolve(migrationsFolder, "0030_staff.sql"), "utf8");
      for (const code of codes) expect(migration).toContain(`('${code}',`);
      expect(migration.match(/'Personal'/g)).toHaveLength(3);
    });

    it("keeps shifts branch-scoped through RLS", async () => {
      await shifts.createShift(managerScope, { userId: cashierId, kind: "REGULAR", startsAt: at(1), endsAt: at(5) });
      const visibleInA = await database.withScope(managerScope, (c) => c.query("select id from staff_shifts"));
      const visibleInB = await database.withScope(branchBScope, (c) => c.query("select id from staff_shifts"));
      expect(visibleInA.rowCount).toBe(1);
      expect(visibleInB.rowCount).toBe(0);
    });
  });

  describe("T2 roster", () => {
    it("creates, lists (range + user filter) and cancels shifts with audit", async () => {
      const night = await shifts.createShift(managerScope, { userId: cashierId, kind: "NIGHT_DUTY", startsAt: at(2), endsAt: at(10), notes: "Guardia" });
      expect(night).toMatchObject({ userId: cashierId, userName: "Cajero", kind: "NIGHT_DUTY", status: "SCHEDULED", notes: "Guardia", checkedInAt: null });
      await shifts.createShift(managerScope, { userId: managerId, kind: "REGULAR", startsAt: at(2), endsAt: at(6) });

      const all = await shifts.listShifts(managerScope, {});
      expect(all).toHaveLength(2);
      const mine = await shifts.listShifts(managerScope, { userId: cashierId });
      expect(mine.map((s) => s.id)).toEqual([night.id]);
      const empty = await shifts.listShifts(managerScope, { from: "2000-01-01", to: "2000-01-02" });
      expect(empty).toHaveLength(0);

      const canceled = await shifts.cancelShift(managerScope, night.id, { reason: "Cambio de turno" });
      expect(canceled).toMatchObject({ status: "CANCELED", cancelReason: "Cambio de turno" });
      const audits = await ownerPool.query("select action from audit_events where tenant_id = $1 order by occurred_at, id", [tenantId]);
      expect(audits.rows.map((r: { action: string }) => r.action).sort()).toEqual(["staff.shift.canceled", "staff.shift.created", "staff.shift.created"]);
      const { error } = await rejection(shifts.cancelShift(managerScope, night.id, { reason: "otra vez" }));
      expect(error).toBeInstanceOf(ConflictException);
    });

    it("rejects overlapping scheduled shifts of the same user with 409 SHIFT_OVERLAP, but not after cancel or for other users", async () => {
      const first = await shifts.createShift(managerScope, { userId: cashierId, kind: "REGULAR", startsAt: at(1), endsAt: at(5) });
      const clash = await rejection(shifts.createShift(managerScope, { userId: cashierId, kind: "NIGHT_DUTY", startsAt: at(4), endsAt: at(9) }));
      expect(clash.error).toBeInstanceOf(ConflictException);
      expect(clash.body.code).toBe("SHIFT_OVERLAP");
      await shifts.createShift(managerScope, { userId: managerId, kind: "REGULAR", startsAt: at(4), endsAt: at(9) });
      await shifts.createShift(managerScope, { userId: cashierId, kind: "REGULAR", startsAt: at(5), endsAt: at(8) });
      await shifts.cancelShift(managerScope, first.id, { reason: "Libre" });
      await shifts.createShift(managerScope, { userId: cashierId, kind: "REGULAR", startsAt: at(1), endsAt: at(3) });
    });

    it("validates input and branch membership", async () => {
      const bad = [
        { userId: cashierId, kind: "REGULAR", startsAt: at(5), endsAt: at(1) },
        { userId: cashierId, kind: "WEEKEND", startsAt: at(1), endsAt: at(2) },
        { userId: cashierId, kind: "REGULAR", startsAt: "nope", endsAt: at(2) },
        { userId: cashierId, kind: "REGULAR", startsAt: at(1), endsAt: at(40) }
      ];
      for (const input of bad) {
        const { error, body } = await rejection(shifts.createShift(managerScope, input as never));
        expect(error).toBeInstanceOf(BadRequestException);
        expect(body.code).toBe("INVALID_INPUT");
      }
      const outsider = await rejection(shifts.createShift(managerScope, { userId: otherBranchUserId, kind: "REGULAR", startsAt: at(1), endsAt: at(2) }));
      expect(outsider.body.code).toBe("USER_NOT_IN_BRANCH");
      const noReason = await rejection(shifts.cancelShift(managerScope, id(999), { reason: "  " }));
      expect(noReason.body.code).toBe("INVALID_INPUT");
    });

    it("lists the caller's own shifts and the branch members", async () => {
      await shifts.createShift(managerScope, { userId: cashierId, kind: "REGULAR", startsAt: at(1), endsAt: at(3) });
      await shifts.createShift(managerScope, { userId: managerId, kind: "REGULAR", startsAt: at(1), endsAt: at(3) });
      const own = await shifts.myShifts(cashierScope, {});
      expect(own.map((s) => s.userId)).toEqual([cashierId]);
      const members = await shifts.listMembers(managerScope);
      expect(members.map((m) => m.userId).sort()).toEqual([managerId, cashierId].sort());
    });
  });

  describe("T2 attendance", () => {
    it("checks in inside the window (30 min before start) and checks out afterwards", async () => {
      const shift = await shifts.createShift(managerScope, { userId: cashierId, kind: "REGULAR", startsAt: at(0.25), endsAt: at(4) });
      const checkedIn = await shifts.checkIn(cashierScope, shift.id);
      expect(checkedIn.checkedInAt).not.toBeNull();
      expect((await rejection(shifts.checkIn(cashierScope, shift.id))).body.code).toBe("ALREADY_CHECKED_IN");
      const checkedOut = await shifts.checkOut(cashierScope, shift.id);
      expect(checkedOut.checkedOutAt).not.toBeNull();
      expect((await rejection(shifts.checkOut(cashierScope, shift.id))).body.code).toBe("ALREADY_CHECKED_OUT");
      const audits = await ownerPool.query("select action from audit_events where action like 'staff.shift.checked%'");
      expect(audits.rows.map((r: { action: string }) => r.action).sort()).toEqual(["staff.shift.checked_in", "staff.shift.checked_out"]);
    });

    it("rejects check-in outside the window with 400 and check-out before check-in", async () => {
      const future = await shifts.createShift(managerScope, { userId: cashierId, kind: "REGULAR", startsAt: at(5), endsAt: at(9) });
      const early = await rejection(shifts.checkIn(cashierScope, future.id));
      expect(early.error).toBeInstanceOf(BadRequestException);
      expect(early.body.code).toBe("CHECK_IN_OUT_OF_WINDOW");
      const noIn = await rejection(shifts.checkOut(cashierScope, future.id));
      expect(noIn.error).toBeInstanceOf(BadRequestException);
      expect(noIn.body.code).toBe("NOT_CHECKED_IN");

      await ownerPool.query("update staff_shifts set starts_at = now() - interval '5 hours', ends_at = now() - interval '1 hour' where id = $1", [future.id]);
      const late = await rejection(shifts.checkIn(cashierScope, future.id));
      expect(late.body.code).toBe("CHECK_IN_OUT_OF_WINDOW");
    });

    it("rejects another user's shift (403) and canceled shifts", async () => {
      const shift = await shifts.createShift(managerScope, { userId: cashierId, kind: "REGULAR", startsAt: at(0), endsAt: at(4) });
      const foreign = await rejection(shifts.checkIn(managerScope, shift.id));
      expect(foreign.error).toBeInstanceOf(ForbiddenException);
      expect(foreign.body.code).toBe("SHIFT_NOT_OWNED");
      await shifts.cancelShift(managerScope, shift.id, { reason: "Baja" });
      expect((await rejection(shifts.checkIn(cashierScope, shift.id))).body.code).toBe("SHIFT_CANCELED");
      const missing = await rejection(shifts.checkIn(cashierScope, id(998)));
      expect((missing.error as { getStatus: () => number }).getStatus()).toBe(404);
    });

    it("does not allow canceling a shift already started", async () => {
      const shift = await shifts.createShift(managerScope, { userId: cashierId, kind: "REGULAR", startsAt: at(0), endsAt: at(4) });
      await shifts.checkIn(cashierScope, shift.id);
      const { error, body } = await rejection(shifts.cancelShift(managerScope, shift.id, { reason: "Tarde" }));
      expect(error).toBeInstanceOf(ConflictException);
      expect(body.code).toBe("SHIFT_ALREADY_STARTED");
    });
  });

  describe("plan gating", () => {
    it("returns 403 PLAN_FEATURE_RESTRICTED on BASICO", async () => {
      await setPlan("BASICO");
      const { error, body } = await rejection(shifts.listShifts(managerScope, {}));
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(body.code).toBe("PLAN_FEATURE_RESTRICTED");
      expect(body.feature).toBe("staff.shifts");
      expect((await rejection(shifts.myShifts(cashierScope, {}))).body.code).toBe("PLAN_FEATURE_RESTRICTED");
    });
  });
});
