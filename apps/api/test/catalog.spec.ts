import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TenantDatabase, type TenantScope } from "../src/database/tenant-database.js";
import { CatalogService } from "../src/catalog/catalog.service.js";

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
  process.env.DATABASE_TEST_URL ??
  withDatabaseName(developmentDatabaseUrl, "farmaxia_test");
const testAppDatabaseUrl =
  process.env.DATABASE_APP_TEST_URL ??
  withDatabaseName(developmentAppDatabaseUrl, "farmaxia_test");
const tenantId = "00000000-0000-4000-8000-000000000401";
const branchId = "00000000-0000-4000-8000-000000000411";
const userId = "00000000-0000-4000-8000-000000000421";
const legalEntityId = "00000000-0000-4000-8000-000000000431";
const foreignTenantId = "00000000-0000-4000-8000-000000000402";
const foreignBranchId = "00000000-0000-4000-8000-000000000412";

const scope: TenantScope = { tenantId, userId, branchId };
const ownerPool = new Pool({ connectionString: testDatabaseUrl });
const tenantDatabase = new TenantDatabase(testAppDatabaseUrl);
const catalog = new CatalogService(tenantDatabase);
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

describe("catalog service (C01)", () => {
  beforeAll(async () => {
    await migrate(drizzle(ownerPool), { migrationsFolder });
  });

  beforeEach(async () => {
    await ownerPool.query(`
      truncate table
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
    await ownerPool.query(
      "insert into tenants (id, slug, name) values ($1, $2, $3), ($4, $5, $6)",
      [tenantId, "catalog-tenant", "Catalog tenant", foreignTenantId, "foreign-tenant", "Foreign tenant"]
    );
    await ownerPool.query(
      "insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, $3, $4)",
      [legalEntityId, tenantId, "Catalog SRL", "4000001"]
    );
    await ownerPool.query(
      "insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, $4, $5)",
      [branchId, tenantId, legalEntityId, "CATALOG", "Catalog branch"]
    );
    await ownerPool.query(
      "insert into users (id, email, display_name, password_hash) values ($1, $2, $3, $4)",
      [userId, "catalog@example.test", "Catalog user", "not-a-password"]
    );
    await ownerPool.query(
      "insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $2, $3)",
      [userId, tenantId, branchId]
    );
  });

  afterAll(async () => {
    await tenantDatabase.close();
    await ownerPool.end();
  });

  it("creates a product hierarchy, resolves a barcode and prioritizes branch pricing", async () => {
    const category = await catalog.createCategory(scope, {
      name: "Analgésicos",
      isControlled: false
    });
    const product = await catalog.createProduct(scope, {
      categoryId: category.id,
      name: "Paracetamol",
      activeIngredient: "Paracetamol 500 mg"
    });
    const presentation = await catalog.createPresentation(scope, {
      productId: product.id,
      name: "Caja x 20 tabletas",
      baseUnitFactor: 20,
      isSellable: true
    });
    const globalPriceList = await catalog.createPriceList(scope, {
      name: "General",
      currency: "BOB"
    });
    const branchPriceList = await catalog.createPriceList(scope, {
      name: "Sucursal principal",
      currency: "BOB",
      branchId
    });
    await catalog.setPrice(scope, {
      priceListId: globalPriceList.id,
      presentationId: presentation.id,
      amount: "10.0000",
      validFrom: new Date("2026-01-01T00:00:00.000Z")
    });
    await catalog.setPrice(scope, {
      priceListId: branchPriceList.id,
      presentationId: presentation.id,
      amount: "12.5000",
      validFrom: new Date("2026-01-01T00:00:00.000Z")
    });
    await catalog.registerBarcode(scope, {
      presentationId: presentation.id,
      barcode: "780000000001"
    });
    const homologation = await catalog.addHomologation(scope, {
      productId: product.id,
      authority: "SIAT",
      externalCode: "SYNTH-001",
      externalDescription: "Synthetic catalog code"
    });

    const found = await catalog.findByBarcode(scope, "780000000001", new Date("2026-09-16T00:00:00.000Z"));
    expect(found).toMatchObject({
      productId: product.id,
      productName: "Paracetamol",
      presentationId: presentation.id,
      baseUnitFactor: 20,
      priceAmount: "12.5000"
    });
    expect(homologation.authority).toBe("SIAT");
    expect(await catalog.findByBarcode(scope, "does-not-exist")).toBeNull();
  });

  it("rejects an invalid factor, duplicate barcode and an inaccessible tenant scope", async () => {
    const category = await catalog.createCategory(scope, {
      name: "Vitaminas",
      isControlled: false
    });
    const product = await catalog.createProduct(scope, {
      categoryId: category.id,
      name: "Vitamina C"
    });
    await expect(
      catalog.createPresentation(scope, {
        productId: product.id,
        name: "Unidad inválida",
        baseUnitFactor: 0,
        isSellable: true
      })
    ).rejects.toThrow();

    const presentation = await catalog.createPresentation(scope, {
      productId: product.id,
      name: "Frasco x 10",
      baseUnitFactor: 10,
      isSellable: true
    });
    await catalog.registerBarcode(scope, {
      presentationId: presentation.id,
      barcode: "780000000002"
    });
    await expect(
      catalog.registerBarcode(scope, {
        presentationId: presentation.id,
        barcode: "780000000002"
      })
    ).rejects.toThrow();

    const inaccessibleScope: TenantScope = {
      tenantId: foreignTenantId,
      userId,
      branchId: foreignBranchId
    };
    await expect(catalog.findByBarcode(inaccessibleScope, "780000000002")).resolves.toBeNull();
  });
});
