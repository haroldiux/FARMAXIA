import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from "../src/auth/auth.decorators.js";
import { CustomersController } from "../src/customers/customers.controller.js";
import { CustomersService } from "../src/customers/customers.service.js";
import { FEATURE_KEY } from "../src/saas/subscription.guard.js";
import { TenantDatabase, type TenantScope } from "../src/database/tenant-database.js";
import { systemRoles, tenantPermissions } from "../src/identity/role-templates.js";
import { readFileSync } from "node:fs";

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

const id = (n: number) => `00000000-0000-4000-8000-${String(950000 + n).padStart(12, "0")}`;
const tenantId = id(1);
const legalEntityId = id(2);
const otherTenantId = id(3);
const otherLegalEntityId = id(4);
const branchId = id(11);
const branch2Id = id(12);
const otherBranchId = id(13);
const sellerId = id(21);
const branch2UserId = id(22);
const otherUserId = id(23);
const registerId = id(31);
const shiftId = id(32);
const warehouseId = id(33);
const warehouse2Id = id(34);
const register2Id = id(35);
const shift2Id = id(36);
const productId = id(51);
const presentationId = id(61);

const ownerPool = new Pool({ connectionString: testOwnerUrl });
const database = new TenantDatabase(testAppUrl);
const customers = new CustomersService(database);
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
const scope: TenantScope = { tenantId, userId: sellerId, branchId };
const branch2Scope: TenantScope = { tenantId, userId: branch2UserId, branchId: branch2Id };
const otherScope: TenantScope = { tenantId: otherTenantId, userId: otherUserId, branchId: otherBranchId };

