import { NotFoundException } from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TenantDatabase, type TenantScope } from "../src/database/tenant-database.js";
import { FiscalController } from "../src/fiscal/fiscal.controller.js";
import { FiscalService } from "../src/fiscal/fiscal.service.js";
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

const tenantId = "00000000-0000-4000-8000-000000006001";
const legalEntityId = "00000000-0000-4000-8000-000000006002";
const branchId = "00000000-0000-4000-8000-000000006011";
const otherBranchId = "00000000-0000-4000-8000-000000006012";
const userId = "00000000-0000-4000-8000-000000006021";
const warehouseId = "00000000-0000-4000-8000-000000006031";
const productId = "00000000-0000-4000-8000-000000006041";
const presentationId = "00000000-0000-4000-8000-000000006042";
const batchId = "00000000-0000-4000-8000-000000006051";
const registerId = "00000000-0000-4000-8000-000000006061";
const shiftId = "00000000-0000-4000-8000-000000006071";
const controlId = "00000000-0000-4000-8000-000000006081";

const ownerPool = new Pool({ connectionString: testOwnerUrl });
const database = new TenantDatabase(testAppUrl);
const sales = new SalesService(database);
const fiscalService = new FiscalService(database);
const fiscalController = new FiscalController(fiscalService);
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
const scope: TenantScope = { tenantId, userId, branchId };

function requestFor(auth: TenantScope) {
  return { auth } as never;
}

/**
 * F13: the fiscal invoice scaffold (port + data model + StubFiscalProvider). Confirms that every
 * confirmed sale gets a PENDING_PROVIDER fiscal_invoices draft row in the same transaction (D51),
 * that the stub never fabricates a CUF or reports ISSUED (D52), and that the read endpoint respects
 * tenant/branch isolation (RLS).
 */
describe("F13 fiscal invoice scaffold", () => {
  beforeAll(async () => {
    await migrate(drizzle(ownerPool), { migrationsFolder });
  });

  beforeEach(async () => {
    await ownerPool.query("truncate table tenants, users cascade");
    await ownerPool.query("insert into tenants (id, slug, name) values ($1, 'fiscal-pharmacy', 'Farmacia Fiscal')", [tenantId]);
    await ownerPool.query("insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, 'Farmacia Fiscal SRL', '7000601')", [legalEntityId, tenantId]);
    await ownerPool.query("insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, 'MAIN', 'Central')", [branchId, tenantId, legalEntityId]);
    await ownerPool.query("insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, 'OTHER', 'Otra sucursal')", [otherBranchId, tenantId, legalEntityId]);
    await ownerPool.query("insert into users (id, email, display_name, password_hash) values ($1, 'cajero-fiscal@example.test', 'Cajero', 'x')", [userId]);
    await ownerPool.query("insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $2, $3)", [userId, tenantId, branchId]);
    await ownerPool.query("insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $2, $3)", [userId, tenantId, otherBranchId]);
    await ownerPool.query("insert into warehouses (id, tenant_id, branch_id, name, warehouse_type) values ($1, $2, $3, 'Central', 'CENTRAL')", [warehouseId, tenantId, branchId]);
    await ownerPool.query("insert into products (id, tenant_id, name) values ($1, $2, 'Amoxicilina 500 mg')", [productId, tenantId]);
    await ownerPool.query(
      "insert into product_presentations (id, tenant_id, product_id, name, base_unit_factor) values ($1, $2, $3, 'Caja x 10', 10)",
      [presentationId, tenantId, productId]
    );
    await ownerPool.query("insert into price_lists (id, tenant_id, name, currency) values ($1, $2, 'General', 'BOB')", ["00000000-0000-4000-8000-0000000006f0", tenantId]);
    await ownerPool.query(
      "insert into presentation_prices (tenant_id, price_list_id, presentation_id, amount, valid_from) values ($1, $2, $3, 20.0000, now() - interval '1 day')",
      [tenantId, "00000000-0000-4000-8000-0000000006f0", presentationId]
    );
    await ownerPool.query(
      "insert into inventory_batches (id, tenant_id, presentation_id, lot_code, expires_on, unit_cost) values ($1, $2, $3, 'LOT-F13', current_date + 90, 8.0000)",
      [batchId, tenantId, presentationId]
    );
    await ownerPool.query(
      "insert into inventory_balances (tenant_id, warehouse_id, batch_id, quantity_base, reserved_base) values ($1, $2, $3, 50, 0)",
      [tenantId, warehouseId, batchId]
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
  });

  afterAll(async () => {
    await database.close();
    await ownerPool.end();
  });

  it("creates a PENDING_PROVIDER fiscal invoice draft for the confirmed sale, in the same transaction (T2/D51)", async () => {
    const sale = await sales.confirm(scope, {
      idempotencyKey: "fiscal-sale-001",
      cashShiftId: shiftId,
      warehouseId,
      paymentMethod: "CASH",
      paidAmountBob: "60.0000",
      lines: [{ presentationId, quantity: 3, unitPriceBob: "20.0000" }]
    });

    const rows = await ownerPool.query<{
      status: string;
      cuf: string | null;
      cufd: string | null;
      provider_name: string;
      error_message: string | null;
    }>(
      `select status, cuf, cufd, provider_name, error_message from fiscal_invoices
       where tenant_id = $1 and branch_id = $2 and sale_id = $3`,
      [tenantId, branchId, sale.id]
    );
    expect(rows.rows).toEqual([
      { status: "PENDING_PROVIDER", cuf: null, cufd: null, provider_name: "stub", error_message: null }
    ]);
  });

  it("never fabricates a CUF nor reports ISSUED, by design (D52)", async () => {
    const sale = await sales.confirm(scope, {
      idempotencyKey: "fiscal-sale-002",
      cashShiftId: shiftId,
      warehouseId,
      paymentMethod: "CASH",
      paidAmountBob: "20.0000",
      lines: [{ presentationId, quantity: 1, unitPriceBob: "20.0000" }]
    });
    const summary = await fiscalService.getBySaleId(scope, sale.id);
    expect(summary.status).toBe("PENDING_PROVIDER");
    expect(summary.cuf).toBeNull();
    expect(summary.status).not.toBe("ISSUED");
  });

  it("exposes the fiscal invoice status through GET /api/v1/fiscal/invoices/:saleId (T3)", async () => {
    const sale = await sales.confirm(scope, {
      idempotencyKey: "fiscal-sale-003",
      cashShiftId: shiftId,
      warehouseId,
      paymentMethod: "CASH",
      paidAmountBob: "40.0000",
      lines: [{ presentationId, quantity: 2, unitPriceBob: "20.0000" }]
    });

    const response = await fiscalController.get(requestFor(scope), sale.id);
    expect(response).toMatchObject({
      saleId: sale.id,
      status: "PENDING_PROVIDER",
      cuf: null,
      providerName: "stub"
    });
  });

  it("raises NotFoundException for a sale with no fiscal invoice and preserves branch isolation (RLS)", async () => {
    await expect(fiscalService.getBySaleId(scope, "00000000-0000-4000-8000-000000009999")).rejects.toBeInstanceOf(
      NotFoundException
    );

    const sale = await sales.confirm(scope, {
      idempotencyKey: "fiscal-sale-004",
      cashShiftId: shiftId,
      warehouseId,
      paymentMethod: "CASH",
      paidAmountBob: "20.0000",
      lines: [{ presentationId, quantity: 1, unitPriceBob: "20.0000" }]
    });

    await expect(
      fiscalService.getBySaleId({ ...scope, branchId: otherBranchId }, sale.id)
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
