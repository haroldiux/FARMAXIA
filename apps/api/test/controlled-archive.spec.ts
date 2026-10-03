import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ControlledService } from "../src/controlled/controlled.service.js";
import { TenantDatabase, type TenantScope } from "../src/database/tenant-database.js";
import { systemRoles } from "../src/identity/role-templates.js";
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

const id = (suffix: number) => `00000000-0000-4000-8000-${String(910000 + suffix).padStart(12, "0")}`;
const tenantId = id(1);
const legalEntityId = id(2);
const branchId = id(11);
const branch2Id = id(12);
const userId = id(21);
const user2Id = id(22);
const warehouseId = id(31);
const warehouse2Id = id(32);
const controlledProductId = id(41);
const controlledPresentationId = id(42);
const otcProductId = id(43);
const otcPresentationId = id(44);
const batchId = id(51);
const batch2Id = id(52);
const otcBatchId = id(53);
const registerId = id(61);
const register2Id = id(62);
const shiftId = id(71);
const shift2Id = id(72);
const priceListId = id(91);
// Tenant B: exists only to prove tenant isolation of the archive.
const otherTenantId = id(101);
const otherLegalEntityId = id(102);
const otherBranchId = id(111);
const otherUserId = id(121);

const ownerPool = new Pool({ connectionString: testOwnerUrl });
const database = new TenantDatabase(testAppUrl);
const sales = new SalesService(database);
const controlled = new ControlledService(database);
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
const scope: TenantScope = { tenantId, userId, branchId };
const scope2: TenantScope = { tenantId, userId: user2Id, branchId: branch2Id };
const otherScope: TenantScope = { tenantId: otherTenantId, userId: otherUserId, branchId: otherBranchId };

const productName = 'Clonazepam "Rivotril", 2 mg';
const prescriptionData = {
  doctorName: "Dr. Juan Pérez",
  doctorLicense: "MP-12345",
  patientName: "Gómez; María\nLinea 2",
  patientDocument: "4567890",
  issuingCenter: "Hospital Obrero",
  prescribedAt: new Date().toISOString().slice(0, 10) // valid on every plan; rewritten below
};

async function setPlan(planCode: string): Promise<void> {
  await ownerPool.query("delete from tenant_subscriptions where tenant_id = $1", [tenantId]);
  const plan = await ownerPool.query<{ id: string }>("select id from subscription_plans where code = $1", [planCode]);
  await ownerPool.query(
    "insert into tenant_subscriptions (tenant_id, plan_id, status, starts_at) values ($1, $2, 'ACTIVE', now())",
    [tenantId, plan.rows[0]!.id]
  );
}