async function setPlan(planCode: string, forTenant = tenantId): Promise<void> {
  await ownerPool.query("delete from tenant_subscriptions where tenant_id = $1", [forTenant]);
  const plan = await ownerPool.query<{ id: string }>("select id from subscription_plans where code = $1", [planCode]);
  await ownerPool.query(
    "insert into tenant_subscriptions (tenant_id, plan_id, status, starts_at) values ($1, $2, 'ACTIVE', now())",
    [forTenant, plan.rows[0]!.id]
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

let saleCounter = 0;
async function insertSale(
  customerId: string | null,
  total: number,
  options: { status?: string; daysAgo?: number; branch?: "one" | "two" } = {}
): Promise<string> {
  saleCounter += 1;
  const status = options.status ?? "CONFIRMED";
  const two = options.branch === "two";
  const sale = await ownerPool.query<{ id: string }>(
    `insert into sales (tenant_id, branch_id, cash_shift_id, warehouse_id, status, total_amount_bob, paid_amount_bob, sale_number,
                        created_by_user_id, created_at, customer_id, voided_at, voided_by_user_id, void_reason)
     values ($1, $2, $3, $4, $5::varchar, $6, $6, $7, $8, now() - make_interval(days => $9), $10,
             case when $5::varchar = 'VOIDED' then now() end, case when $5::varchar = 'VOIDED' then $8::uuid end,
             case when $5::varchar = 'VOIDED' then 'Error' end)
     returning id`,
    [
      tenantId, two ? branch2Id : branchId, two ? shift2Id : shiftId, two ? warehouse2Id : warehouseId, status, total,
      `V-${saleCounter}`, two ? branch2UserId : sellerId, options.daysAgo ?? 0, customerId
    ]
  );
  const saleId = sale.rows[0]!.id;
  await ownerPool.query(
    `insert into sale_items (tenant_id, branch_id, sale_id, presentation_id, quantity, quantity_base, unit_price_bob, line_total_bob)
     values ($1, $2, $3, $4, 1, 1, $5, $5)`,
    [tenantId, two ? branch2Id : branchId, saleId, presentationId, total]
  );
  return saleId;
}

async function insertReturn(saleId: string, amount: number): Promise<void> {
  saleCounter += 1;
  await ownerPool.query(
    `insert into sale_returns (tenant_id, branch_id, sale_id, return_number, refund_method, refund_amount_bob, reason, restock, cash_shift_id, created_by_user_id)
     values ($1, $2, $3, $4, 'CASH', $5, 'Devolución', false, $6, $7)`,
    [tenantId, branchId, saleId, `D-${saleCounter}`, amount, shiftId, sellerId]
  );
}

describe("F17 CRM customers (T1)", () => {
  beforeAll(async () => {
    await migrate(drizzle(ownerPool), { migrationsFolder });
  });
  afterAll(async () => {
    await database.close();
    await ownerPool.end();
  });

  beforeEach(async () => {
    saleCounter = 0;
    await ownerPool.query("truncate table tenants, users cascade");
    await ownerPool.query(
      "insert into tenants (id, slug, name) values ($1, 'crm-cust', 'Farmacia CRM'), ($2, 'crm-cust-2', 'Otra Farmacia')",
      [tenantId, otherTenantId]
    );
    await ownerPool.query(
      "insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, 'Farmacia CRM SRL', '7009501'), ($3, $4, 'Otra SRL', '7009502')",
      [legalEntityId, tenantId, otherLegalEntityId, otherTenantId]
    );
    await ownerPool.query(
      `insert into branches (id, tenant_id, legal_entity_id, code, name) values
         ($1, $2, $3, 'MAIN', 'Central'), ($4, $2, $3, 'NORTH', 'Norte'), ($5, $6, $7, 'MAIN', 'Otra Central')`,
      [branchId, tenantId, legalEntityId, branch2Id, otherBranchId, otherTenantId, otherLegalEntityId]
    );
    await ownerPool.query(
      `insert into users (id, email, display_name, password_hash) values
         ($1, 'crm-a@example.test', 'Ana', 'x'), ($2, 'crm-b@example.test', 'Norte', 'x'), ($3, 'crm-c@example.test', 'Otro', 'x')`,
      [sellerId, branch2UserId, otherUserId]
    );
    await ownerPool.query(
      "insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $4, $5), ($2, $4, $6), ($3, $7, $8)",
      [sellerId, branch2UserId, otherUserId, tenantId, branchId, branch2Id, otherTenantId, otherBranchId]
    );
    await ownerPool.query(
      "insert into warehouses (id, tenant_id, branch_id, name, warehouse_type) values ($1, $3, $4, 'Central', 'CENTRAL'), ($2, $3, $5, 'Norte', 'CENTRAL')",
      [warehouseId, warehouse2Id, tenantId, branchId, branch2Id]
    );
    await ownerPool.query(
      "insert into cash_registers (id, tenant_id, branch_id, code, is_active) values ($1, $3, $4, 'CAJA-1', true), ($2, $3, $5, 'CAJA-N', true)",
      [registerId, register2Id, tenantId, branchId, branch2Id]
    );
    await ownerPool.query(
      `insert into cash_shifts (id, tenant_id, branch_id, cash_register_id, scheduled_start_at, scheduled_end_at, status, created_by_user_id)
       values ($1, $3, $4, $5, now() - interval '90 days', now() + interval '8 hours', 'SCHEDULED', $7),
              ($2, $3, $6, $8, now() - interval '90 days', now() + interval '8 hours', 'SCHEDULED', $9)`,
      [shiftId, shift2Id, tenantId, branchId, registerId, branch2Id, sellerId, register2Id, branch2UserId]
    );
    await ownerPool.query("insert into products (id, tenant_id, name) values ($1, $2, 'Producto')", [productId, tenantId]);
    await ownerPool.query(
      "insert into product_presentations (id, tenant_id, product_id, name, base_unit_factor) values ($1, $2, $3, 'Caja', 1)",
      [presentationId, tenantId, productId]
    );
    await setPlan("BASICO");
    await setPlan("BASICO", otherTenantId);
  });

  describe("permissions and gating metadata", () => {
    it("writes need customers.manage; reads accept customers.manage, sales.confirm or sales.read; feature crm.customers", () => {
      const proto = CustomersController.prototype as unknown as Record<string, object>;
      for (const name of ["create", "update"]) {
        expect(Reflect.getMetadata(PERMISSIONS_KEY, proto[name]!)).toEqual(["customers.manage"]);
      }
      for (const name of ["list", "detail", "purchases"]) {
        const any = Reflect.getMetadata(ANY_PERMISSIONS_KEY, proto[name]!) as string[];
        expect(any).toEqual(expect.arrayContaining(["customers.manage", "sales.confirm"]));
      }
      expect(Reflect.getMetadata(FEATURE_KEY, CustomersController)).toBe("crm.customers");
    });

    it("grants customers.manage to owner, regente, encargado and cajero only; loyalty.manage to owner", () => {
      const holders = (code: string) => systemRoles.filter((role) => (role.permissions as readonly string[]).includes(code)).map((role) => role.code).sort();
      expect(holders("customers.manage")).toEqual(["cajero", "encargado", "owner", "regente"]);
      expect(holders("loyalty.manage")).toEqual(["owner"]);
    });

    it("registers the Clientes permissions in the templates and seeds them in the migration", () => {
      const codes = ["customers.manage", "loyalty.manage"];
      expect(tenantPermissions.filter((p) => codes.includes(p.code)).map((p) => p.module)).toEqual(["Clientes", "Clientes"]);
      // Other suites truncate the global permissions catalog, so assert the migration seeds them instead.
      const migration = readFileSync(resolve(migrationsFolder, "0031_crm_customers_loyalty.sql"), "utf8");
      for (const code of codes) expect(migration).toContain(`('${code}',`);
      expect(migration.match(/'Clientes'/g)).toHaveLength(2);
    });
  });

  describe("create, update and detail", () => {
    it("creates a customer with trimmed fields and returns the full shape (available on every plan)", async () => {
      const created = await customers.create(scope, {
        fullName: "  María Pérez  ",
        docType: "CI",
        docNumber: " 1234567 ",
        complement: "1A",
        phone: "70000000",
        email: "maria@example.test",
        notes: "Alérgica a penicilina"
      });
      expect(created).toMatchObject({
        fullName: "María Pérez",
        docType: "CI",
        docNumber: "1234567",
        complement: "1A",
        phone: "70000000",
        email: "maria@example.test",
        notes: "Alérgica a penicilina",
        isActive: true,
        loyaltyBalance: null
      });
      expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
      const detail = await customers.detail(scope, created.id);
      expect(detail).toMatchObject({ id: created.id, fullName: "María Pérez" });
    });

    it("allows a customer without document and exposes the loyalty balance when the plan has crm.loyalty", async () => {
      const walkIn = await customers.create(scope, { fullName: "Cliente sin documento" });
      expect(walkIn).toMatchObject({ docType: null, docNumber: null, complement: null });
      await setPlan("PROFESIONAL");
      expect((await customers.detail(scope, walkIn.id)).loyaltyBalance).toBe(0);
    });

    it("validates input with INVALID_INPUT and the offending field", async () => {
      const cases: Array<[Record<string, unknown>, string]> = [
        [{ fullName: "  " }, "fullName"],
        [{ fullName: "x".repeat(161) }, "fullName"],
        [{ fullName: "Ana", docNumber: "123" }, "docType"],
        [{ fullName: "Ana", docType: "DNI", docNumber: "123" }, "docType"],
        [{ fullName: "Ana", docType: "CI" }, "docNumber"],
        [{ fullName: "Ana", docType: "CI", docNumber: "1234", complement: "ABCDE" }, "complement"],
        [{ fullName: "Ana", docType: "NIT", docNumber: "1234", complement: "1A" }, "complement"],
        [{ fullName: "Ana", email: "no-es-correo" }, "email"],
        [{ fullName: "Ana", phone: "x".repeat(31) }, "phone"],
        [{ fullName: "Ana", notes: "x".repeat(501) }, "notes"]
      ];
      for (const [input, field] of cases) {
        const { error, body } = await rejection(customers.create(scope, input as never));
        expect(error).toBeInstanceOf(BadRequestException);
        expect(body.code).toBe("INVALID_INPUT");
        expect(body.field).toBe(field);
      }
    });

    it("rejects a duplicated document with 409 CUSTOMER_DOCUMENT_EXISTS but allows the same number under another type", async () => {
      await customers.create(scope, { fullName: "Uno", docType: "CI", docNumber: "555" });
      const duplicate = await rejection(customers.create(scope, { fullName: "Dos", docType: "CI", docNumber: "555" }));
      expect(duplicate.error).toBeInstanceOf(ConflictException);
      expect(duplicate.body.code).toBe("CUSTOMER_DOCUMENT_EXISTS");
      await customers.create(scope, { fullName: "Tres", docType: "NIT", docNumber: "555" });
      // Another pharmacy may register the same document.
      await customers.create(otherScope, { fullName: "Otra farmacia", docType: "CI", docNumber: "555" });
    });

    it("updates fields partially, deactivates and detects document conflicts", async () => {
      const first = await customers.create(scope, { fullName: "Uno", docType: "CI", docNumber: "111", phone: "7" });
      const second = await customers.create(scope, { fullName: "Dos", docType: "CI", docNumber: "222" });
      const updated = await customers.update(scope, first.id, { fullName: "Uno Editado", isActive: false });
      expect(updated).toMatchObject({ fullName: "Uno Editado", isActive: false, docNumber: "111", phone: "7" });
      const cleared = await customers.update(scope, first.id, { phone: null, email: "uno@example.test" });
      expect(cleared).toMatchObject({ phone: null, email: "uno@example.test" });
      const clash = await rejection(customers.update(scope, second.id, { docType: "CI", docNumber: "111" }));
      expect(clash.body.code).toBe("CUSTOMER_DOCUMENT_EXISTS");
      const dropDoc = await customers.update(scope, second.id, { docType: null, docNumber: null });
      expect(dropDoc).toMatchObject({ docType: null, docNumber: null });
      const bad = await rejection(customers.update(scope, second.id, { fullName: "" }));
      expect(bad.body.code).toBe("INVALID_INPUT");
      expect((await rejection(customers.update(scope, id(900), { fullName: "X" }))).error).toBeInstanceOf(NotFoundException);
    });
  });

  describe("search and list", () => {
    beforeEach(async () => {
      await customers.create(scope, { fullName: "Maria Perez", docType: "CI", docNumber: "1000001" });
      await customers.create(scope, { fullName: "Mario Quispe", docType: "CI", docNumber: "2000002" });
      await customers.create(scope, { fullName: "Empresa Andina", docType: "NIT", docNumber: "10203040" });
      const inactive = await customers.create(scope, { fullName: "Pedro Inactivo" });
      await customers.update(scope, inactive.id, { isActive: false });
    });

    it("searches by name or document, case-insensitive, with paging", async () => {
      const byName = await customers.list(scope, { q: "mar" });
      expect(byName.items.map((c) => c.fullName)).toEqual(["Maria Perez", "Mario Quispe"]);
      expect(byName.total).toBe(2);
      const byDoc = await customers.list(scope, { q: "2000002" });
      expect(byDoc.items.map((c) => c.fullName)).toEqual(["Mario Quispe"]);
      const paged = await customers.list(scope, { limit: 2, offset: 2 });
      expect(paged).toMatchObject({ total: 4, limit: 2, offset: 2 });
      expect(paged.items).toHaveLength(2);
      const literal = await customers.list(scope, { q: "%" });
      expect(literal.total).toBe(0);
    });

    it("filters by active state and validates paging", async () => {
      expect((await customers.list(scope, { active: "true" })).total).toBe(3);
      expect((await customers.list(scope, { active: "false" })).items.map((c) => c.fullName)).toEqual(["Pedro Inactivo"]);
      for (const query of [{ limit: 0 }, { limit: 101 }, { offset: -1 }, { active: "maybe" }]) {
        const { error, body } = await rejection(customers.list(scope, query as never));
        expect(error).toBeInstanceOf(BadRequestException);
        expect(body.code).toBe("INVALID_INPUT");
      }
    });

    it("is tenant-wide across branches and isolated between pharmacies (RLS)", async () => {
      expect((await customers.list(branch2Scope, {})).total).toBe(4);
      expect((await customers.list(otherScope, {})).total).toBe(0);
      const mine = (await customers.list(scope, { q: "Andina" })).items[0]!;
      expect((await rejection(customers.detail(otherScope, mine.id))).error).toBeInstanceOf(NotFoundException);
      expect((await rejection(customers.update(otherScope, mine.id, { fullName: "Robado" }))).error).toBeInstanceOf(NotFoundException);
      const direct = await ownerPool.query("select count(*)::int as n from customers where tenant_id = $1", [tenantId]);
      expect(direct.rows[0].n).toBe(4);
    });
  });

  describe("purchase history", () => {
    it("lists the active branch sales net of returns, excluding voids from the summary", async () => {
      const customer = await customers.create(scope, { fullName: "Cliente Frecuente", docType: "CI", docNumber: "9" });
      const partial = await insertSale(customer.id, 100, { status: "PARTIALLY_RETURNED", daysAgo: 3 });
      await insertReturn(partial, 40);
      await insertSale(customer.id, 25, { status: "VOIDED", daysAgo: 2 });
      await insertSale(customer.id, 30, { daysAgo: 1 });
      await insertSale(customer.id, 77, { branch: "two" });
      await insertSale(null, 500);

      const history = await customers.purchases(scope, customer.id, {});
      expect(history.items.map((s) => [s.totalBob, s.refundedBob, s.netBob, s.status])).toEqual([
        ["30.0000", "0.0000", "30.0000", "CONFIRMED"],
        ["25.0000", "0.0000", "0.0000", "VOIDED"],
        ["100.0000", "40.0000", "60.0000", "PARTIALLY_RETURNED"]
      ]);
      expect(history.items[0]).toMatchObject({ number: expect.stringMatching(/^V-/), createdAt: expect.any(String) });
      expect(history.total).toBe(3);
      expect(history.summary).toEqual({ salesCount: 2, netTotalBob: "90.0000" });

      const north = await customers.purchases(branch2Scope, customer.id, {});
      expect(north.items.map((s) => s.totalBob)).toEqual(["77.0000"]);
      expect(north.summary).toEqual({ salesCount: 1, netTotalBob: "77.0000" });
    });

    it("pages, filters by date and rejects unknown customers", async () => {
      const customer = await customers.create(scope, { fullName: "Cliente" });
      for (let day = 0; day < 4; day += 1) await insertSale(customer.id, 10 + day, { daysAgo: day });
      expect((await customers.purchases(scope, customer.id, { limit: 2, offset: 0 })).items).toHaveLength(2);
      const today = new Date().toISOString().slice(0, 10);
      const recent = await customers.purchases(scope, customer.id, { from: today, to: today });
      expect(recent.total).toBeLessThanOrEqual(1);
      expect((await rejection(customers.purchases(scope, customer.id, { from: "nope" }))).body.code).toBe("INVALID_INPUT");
      expect((await rejection(customers.purchases(scope, id(901), {}))).error).toBeInstanceOf(NotFoundException);
      expect((await rejection(customers.purchases(otherScope, customer.id, {}))).error).toBeInstanceOf(NotFoundException);
    });
  });
});
