import { BadRequestException } from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TenantDatabase, type TenantScope } from "../src/database/tenant-database.js";
import { SalesService, type ConfirmSaleInput } from "../src/sales/sales.service.js";

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

const tenantId = "00000000-0000-4000-8000-000000009001";
const legalEntityId = "00000000-0000-4000-8000-000000009002";
const branchId = "00000000-0000-4000-8000-000000009011";
const userId = "00000000-0000-4000-8000-000000009021";
const warehouseId = "00000000-0000-4000-8000-000000009031";
const controlledProductId = "00000000-0000-4000-8000-000000009041";
const controlledPresentationId = "00000000-0000-4000-8000-000000009042";
const otcProductId = "00000000-0000-4000-8000-000000009043";
const otcPresentationId = "00000000-0000-4000-8000-000000009044";
const categoryId = "00000000-0000-4000-8000-000000009045";
const batchControlledId = "00000000-0000-4000-8000-000000009051";
const batchOtcId = "00000000-0000-4000-8000-000000009052";
const registerId = "00000000-0000-4000-8000-000000009061";
const shiftId = "00000000-0000-4000-8000-000000009071";
const controlId = "00000000-0000-4000-8000-000000009081";
const priceListId = "00000000-0000-4000-8000-000000009091";

const ownerPool = new Pool({ connectionString: testOwnerUrl });
const database = new TenantDatabase(testAppUrl);
const sales = new SalesService(database);
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
const scope: TenantScope = { tenantId, userId, branchId };