async function movement(
  warehouse: string,
  batch: string,
  type: string,
  direction: "IN" | "OUT",
  quantity: number,
  at: string,
  referenceType: string,
  referenceId: string
) {
  await ownerPool.query(
    `insert into inventory_movements
       (tenant_id, warehouse_id, batch_id, movement_type, movement_direction, quantity_base, reference_type, reference_id, occurred_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [tenantId, warehouse, batch, type, direction, quantity, referenceType, referenceId, at]
  );
}

async function seedPos(
  tenant: string,
  branch: string,
  code: string,
  user: string,
  warehouse: string,
  register: string,
  shift: string
) {
  await ownerPool.query("insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, $4, $4)", [branch, tenant, tenant === tenantId ? legalEntityId : otherLegalEntityId, code]);
  await ownerPool.query("insert into users (id, email, display_name, password_hash) values ($1, $2, $3, 'x')", [user, `${user}@example.test`, `Usuario ${code}`]);
  await ownerPool.query("insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $2, $3)", [user, tenant, branch]);
  await ownerPool.query("insert into warehouses (id, tenant_id, branch_id, name, warehouse_type) values ($1, $2, $3, $4, 'CENTRAL')", [warehouse, tenant, branch, `Almacén ${code}`]);
  await ownerPool.query("insert into cash_registers (id, tenant_id, branch_id, code, is_active) values ($1, $2, $3, 'CAJA-1', true)", [register, tenant, branch]);
  await ownerPool.query(
    `insert into cash_shifts (id, tenant_id, branch_id, cash_register_id, scheduled_start_at, scheduled_end_at, status, created_by_user_id)
     values ($1, $2, $3, $4, now() - interval '1 hour', now() + interval '8 hours', 'SCHEDULED', $5)`,
    [shift, tenant, branch, register, user]
  );
  await ownerPool.query("insert into cash_shift_users (tenant_id, branch_id, cash_shift_id, user_id) values ($1, $2, $3, $4)", [tenant, branch, shift, user]);
  await ownerPool.query(
    `insert into cash_shift_controls (tenant_id, branch_id, cash_shift_id, opening_amount_bob, expected_amount_bob, status, opened_by_user_id, opened_at)
     values ($1, $2, $3, '100.0000', '100.0000', 'OPEN', $4, now())`,
    [tenant, branch, shift, user]
  );
}

let saleSale1Id = "";
let saleSale2Id = "";

describe("F15 controlled archive, balance and book", () => {
  beforeAll(async () => {
    await migrate(drizzle(ownerPool), { migrationsFolder });
  });

  beforeEach(async () => {
    await ownerPool.query("truncate table tenants, users cascade");
    await ownerPool.query("insert into tenants (id, slug, name) values ($1, 'ctrl-book', 'Farmacia Libro'), ($2, 'ctrl-other', 'Otra Farmacia')", [tenantId, otherTenantId]);
    await ownerPool.query("insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $3, 'Farmacia Libro SRL', '7000911'), ($2, $4, 'Otra SRL', '7000912')", [legalEntityId, otherLegalEntityId, tenantId, otherTenantId]);
    await seedPos(tenantId, branchId, "MAIN", userId, warehouseId, registerId, shiftId);
    await seedPos(tenantId, branch2Id, "SUR", user2Id, warehouse2Id, register2Id, shift2Id);
    await ownerPool.query("insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, 'OTRA', 'Otra')", [otherBranchId, otherTenantId, otherLegalEntityId]);
    await ownerPool.query("insert into users (id, email, display_name, password_hash) values ($1, 'otra@example.test', 'Otra', 'x')", [otherUserId]);
    await ownerPool.query("insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $2, $3)", [otherUserId, otherTenantId, otherBranchId]);

    await ownerPool.query("insert into products (id, tenant_id, name, is_controlled) values ($1, $2, $3, true)", [controlledProductId, tenantId, productName]);
    await ownerPool.query("insert into products (id, tenant_id, name) values ($1, $2, 'Paracetamol 500 mg')", [otcProductId, tenantId]);
    await ownerPool.query("insert into product_presentations (id, tenant_id, product_id, name, base_unit_factor) values ($1, $2, $3, 'Caja x 10', 10), ($4, $2, $5, 'Caja x 10', 10)", [controlledPresentationId, tenantId, controlledProductId, otcPresentationId, otcProductId]);
    await ownerPool.query("insert into price_lists (id, tenant_id, name, currency) values ($1, $2, 'General', 'BOB')", [priceListId, tenantId]);
    await ownerPool.query(
      "insert into presentation_prices (tenant_id, price_list_id, presentation_id, amount, valid_from) values ($1, $2, $3, 12.5000, now() - interval '1 day'), ($1, $2, $4, 12.5000, now() - interval '1 day')",
      [tenantId, priceListId, controlledPresentationId, otcPresentationId]
    );
    await ownerPool.query(
      `insert into inventory_batches (id, tenant_id, presentation_id, lot_code, expires_on, unit_cost) values
         ($1, $4, $5, 'LOT-CTRL', current_date + 300, 5.0000),
         ($2, $4, $5, 'LOT-CTRL-SUR', current_date + 300, 5.0000),
         ($3, $4, $6, 'LOT-OTC', current_date + 300, 5.0000)`,
      [batchId, batch2Id, otcBatchId, tenantId, controlledPresentationId, otcPresentationId]
    );
    await ownerPool.query(
      `insert into inventory_balances (tenant_id, warehouse_id, batch_id, quantity_base, reserved_base) values
         ($1, $2, $3, 500, 0), ($1, $4, $5, 80, 0), ($1, $2, $6, 40, 0)`,
      [tenantId, warehouseId, batchId, warehouse2Id, batch2Id, otcBatchId]
    );
    await setPlan("PREMIUM");

    // Two real sales (with prescription) in the main branch and one in the south branch.
    const first = await sales.confirm(scope, {
      idempotencyKey: "arch-sale-1",
      cashShiftId: shiftId,
      warehouseId,
      paymentMethod: "CASH",
      paidAmountBob: "12.5000",
      lines: [{ presentationId: controlledPresentationId, quantity: 1 }],
      prescription: prescriptionData
    });
    const second = await sales.confirm(scope, {
      idempotencyKey: "arch-sale-2",
      cashShiftId: shiftId,
      warehouseId,
      paymentMethod: "CASH",
      paidAmountBob: "25.0000",
      lines: [{ presentationId: controlledPresentationId, quantity: 2 }],
      prescription: { ...prescriptionData, patientName: "Carlos Rojas", patientDocument: "9988776", doctorName: "Dra. Ana Soto" }
    });
    saleSale1Id = first.id;
    saleSale2Id = second.id;
    await sales.confirm(scope2, {
      idempotencyKey: "arch-sale-3",
      cashShiftId: shift2Id,
      warehouseId: warehouse2Id,
      paymentMethod: "CASH",
      paidAmountBob: "12.5000",
      lines: [{ presentationId: controlledPresentationId, quantity: 1 }],
      prescription: { ...prescriptionData, patientName: "Paciente Sur", patientDocument: "1112223" }
    });

    // Rewrite the ledger with a controlled history: Feb opening, a full March, an April entry.
    await ownerPool.query("delete from inventory_movements");
    await ownerPool.query("update controlled_prescriptions set created_at = '2026-03-05T12:00:00Z', prescribed_at = '2026-03-03' where sale_id = $1", [first.id]);
    await ownerPool.query("update controlled_prescriptions set created_at = '2026-03-20T12:00:00Z', prescribed_at = '2026-03-04' where sale_id = $1", [second.id]);
    await movement(warehouseId, batchId, "RECEIPT", "IN", 100, "2026-02-10T12:00:00Z", "GOODS_RECEIPT", id(81));
    await movement(warehouseId, batchId, "RECEIPT", "IN", 50, "2026-03-02T12:00:00Z", "GOODS_RECEIPT", id(82));
    await movement(warehouseId, batchId, "SALE", "OUT", 10, "2026-03-05T12:00:00Z", "SALE", first.id);
    await movement(warehouseId, batchId, "SALE_RETURN", "IN", 5, "2026-03-06T12:00:00Z", "SALE_RETURN", id(83));
    await movement(warehouseId, batchId, "TRANSFER_OUT", "OUT", 20, "2026-03-10T12:00:00Z", "transfer", id(84));
    await movement(warehouseId, batchId, "WASTE", "OUT", 3, "2026-03-12T12:00:00Z", "INVENTORY_WASTE", id(85));
    await movement(warehouseId, batchId, "ADJUSTMENT", "IN", 2, "2026-03-14T12:00:00Z", "INVENTORY_RECONCILIATION", id(86));
    await movement(warehouseId, batchId, "TRANSFER_IN", "IN", 10, "2026-03-15T12:00:00Z", "transfer", id(87));
    await movement(warehouseId, batchId, "SALE", "OUT", 20, "2026-03-20T12:00:00Z", "SALE", second.id);
    await movement(warehouseId, batchId, "RECEIPT", "IN", 7, "2026-04-05T12:00:00Z", "GOODS_RECEIPT", id(88));
    // Not controlled, and controlled but in another branch: both must stay out of the book.
    await movement(warehouseId, otcBatchId, "RECEIPT", "IN", 40, "2026-03-02T12:00:00Z", "GOODS_RECEIPT", id(89));
    await movement(warehouse2Id, batch2Id, "RECEIPT", "IN", 80, "2026-03-02T12:00:00Z", "GOODS_RECEIPT", id(90));
    // March closing: 100 + (50+5+2+10) - (10+3+20+20) = 114; April adds 7 => 121 = live balance.
    await ownerPool.query("update inventory_balances set quantity_base = 121 where warehouse_id = $1 and batch_id = $2", [warehouseId, batchId]);
  });

  afterAll(async () => {
    await database.close();
    await ownerPool.end();
  });

  it("lists the branch archive newest first with sale number and dispensed items", async () => {
    const result = await controlled.listPrescriptions(scope, {});
    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.folio)).toEqual(["R-MAIN-000002", "R-MAIN-000001"]);
    const newest = result.items[0]!;
    expect(newest).toMatchObject({
      saleId: saleSale2Id,
      doctorName: "Dra. Ana Soto",
      patientDocument: "9988776",
      issuingCenter: "Hospital Obrero",
      prescribedAt: "2026-03-04"
    });
    expect(newest.saleNumber).toMatch(/^V-MAIN-/);
    expect(newest.items).toEqual([
      expect.objectContaining({
        productName,
        presentationName: "Caja x 10",
        quantity: 2,
        quantityBase: 20,
        isControlled: true,
        lots: [{ lotCode: "LOT-CTRL", quantityBase: 20 }]
      })
    ]);
  });

  it("filters the archive by text and date range and paginates", async () => {
    expect((await controlled.listPrescriptions(scope, { q: "rojas" })).items.map((item) => item.folio)).toEqual(["R-MAIN-000002"]);
    expect((await controlled.listPrescriptions(scope, { q: "R-MAIN-000001" })).items).toHaveLength(1);
    expect((await controlled.listPrescriptions(scope, { q: "nadie" })).total).toBe(0);
    expect((await controlled.listPrescriptions(scope, { from: "2026-03-10", to: "2026-03-31" })).items.map((item) => item.folio)).toEqual(["R-MAIN-000002"]);
    const page = await controlled.listPrescriptions(scope, { limit: 1, offset: 1 });
    expect(page.total).toBe(2);
    expect(page.items.map((item) => item.folio)).toEqual(["R-MAIN-000001"]);
    await expect(controlled.listPrescriptions(scope, { from: "ayer" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controlled.listPrescriptions(scope, { limit: 1000 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("returns a prescription detail and keeps branches and tenants isolated (RLS)", async () => {
    const list = await controlled.listPrescriptions(scope, {});
    const detail = await controlled.prescriptionDetail(scope, list.items[1]!.id);
    expect(detail.folio).toBe("R-MAIN-000001");
    expect(detail.patientName).toBe(prescriptionData.patientName);

    const south = await controlled.listPrescriptions(scope2, {});
    expect(south.items.map((item) => item.folio)).toEqual(["R-SUR-000001"]);
    expect((await controlled.listPrescriptions(otherScope, {})).total).toBe(0);
    await expect(controlled.prescriptionDetail(scope2, detail.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(controlled.prescriptionDetail(otherScope, detail.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(controlled.prescriptionDetail(scope, "no-es-uuid")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("computes the monthly balance with the movement-type breakdown and balances to zero error", async () => {
    const march = await controlled.balance(scope, "2026-03");
    expect(march.month).toBe("2026-03");
    expect(march.items).toHaveLength(1);
    const item = march.items[0]!;
    expect(item).toMatchObject({ productId: controlledProductId, productName, openingBase: 100, closingBase: 114 });
    expect(item.presentations).toEqual([expect.objectContaining({ name: "Caja x 10", baseUnitFactor: 10 })]);
    expect(item.entries.total).toBe(67);
    expect(item.entries.byType).toEqual({ RECEIPT: 50, SALE_RETURN: 5, ADJUSTMENT: 2, TRANSFER_IN: 10 });
    expect(item.exits.total).toBe(53);
    expect(item.exits.byType).toEqual({ SALE: 30, TRANSFER_OUT: 20, WASTE: 3 });
    expect(item.openingBase + item.entries.total - item.exits.total).toBe(item.closingBase);
  });

  it("matches the live inventory_balances at the end of the last month with movements", async () => {
    const april = await controlled.balance(scope, "2026-04");
    const item = april.items[0]!;
    expect(item.openingBase).toBe(114);
    expect(item.closingBase).toBe(121);
    const live = await ownerPool.query(
      "select sum(quantity_base)::int as total from inventory_balances where tenant_id = $1 and warehouse_id = $2 and batch_id = $3",
      [tenantId, warehouseId, batchId]
    );
    expect(item.closingBase).toBe(live.rows[0].total);
    expect(item.currentStockBase).toBe(live.rows[0].total);
    // A month before any movement has nothing to report.
    expect((await controlled.balance(scope, "2026-01")).items).toEqual([]);
  });

  it("lists book lines chronologically with sequential folios, running balance and references", async () => {
    const book = await controlled.book(scope, "2026-03");
    expect(book.openings).toEqual([expect.objectContaining({ productId: controlledProductId, openingBase: 100 })]);
    expect(book.lines.map((line) => line.folio)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(book.lines.map((line) => line.movementType)).toEqual([
      "RECEIPT", "SALE", "SALE_RETURN", "TRANSFER_OUT", "WASTE", "ADJUSTMENT", "TRANSFER_IN", "SALE"
    ]);
    expect(book.lines.map((line) => line.balanceBase)).toEqual([150, 140, 145, 125, 122, 124, 134, 114]);
    expect(book.lines.map((line) => [line.quantityIn, line.quantityOut])).toEqual([
      [50, 0], [0, 10], [5, 0], [0, 20], [0, 3], [2, 0], [10, 0], [0, 20]
    ]);
    expect(book.lines.at(-1)!.balanceBase).toBe((await controlled.balance(scope, "2026-03")).items[0]!.closingBase);

    const firstSale = book.lines[1]!;
    expect(firstSale.date).toBe("2026-03-05");
    expect(firstSale.lotCode).toBe("LOT-CTRL");
    expect(firstSale.document).toMatchObject({ type: "SALE" });
    expect(firstSale.document.number).toMatch(/^V-MAIN-/);
    expect(firstSale.prescription).toMatchObject({
      folio: "R-MAIN-000001",
      doctorName: "Dr. Juan Pérez",
      patientName: prescriptionData.patientName,
      patientDocument: "4567890"
    });
    expect(book.lines[0]!.prescription).toBeNull();
  });

  it("exports the book as CSV with BOM, header and RFC 4180 escaping", async () => {
    const exported = await controlled.exportBookCsv(scope, "2026-03");
    expect(exported.filename).toBe("libro-controlados-2026-03.csv");
    expect(exported.csv.startsWith("﻿")).toBe(true);
    const body = exported.csv.slice(1);
    const header = body.split("\r\n")[0]!;
    expect(header).toBe(
      "Folio,Fecha,Producto,Presentacion,Lote,Movimiento,Entrada (base),Salida (base),Saldo (base),Documento,Receta,Medico,Matricula,Paciente,Documento paciente"
    );
    // Commas and double quotes inside the product name are quoted and doubled.
    expect(body).toContain('"Clonazepam ""Rivotril"", 2 mg"');
    // Semicolons and line breaks inside the patient name stay in one quoted cell.
    expect(body).toContain('"Gómez; María\nLinea 2"');
    expect(body.split("\r\n").filter((row) => row.length > 0).length).toBeGreaterThanOrEqual(9);
  });

  it("gates balance, book and export behind controlled.book, but not the archive (controlled.manual)", async () => {
    for (const plan of ["BASICO", "PROFESIONAL"]) {
      await setPlan(plan);
      expect((await controlled.listPrescriptions(scope, {})).total).toBe(2);
      for (const call of [
        () => controlled.balance(scope, "2026-03"),
        () => controlled.book(scope, "2026-03"),
        () => controlled.exportBookCsv(scope, "2026-03")
      ]) {
        const error = await call().then(
          () => null,
          (caught: unknown) => caught
        );
        expect(error).toBeInstanceOf(ForbiddenException);
        expect((error as ForbiddenException).getResponse()).toMatchObject({ code: "PLAN_FEATURE_RESTRICTED", feature: "controlled.book" });
      }
    }
  });

  it("rejects an invalid month", async () => {
    for (const month of ["", "2026-13", "2026-3", "marzo", undefined]) {
      await expect(controlled.balance(scope, month as string)).rejects.toBeInstanceOf(BadRequestException);
      await expect(controlled.book(scope, month as string)).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it("assigns the permissions to owner and regente (both), encargado (read only) and nobody else", () => {
    const holders = (code: string) =>
      systemRoles.filter((role) => (role.permissions as readonly string[]).includes(code)).map((role) => role.code).sort();
    expect(holders("controlled.read")).toEqual(["encargado", "owner", "regente"]);
    expect(holders("controlled.book.export")).toEqual(["owner", "regente"]);
  });
});
