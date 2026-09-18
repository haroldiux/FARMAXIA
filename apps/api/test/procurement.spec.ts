import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CatalogService } from "../src/catalog/catalog.service.js";
import { TenantDatabase, type TenantScope } from "../src/database/tenant-database.js";
import {
  IdempotencyKeyReusedError
} from "../src/transversal/idempotency.service.js";
import { ProcurementService } from "../src/procurement/procurement.service.js";

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
const tenantId = "00000000-0000-4000-8000-000000000501";
const branchId = "00000000-0000-4000-8000-000000000511";
const userId = "00000000-0000-4000-8000-000000000521";
const legalEntityId = "00000000-0000-4000-8000-000000000531";
const warehouseId = "00000000-0000-4000-8000-000000000541";

const scope: TenantScope = { tenantId, userId, branchId };
const ownerPool = new Pool({ connectionString: testDatabaseUrl });
const tenantDatabase = new TenantDatabase(testAppDatabaseUrl);
const catalog = new CatalogService(tenantDatabase);
const procurement = new ProcurementService(tenantDatabase);
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

describe("procurement and receiving service (C02)", () => {
  beforeAll(async () => {
    await migrate(drizzle(ownerPool), { migrationsFolder });
  });

  beforeEach(async () => {
    await ownerPool.query(`
      truncate table
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
      "procurement-tenant",
      "Procurement tenant"
    ]);
    await ownerPool.query(
      "insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, $3, $4)",
      [legalEntityId, tenantId, "Procurement SRL", "5000001"]
    );
    await ownerPool.query(
      "insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, $4, $5)",
      [branchId, tenantId, legalEntityId, "PROCUREMENT", "Procurement branch"]
    );
    await ownerPool.query(
      "insert into warehouses (id, tenant_id, branch_id, name) values ($1, $2, $3, $4)",
      [warehouseId, tenantId, branchId, "Main warehouse"]
    );
    await ownerPool.query(
      "insert into users (id, email, display_name, password_hash) values ($1, $2, $3, $4)",
      [userId, "procurement@example.test", "Procurement user", "not-a-password"]
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

  it("receives a lot once, updates balance and creates a payable", async () => {
    const category = await catalog.createCategory(scope, {
      name: "Antibióticos",
      isControlled: false
    });
    const product = await catalog.createProduct(scope, {
      categoryId: category.id,
      name: "Amoxicilina",
      activeIngredient: "Amoxicilina 500 mg"
    });
    const presentation = await catalog.createPresentation(scope, {
      productId: product.id,
      name: "Caja x 10 cápsulas",
      baseUnitFactor: 10,
      isSellable: true
    });
    const supplier = await procurement.createSupplier(scope, {
      name: "Distribuidora Sintética",
      taxId: "5000002"
    });
    const purchaseOrder = await procurement.createPurchaseOrder(scope, {
      supplierId: supplier.id,
      warehouseId,
      lines: [{ presentationId: presentation.id, quantityBase: 10, unitCost: "2.5000" }]
    });
    const receiptInput = {
      idempotencyKey: "receipt-001",
      supplierId: supplier.id,
      purchaseOrderId: purchaseOrder.id,
      warehouseId,
      receivedAt: "2026-09-16T12:00:00.000Z",
      lines: [
        {
          presentationId: presentation.id,
          lotCode: "LOT-001",
          expiresOn: "2027-12-31",
          quantityBase: 10,
          unitCost: "2.5000"
        }
      ]
    } as const;

    const first = await procurement.receive(scope, receiptInput);
    const replay = await procurement.receive(scope, {
      ...receiptInput,
      lines: [{ ...receiptInput.lines[0], quantityBase: 10 }]
    });
    expect(replay).toEqual(first);

    const balances = await ownerPool.query<{ quantity_base: string }>(
      "select quantity_base from inventory_balances where tenant_id = $1 and warehouse_id = $2",
      [tenantId, warehouseId]
    );
    const movements = await ownerPool.query<{ movement_type: string; quantity_base: string }>(
      "select movement_type, quantity_base from inventory_movements where tenant_id = $1",
      [tenantId]
    );
    expect(balances.rows).toEqual([{ quantity_base: "10" }]);
    expect(movements.rows).toEqual([{ movement_type: "RECEIPT", quantity_base: "10" }]);

    await expect(
      procurement.receive(scope, {
        ...receiptInput,
        lines: [{ ...receiptInput.lines[0], quantityBase: 9 }]
      })
    ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);

    const payable = await procurement.createSupplierInvoice(scope, {
      supplierId: supplier.id,
      goodsReceiptId: first.receiptId,
      invoiceNumber: "INV-001",
      issuedOn: "2026-09-16",
      currency: "BOB",
      totalAmount: "25.0000",
      dueOn: "2026-10-16"
    });
    const payableRows = await ownerPool.query<{ outstanding_amount: string }>(
      "select outstanding_amount from payables where id = $1",
      [payable.payableId]
    );
    expect(payableRows.rows).toEqual([{ outstanding_amount: "25.0000" }]);
  });

  it("lists active suppliers and purchase orders scoped to the branch", async () => {
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
    const supplier = await procurement.createSupplier(scope, {
      name: "Proveedor visible",
      taxId: "5000010"
    });
    await ownerPool.query(
      "insert into suppliers (tenant_id, name, tax_id, is_active) values ($1, $2, $3, false)",
      [tenantId, "Proveedor inactivo", "5000011"]
    );
    const order = await procurement.createPurchaseOrder(scope, {
      supplierId: supplier.id,
      warehouseId,
      lines: [{ presentationId: presentation.id, quantityBase: 20, unitCost: "3.2500" }]
    });
    const otherBranchId = "00000000-0000-4000-8000-000000000551";
    const otherWarehouseId = "00000000-0000-4000-8000-000000000561";
    await ownerPool.query(
      "insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, $4, $5)",
      [otherBranchId, tenantId, legalEntityId, "OTHER", "Other branch"]
    );
    await ownerPool.query(
      "insert into warehouses (id, tenant_id, branch_id, name) values ($1, $2, $3, $4)",
      [otherWarehouseId, tenantId, otherBranchId, "Other warehouse"]
    );
    await ownerPool.query(
      "insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $2, $3)",
      [userId, tenantId, otherBranchId]
    );
    await procurement.createPurchaseOrder({ ...scope, branchId: otherBranchId }, {
      supplierId: supplier.id,
      warehouseId: otherWarehouseId,
      lines: [{ presentationId: presentation.id, quantityBase: 10, unitCost: "3.2500" }]
    });

    const suppliers = await procurement.listSuppliers(scope);
    const presentations = await procurement.listPresentations(scope);
    const orders = await procurement.listPurchaseOrders(scope);

    expect(suppliers.items).toEqual([
      { id: supplier.id, name: "Proveedor visible", taxId: "5000010", isActive: true }
    ]);
    expect(presentations.items).toEqual([
      {
        presentationId: presentation.id,
        presentationName: "Caja x 20 tabletas",
        productName: "Paracetamol",
        baseUnitFactor: 20,
        isSellable: true
      }
    ]);
    expect(orders.items).toHaveLength(1);
    expect(orders.items[0]).toMatchObject({
      id: order.id,
      supplierId: supplier.id,
      supplierName: "Proveedor visible",
      warehouseId,
      warehouseName: "Main warehouse",
      status: "SUBMITTED",
      lines: [
        {
          presentationId: presentation.id,
          presentationName: "Caja x 20 tabletas",
          productName: "Paracetamol",
          quantityBase: 20,
          unitCost: "3.2500"
        }
      ]
    });
  });

  it("rejects invalid quantities and costs before changing inventory", async () => {
    await expect(
      procurement.receive(scope, {
        idempotencyKey: "invalid-001",
        supplierId: "00000000-0000-4000-8000-000000000591",
        purchaseOrderId: "00000000-0000-4000-8000-000000000592",
        warehouseId,
        receivedAt: "2026-09-16T12:00:00.000Z",
        lines: [
          {
            presentationId: "00000000-0000-4000-8000-000000000593",
            lotCode: "LOT-X",
            expiresOn: "2027-12-31",
            quantityBase: 0,
            unitCost: "-1.0000"
          }
        ]
      })
    ).rejects.toThrow();
    const balances = await ownerPool.query("select count(*)::int as count from inventory_balances");
    expect(balances.rows[0]?.count).toBe(0);
  });
});