function isoDay(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

const prescription = () => ({
  doctorName: "Dr. Juan Pérez",
  doctorLicense: "MP-12345",
  patientName: "María Gómez",
  patientDocument: "4567890",
  issuingCenter: "Hospital Obrero",
  prescribedAt: isoDay(-2),
  notes: "Uso crónico"
});

let counter = 0;
function saleInput(presentationId: string, extra: Partial<ConfirmSaleInput> = {}): ConfirmSaleInput {
  counter += 1;
  return {
    idempotencyKey: `controlled-sale-${counter}`,
    cashShiftId: shiftId,
    warehouseId,
    paymentMethod: "CASH",
    paidAmountBob: "12.5000",
    lines: [{ presentationId, quantity: 1, unitPriceBob: "12.5000" }],
    ...extra
  };
}

async function setPlan(planCode: string): Promise<void> {
  await ownerPool.query("delete from tenant_subscriptions where tenant_id = $1", [tenantId]);
  const plan = await ownerPool.query<{ id: string }>("select id from subscription_plans where code = $1", [planCode]);
  await ownerPool.query(
    "insert into tenant_subscriptions (tenant_id, plan_id, status, starts_at) values ($1, $2, 'ACTIVE', now())",
    [tenantId, plan.rows[0]!.id]
  );
}

async function expectRejection(promise: Promise<unknown>, code: string, field?: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(BadRequestException);
  const body = (error as BadRequestException).getResponse() as { code: string; field?: string };
  expect(body.code).toBe(code);
  if (field) expect(body.field).toBe(field);
}

describe("F15 controlled prescriptions on sale confirmation", () => {
  beforeAll(async () => {
    await migrate(drizzle(ownerPool), { migrationsFolder });
  });

  beforeEach(async () => {
    await ownerPool.query("truncate table tenants, users cascade");
    await ownerPool.query("insert into tenants (id, slug, name) values ($1, 'ctrl-rx', 'Farmacia Controlados')", [tenantId]);
    await ownerPool.query("insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, 'Farmacia Controlados SRL', '7000901')", [legalEntityId, tenantId]);
    await ownerPool.query("insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, 'MAIN', 'Central')", [branchId, tenantId, legalEntityId]);
    await ownerPool.query("insert into users (id, email, display_name, password_hash) values ($1, 'ctrl-cajero@example.test', 'Cajero', 'x')", [userId]);
    await ownerPool.query("insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $2, $3)", [userId, tenantId, branchId]);
    await ownerPool.query("insert into warehouses (id, tenant_id, branch_id, name, warehouse_type) values ($1, $2, $3, 'Central', 'CENTRAL')", [warehouseId, tenantId, branchId]);
    await ownerPool.query("insert into product_categories (id, tenant_id, name) values ($1, $2, 'Psicotrópicos')", [categoryId, tenantId]);
    await ownerPool.query("insert into products (id, tenant_id, name, is_controlled) values ($1, $2, 'Clonazepam 2 mg', true)", [controlledProductId, tenantId]);
    await ownerPool.query("insert into products (id, tenant_id, name) values ($1, $2, 'Paracetamol 500 mg')", [otcProductId, tenantId]);
    await ownerPool.query("insert into product_presentations (id, tenant_id, product_id, name, base_unit_factor) values ($1, $2, $3, 'Caja x 30', 30)", [controlledPresentationId, tenantId, controlledProductId]);
    await ownerPool.query("insert into product_presentations (id, tenant_id, product_id, name, base_unit_factor) values ($1, $2, $3, 'Caja x 10', 10)", [otcPresentationId, tenantId, otcProductId]);
    await ownerPool.query("insert into price_lists (id, tenant_id, name, currency) values ($1, $2, 'General', 'BOB')", [priceListId, tenantId]);
    await ownerPool.query(
      "insert into presentation_prices (tenant_id, price_list_id, presentation_id, amount, valid_from) values ($1, $2, $3, 12.5000, now() - interval '1 day'), ($1, $2, $4, 12.5000, now() - interval '1 day')",
      [tenantId, priceListId, controlledPresentationId, otcPresentationId]
    );
    await ownerPool.query(
      `insert into inventory_batches (id, tenant_id, presentation_id, lot_code, expires_on, unit_cost) values
         ($1, $3, $4, 'LOT-CTRL', current_date + 200, 5.0000),
         ($2, $3, $5, 'LOT-OTC', current_date + 200, 5.0000)`,
      [batchControlledId, batchOtcId, tenantId, controlledPresentationId, otcPresentationId]
    );
    await ownerPool.query(
      `insert into inventory_balances (tenant_id, warehouse_id, batch_id, quantity_base, reserved_base)
       values ($1, $2, $3, 300, 0), ($1, $2, $4, 100, 0)`,
      [tenantId, warehouseId, batchControlledId, batchOtcId]
    );
    await ownerPool.query("insert into cash_registers (id, tenant_id, branch_id, code, is_active) values ($1, $2, $3, 'CAJA-1', true)", [registerId, tenantId, branchId]);
    await ownerPool.query(
      `insert into cash_shifts (id, tenant_id, branch_id, cash_register_id, scheduled_start_at, scheduled_end_at, status, created_by_user_id)
       values ($1, $2, $3, $4, now() - interval '1 hour', now() + interval '8 hours', 'SCHEDULED', $5)`,
      [shiftId, tenantId, branchId, registerId, userId]
    );
    await ownerPool.query("insert into cash_shift_users (tenant_id, branch_id, cash_shift_id, user_id) values ($1, $2, $3, $4)", [tenantId, branchId, shiftId, userId]);
    await ownerPool.query(
      `insert into cash_shift_controls (id, tenant_id, branch_id, cash_shift_id, opening_amount_bob, expected_amount_bob, status, opened_by_user_id, opened_at)
       values ($1, $2, $3, $4, '100.0000', '100.0000', 'OPEN', $5, now())`,
      [controlId, tenantId, branchId, shiftId, userId]
    );
    await setPlan("BASICO");
  });

  afterAll(async () => {
    await database.close();
    await ownerPool.end();
  });

  const countSales = async () => Number((await ownerPool.query("select count(*)::int as n from sales")).rows[0].n);
  const countPrescriptions = async () =>
    Number((await ownerPool.query("select count(*)::int as n from controlled_prescriptions")).rows[0].n);

  it("refuses a controlled product without prescription and persists nothing", async () => {
    const error = await sales.confirm(scope, saleInput(controlledPresentationId)).then(
      () => null,
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({ code: "PRESCRIPTION_REQUIRED" });
    expect(await countSales()).toBe(0);
    expect(await countPrescriptions()).toBe(0);
    const stock = await ownerPool.query("select sum(quantity_base)::text as total from inventory_balances where batch_id = $1", [batchControlledId]);
    expect(stock.rows[0].total).toBe("300");
  });

  it("also requires a prescription when only the category is controlled", async () => {
    await ownerPool.query("update products set category_id = $2 where id = $1", [otcProductId, categoryId]);
    await ownerPool.query("update product_categories set is_controlled = true where id = $1", [categoryId]);
    await expectRejection(sales.confirm(scope, saleInput(otcPresentationId)), "PRESCRIPTION_REQUIRED");
    expect(await countSales()).toBe(0);
  });

  it("also requires a prescription when the product is classified CONTROLLED", async () => {
    await ownerPool.query("update products set sale_classification = 'CONTROLLED', is_controlled = true where id = $1", [otcProductId]);
    await expectRejection(sales.confirm(scope, saleInput(otcPresentationId)), "PRESCRIPTION_REQUIRED");
    expect(await countSales()).toBe(0);
  });

  it("records the sale and an immutable prescription in one transaction with sequential branch folios", async () => {
    const first = await sales.confirm(scope, saleInput(controlledPresentationId, { prescription: prescription() }));
    expect(first.status).toBe("CONFIRMED");
    expect(first.prescription).toMatchObject({ folio: "R-MAIN-000001" });
    const second = await sales.confirm(scope, saleInput(controlledPresentationId, { prescription: prescription() }));
    expect(second.prescription?.folio).toBe("R-MAIN-000002");

    const rows = await ownerPool.query(
      `select sale_id, folio, doctor_name, doctor_license, patient_name, patient_document, issuing_center,
              to_char(prescribed_at, 'YYYY-MM-DD') as prescribed_at, notes, created_by_user_id
       from controlled_prescriptions order by folio`
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]).toMatchObject({
      sale_id: first.id,
      folio: "R-MAIN-000001",
      doctor_name: "Dr. Juan Pérez",
      doctor_license: "MP-12345",
      patient_name: "María Gómez",
      patient_document: "4567890",
      issuing_center: "Hospital Obrero",
      prescribed_at: isoDay(-2),
      notes: "Uso crónico",
      created_by_user_id: userId
    });
    const audit = await ownerPool.query("select entity_id from audit_events where action = 'controlled.prescription_recorded'");
    expect(audit.rows.map((row) => row.entity_id).sort()).toEqual([first.id, second.id].sort());
  });

  it("validates the required prescription fields with INVALID_INPUT and persists nothing", async () => {
    for (const field of ["doctorName", "doctorLicense", "patientName", "patientDocument", "issuingCenter", "prescribedAt"] as const) {
      await expectRejection(
        sales.confirm(scope, saleInput(controlledPresentationId, { prescription: { ...prescription(), [field]: "   " } })),
        "INVALID_INPUT",
        field
      );
    }
    await expectRejection(
      sales.confirm(scope, saleInput(controlledPresentationId, { prescription: { ...prescription(), prescribedAt: "2026-02-30" } })),
      "INVALID_INPUT",
      "prescribedAt"
    );
    expect(await countSales()).toBe(0);
  });

  it("ignores a prescription sent with a sale that has no controlled product", async () => {
    const sale = await sales.confirm(scope, saleInput(otcPresentationId, { prescription: prescription() }));
    expect(sale.status).toBe("CONFIRMED");
    expect(sale.prescription).toBeNull();
    expect(await countPrescriptions()).toBe(0);
  });

  it("replays an idempotent confirmation without a second prescription", async () => {
    const input = saleInput(controlledPresentationId, { prescription: prescription() });
    const first = await sales.confirm(scope, input);
    const replay = await sales.confirm(scope, input);
    expect(replay.id).toBe(first.id);
    expect(replay.prescription?.folio).toBe(first.prescription?.folio);
    expect(await countPrescriptions()).toBe(1);
    expect(await countSales()).toBe(1);
  });

  it("applies the stricter assisted rules only on plans with controlled.assisted (D60: 30 days)", async () => {
    // BASICO (manual capture): an old date and a loose license are accepted.
    const manual = await sales.confirm(
      scope,
      saleInput(controlledPresentationId, { prescription: { ...prescription(), prescribedAt: isoDay(-90), doctorLicense: "A" } })
    );
    expect(manual.prescription).not.toBeNull();

    await setPlan("PROFESIONAL");
    const assisted = (patch: Record<string, string>) =>
      sales.confirm(scope, saleInput(controlledPresentationId, { prescription: { ...prescription(), ...patch } }));
    await expectRejection(assisted({ prescribedAt: isoDay(2) }), "INVALID_INPUT", "prescribedAt");
    await expectRejection(assisted({ prescribedAt: isoDay(-31) }), "INVALID_INPUT", "prescribedAt");
    await expectRejection(assisted({ doctorLicense: "A" }), "INVALID_INPUT", "doctorLicense");
    await expectRejection(assisted({ doctorLicense: "MP 123/45" }), "INVALID_INPUT", "doctorLicense");
    await expectRejection(assisted({ patientDocument: "!!" }), "INVALID_INPUT", "patientDocument");
    expect((await assisted({ prescribedAt: isoDay(-30) })).prescription).not.toBeNull();
    expect((await assisted({ prescribedAt: isoDay(0) })).prescription).not.toBeNull();
  });

  it("exposes isControlled in the POS lookup", async () => {
    const result = await sales.lookup(scope, { q: "a", warehouseId, limit: 50 });
    const byId = new Map(result.items.map((item) => [item.presentationId, item.isControlled]));
    expect(byId.get(controlledPresentationId)).toBe(true);
    expect(byId.get(otcPresentationId)).toBe(false);
  });

  it("does not let the application role update or delete a recorded prescription", async () => {
    await sales.confirm(scope, saleInput(controlledPresentationId, { prescription: prescription() }));
    await expect(
      database.withScope(scope, (client) => client.query("update controlled_prescriptions set doctor_name = 'X'"))
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      database.withScope(scope, (client) => client.query("delete from controlled_prescriptions"))
    ).rejects.toMatchObject({ code: "42501" });
  });
});
