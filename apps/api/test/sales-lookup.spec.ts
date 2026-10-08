import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TenantDatabase, type TenantScope } from "../src/database/tenant-database.js";
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

const id = (n: number) => `00000000-0000-4000-8000-0000000063${String(n).padStart(2, "0")}`;
const tenantId = id(1);
const legalEntityId = id(2);
const branchId = id(3);
const branch2Id = id(4);
const userId = id(10);
const warehouseId = id(20);
const warehouse2Id = id(21); // other branch of the same tenant
const paraId = id(30);
const ibuId = id(31);
const inactiveProductId = id(32);
const paraBoxId = id(40); // Caja x 10 (factor 10)
const paraBlisterId = id(41); // Blister x 2 (factor 2), not sellable
const ibuBoxId = id(42);
const inactiveBoxId = id(43);
const otherTenantId = id(70);
const otherLegalEntityId = id(71);
const otherBranchId = id(72);
const otherUserId = id(73);
const otherProductId = id(74);
const otherPresentationId = id(75);
const otherWarehouseId = id(76);

const ownerPool = new Pool({ connectionString: testOwnerUrl });
const database = new TenantDatabase(testAppUrl);
const sales = new SalesService(database);
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
const scope: TenantScope = { tenantId, userId, branchId };

describe("Module 5 T3 POS lookup", () => {
  beforeAll(async () => {
    await migrate(drizzle(ownerPool), { migrationsFolder });
  });

  beforeEach(async () => {
    await ownerPool.query("truncate table tenants, users cascade");
    await ownerPool.query(
      "insert into tenants (id, slug, name) values ($1, 'look-pharmacy', 'Farmacia Lookup'), ($2, 'look-other', 'Otra')",
      [tenantId, otherTenantId]
    );
    await ownerPool.query(
      "insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, 'Lookup SRL', '7000701'), ($3, $4, 'Otra SRL', '7000702')",
      [legalEntityId, tenantId, otherLegalEntityId, otherTenantId]
    );
    await ownerPool.query(
      `insert into branches (id, tenant_id, legal_entity_id, code, name) values
         ($1, $2, $3, 'MAIN', 'Central'), ($4, $2, $3, 'NORTH', 'Norte'), ($5, $6, $7, 'MAIN', 'Otra Central')`,
      [branchId, tenantId, legalEntityId, branch2Id, otherBranchId, otherTenantId, otherLegalEntityId]
    );
    await ownerPool.query(
      "insert into users (id, email, display_name, password_hash) values ($1, 'look1@example.test', 'Cajero', 'x'), ($2, 'look2@example.test', 'Otro', 'x')",
      [userId, otherUserId]
    );
    await ownerPool.query(
      "insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $3, $4), ($2, $5, $6)",
      [userId, otherUserId, tenantId, branchId, otherTenantId, otherBranchId]
    );
    await ownerPool.query(
      `insert into warehouses (id, tenant_id, branch_id, name, warehouse_type) values
         ($1, $4, $5, 'Central', 'CENTRAL'), ($2, $4, $6, 'Norte', 'CENTRAL'), ($3, $7, $8, 'Otra', 'CENTRAL')`,
      [warehouseId, warehouse2Id, otherWarehouseId, tenantId, branchId, branch2Id, otherTenantId, otherBranchId]
    );
    await ownerPool.query(
      `insert into products (id, tenant_id, name, generic_name, active_ingredient, laboratory, is_active) values
         ($1, $4, 'Panadol Forte', 'Paracetamol', 'Acetaminofeno', 'GSK', true),
         ($2, $4, 'Ibupirac', 'Ibuprofeno', 'Ibuprofeno', 'Bago', true),
         ($3, $4, 'Descontinuado', 'Paracetamol', 'Acetaminofeno', 'GSK', false),
         ($5, $6, 'Panadol Ajeno', 'Paracetamol', 'Acetaminofeno', 'GSK', true)`,
      [paraId, ibuId, inactiveProductId, tenantId, otherProductId, otherTenantId]
    );
    await ownerPool.query(
      `insert into product_presentations (id, tenant_id, product_id, name, base_unit_factor, is_sellable) values
         ($1, $6, $4, 'Caja x 10', 10, true),
         ($2, $6, $4, 'Blister x 2', 2, false),
         ($3, $6, $5, 'Caja x 20', 20, true),
         ($7, $6, $8, 'Caja x 10', 10, true),
         ($9, $10, $11, 'Caja x 10', 10, true)`,
      [paraBoxId, paraBlisterId, ibuBoxId, paraId, ibuId, tenantId, inactiveBoxId, inactiveProductId, otherPresentationId, otherTenantId, otherProductId]
    );
    await ownerPool.query(
      "insert into product_barcodes (tenant_id, presentation_id, barcode) values ($1, $2, '7790001000012'), ($1, $3, '7790001000029'), ($4, $5, '7790001000012')",
      [tenantId, paraBoxId, ibuBoxId, otherTenantId, otherPresentationId]
    );
    await ownerPool.query(
      `insert into inventory_batches (tenant_id, id, presentation_id, lot_code, expires_on, unit_cost, status) values
         ($1, $2, $6, 'OK-1', current_date + 200, 5, 'AVAILABLE'),
         ($1, $3, $6, 'EXPIRED', current_date - 5, 5, 'AVAILABLE'),
         ($1, $4, $6, 'QUARANTINE', current_date + 200, 5, 'QUARANTINED'),
         ($1, $5, $7, 'IBU-1', current_date + 200, 5, 'AVAILABLE')`,
      [tenantId, id(80), id(81), id(82), id(83), paraBoxId, ibuBoxId]
    );
    await ownerPool.query(
      `insert into inventory_balances (tenant_id, warehouse_id, batch_id, quantity_base, reserved_base) values
         ($1, $2, $3, 55, 5), ($1, $2, $4, 100, 0), ($1, $2, $5, 100, 0), ($1, $2, $6, 0, 0), ($1, $7, $3, 999, 0)`,
      [tenantId, warehouseId, id(80), id(81), id(82), id(83), warehouse2Id]
    );
    await ownerPool.query(
      `insert into price_lists (id, tenant_id, branch_id, name, currency) values
         ($1, $3, null, 'General', 'BOB'), ($2, $3, $4, 'Central', 'BOB')`,
      [id(90), id(91), tenantId, branchId]
    );
    await ownerPool.query(
      `insert into presentation_prices (tenant_id, price_list_id, presentation_id, amount, valid_from) values
         ($1, $2, $4, 20.0000, now() - interval '1 day'),
         ($1, $3, $4, 25.5000, now() - interval '1 day'),
         ($1, $2, $5, 8.0000, now() - interval '1 day')`,
      [tenantId, id(90), id(91), paraBoxId, ibuBoxId]
    );
  });

  afterAll(async () => {
    await database.close();
    await ownerPool.end();
  });

  const lookup = (q: string, extra: { warehouseId?: string; limit?: number } = {}) =>
    sales.lookup(scope, { q, warehouseId: extra.warehouseId ?? warehouseId, limit: extra.limit });

  it("searches by product name, generic, active ingredient and laboratory", async () => {
    for (const term of ["panad", "paracet", "acetamin", "gsk"]) {
      const result = await lookup(term);
      expect(result.items.map((item) => item.presentationId), term).toEqual([paraBoxId]);
    }
    expect((await lookup("ibup")).items.map((item) => item.presentationId)).toEqual([ibuBoxId]);
  });

  it("returns branch price, presentation and available stock of the warehouse only", async () => {
    const [item] = (await lookup("panadol")).items;
    expect(item).toMatchObject({
      productName: "Panadol Forte",
      presentationName: "Caja x 10",
      genericName: "Paracetamol",
      laboratory: "GSK",
      baseUnitFactor: 10,
      priceBob: "25.5000",
      availableBase: 50,
      availableQuantity: 5,
      barcode: null
    });
  });

  it("uses the general price list when no branch price exists and null when there is no price", async () => {
    const [ibu] = (await lookup("ibupirac")).items;
    expect(ibu?.priceBob).toBe("8.0000");
    await ownerPool.query("delete from presentation_prices where presentation_id = $1", [ibuBoxId]);
    expect((await lookup("ibupirac")).items[0]?.priceBob).toBeNull();
  });

  it("matches an exact barcode first and reports the matched code", async () => {
    const result = await lookup("7790001000012");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ presentationId: paraBoxId, barcode: "7790001000012" });
  });

  it("excludes inactive products, non-sellable presentations and other tenants", async () => {
    const result = await lookup("paracetamol");
    expect(result.items.map((item) => item.presentationId)).toEqual([paraBoxId]);
    expect((await lookup("ajeno")).items).toEqual([]);
  });

  it("reports zero stock for a warehouse without balances and honors the limit", async () => {
    const north = await sales.lookup({ ...scope }, { q: "panadol", warehouseId: warehouse2Id }).catch((error: unknown) => error);
    expect(north).toBeInstanceOf(Error);
    await ownerPool.query("update inventory_balances set quantity_base = 0 where warehouse_id = $1", [warehouseId]);
    expect((await lookup("panadol")).items[0]).toMatchObject({ availableBase: 0, availableQuantity: 0 });
    expect((await lookup("a", { limit: 1 })).items).toHaveLength(1);
  });

  it("rejects an empty query, a missing warehouse and warehouses outside the branch or tenant", async () => {
    await expect(lookup("  ")).rejects.toThrow();
    await expect(sales.lookup(scope, { q: "panadol", warehouseId: "" })).rejects.toThrow();
    await expect(lookup("panadol", { warehouseId: otherWarehouseId })).rejects.toThrow();
  });
});
