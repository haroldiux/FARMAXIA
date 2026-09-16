import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TenantDatabase, type TenantScope } from "../src/database/tenant-database.js";
import { AuditService } from "../src/transversal/audit.service.js";
import {
  IdempotencyKeyReusedError,
  IdempotencyService
} from "../src/transversal/idempotency.service.js";
import { OutboxService } from "../src/transversal/outbox.service.js";
import { DocumentSequenceService } from "../src/transversal/document-sequence.service.js";

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

const tenantId = "00000000-0000-4000-8000-000000000301";
const branchId = "00000000-0000-4000-8000-000000000311";
const branch2Id = "00000000-0000-4000-8000-000000000312";
const userId = "00000000-0000-4000-8000-000000000321";
const legalEntityId = "00000000-0000-4000-8000-000000000331";

const scope: TenantScope = { tenantId, branchId, userId };

const ownerPool = new Pool({ connectionString: testDatabaseUrl });
const tenantDatabase = new TenantDatabase(testAppDatabaseUrl);
const auditService = new AuditService();
const idempotencyService = new IdempotencyService();
const outboxService = new OutboxService();
const documentSequenceService = new DocumentSequenceService();
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

describe("transversal services (B06)", () => {
  beforeAll(async () => {
    await migrate(drizzle(ownerPool), { migrationsFolder });
  });

  beforeEach(async () => {
    await ownerPool.query(`
      truncate table
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
      cascade
    `);

    await ownerPool.query("insert into tenants (id, slug, name) values ($1, $2, $3)", [
      tenantId,
      "transversal-tenant",
      "Transversal tenant"
    ]);

    await ownerPool.query(
      "insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, $3, $4)",
      [legalEntityId, tenantId, "Transversal SRL", "3000001"]
    );

    await ownerPool.query(
      "insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, $4, $5)",
      [branchId, tenantId, legalEntityId, "CENTRAL", "Central branch"]
    );

    await ownerPool.query(
      "insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, $4, $5)",
      [branch2Id, tenantId, legalEntityId, "SUCURSAL2", "Branch 2"]
    );

    await ownerPool.query(
      "insert into users (id, email, display_name, password_hash) values ($1, $2, $3, $4)",
      [userId, "transversal@example.test", "Transversal user", "not-a-password"]
    );

    await ownerPool.query(
      "insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $2, $3)",
      [userId, tenantId, branchId]
    );

    await ownerPool.query(
      "insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $2, $3)",
      [userId, tenantId, branch2Id]
    );
  });

  afterAll(async () => {
    await tenantDatabase.close();
    await ownerPool.end();
  });

  describe("AuditService (S19)", () => {
    it("records an immutable audit event and rejects update and delete", async () => {
      let auditEventId = "";

      await tenantDatabase.withScope(scope, async (client) => {
        const event = await auditService.recordInTransaction(client, {
          action: "SALE_CONFIRMED",
          entityType: "Sale",
          entityId: "SALE-001",
          payload: { totalBob: "150.00", paymentMethod: "CASH" }
        });
        auditEventId = event.id;
        expect(event.tenantId).toBe(tenantId);
        expect(event.branchId).toBe(branchId);
        expect(event.actorUserId).toBe(userId);
      });

      // Verify readable under same branch
      await tenantDatabase.withScope(scope, async (client) => {
        const res = await client.query(
          "select * from audit_events where id = $1",
          [auditEventId]
        );
        expect(res.rows.length).toBe(1);
        expect(res.rows[0].action).toBe("SALE_CONFIRMED");
      });

      // Verify immutable: UPDATE rejected
      await expect(
        ownerPool.query(
          "update audit_events set action = 'TAMPERED' where id = $1",
          [auditEventId]
        )
      ).rejects.toThrow(/append-only/i);

      // Verify immutable: DELETE rejected
      await expect(
        ownerPool.query("delete from audit_events where id = $1", [auditEventId])
      ).rejects.toThrow(/append-only/i);
    });
  });

  describe("IdempotencyService (S20)", () => {
    it("returns cached result on identical retry and rejects conflicting payload with IDEMPOTENCY_KEY_REUSED", async () => {
      const operation = "confirm-sale";
      const idempotencyKey = "key-sale-12345";
      const payload = { items: [{ sku: "PARACETAMOL", quantity: 2 }] };
      let executionCount = 0;

      // 1. Initial execution
      const firstResult = await idempotencyService.execute(
        tenantDatabase,
        scope,
        operation,
        idempotencyKey,
        payload,
        async (_client) => {
          executionCount++;
          return { statusCode: 201, data: { orderId: "ORD-999" } };
        }
      );

      expect(executionCount).toBe(1);
      expect(firstResult.statusCode).toBe(201);
      expect(firstResult.data).toEqual({ orderId: "ORD-999" });

      // 2. Identical retry returns cached response without executing again
      const secondResult = await idempotencyService.execute(
        tenantDatabase,
        scope,
        operation,
        idempotencyKey,
        payload,
        async (_client) => {
          executionCount++;
          return { statusCode: 201, data: { orderId: "ORD-DIFFERENT" } };
        }
      );

      expect(executionCount).toBe(1); // not incremented!
      expect(secondResult.statusCode).toBe(201);
      expect(secondResult.data).toEqual({ orderId: "ORD-999" });

      // 3. Different payload with same key throws IdempotencyKeyReusedError
      const conflictingPayload = { items: [{ sku: "IBUPROFENO", quantity: 1 }] };
      await expect(
        idempotencyService.execute(
          tenantDatabase,
          scope,
          operation,
          idempotencyKey,
          conflictingPayload,
          async (_client) => {
            return { statusCode: 201, data: { orderId: "ORD-FAIL" } };
          }
        )
      ).rejects.toThrow(IdempotencyKeyReusedError);
    });
  });

  describe("OutboxService (S21)", () => {
    it("enqueues an event in PENDING status atomically with domain transaction", async () => {
      let outboxId = "";

      await tenantDatabase.withScope(scope, async (client) => {
        const outbox = await outboxService.enqueueInTransaction(client, {
          aggregateType: "Sale",
          aggregateId: "SALE-001",
          eventType: "SALE_CREATED",
          payload: { amountBob: "50.00" }
        });
        outboxId = outbox.id;
        expect(outbox.status).toBe("PENDING");
        expect(outbox.retryCount).toBe(0);
      });

      // Verify persisted in DB
      await tenantDatabase.withScope(scope, async (client) => {
        const res = await client.query("select * from outbox_events where id = $1", [
          outboxId
        ]);
        expect(res.rows.length).toBe(1);
        expect(res.rows[0].status).toBe("PENDING");
      });
    });

    it("rolls back outbox event if transaction fails", async () => {
      await expect(
        tenantDatabase.withScope(scope, async (client) => {
          await outboxService.enqueueInTransaction(client, {
            aggregateType: "Sale",
            aggregateId: "SALE-FAIL",
            eventType: "SALE_FAILED",
            payload: {}
          });
          throw new Error("Transaction aborted");
        })
      ).rejects.toThrow("Transaction aborted");

      const res = await ownerPool.query(
        "select * from outbox_events where aggregate_id = 'SALE-FAIL'"
      );
      expect(res.rows.length).toBe(0);
    });
  });

  describe("DocumentSequenceService (S22)", () => {
    it("generates atomic sequential numbers per branch and document type", async () => {
      const docType = "NON_FISCAL_RECEIPT";

      const num1 = await tenantDatabase.withScope(scope, async (client) => {
        return documentSequenceService.nextNumberInTransaction(client, docType);
      });
      const num2 = await tenantDatabase.withScope(scope, async (client) => {
        return documentSequenceService.nextNumberInTransaction(client, docType);
      });
      const num3 = await tenantDatabase.withScope(scope, async (client) => {
        return documentSequenceService.nextNumberInTransaction(client, docType);
      });

      expect(num1).toBe(1n);
      expect(num2).toBe(2n);
      expect(num3).toBe(3n);

      // Branch 2 has its own separate sequence
      const scope2: TenantScope = { ...scope, branchId: branch2Id };
      const branch2Num = await tenantDatabase.withScope(scope2, async (client) => {
        return documentSequenceService.nextNumberInTransaction(client, docType);
      });
      expect(branch2Num).toBe(1n);
    });

    it("handles concurrent requests without collisions or duplicates", async () => {
      const docType = "PROFORMA";
      const concurrency = 5;

      const results = await Promise.all(
        Array.from({ length: concurrency }).map(() =>
          tenantDatabase.withScope(scope, async (client) => {
            return documentSequenceService.nextNumberInTransaction(client, docType);
          })
        )
      );

      const sorted = results.map(Number).sort((a, b) => a - b);
      expect(sorted).toEqual([1, 2, 3, 4, 5]);
    });
  });
});
