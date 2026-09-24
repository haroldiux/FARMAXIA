import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuditService } from "../src/platform/audit.service.js";
import { DocumentSequenceService } from "../src/platform/document-sequence.service.js";
import {
  IdempotencyKeyReusedError,
  IdempotencyService
} from "../src/platform/idempotency.service.js";
import { OutboxService } from "../src/platform/outbox.service.js";
import { TenantDatabase } from "../src/database/tenant-database.js";

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
const userId = "00000000-0000-4000-8000-000000000321";
const legalEntityId = "00000000-0000-4000-8000-000000000331";
const saleId = "00000000-0000-4000-8000-000000000341";

const ownerPool = new Pool({ connectionString: testDatabaseUrl });
const tenantDatabase = new TenantDatabase(testAppDatabaseUrl);
const audit = new AuditService(tenantDatabase);
const idempotency = new IdempotencyService(tenantDatabase);
const outbox = new OutboxService(tenantDatabase);
const sequences = new DocumentSequenceService(tenantDatabase);
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

describe("platform transactional services", () => {
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
        cash_shift_controls,
        cash_shift_users,
        cash_shifts,
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
      "platform-tenant",
      "Platform tenant"
    ]);
    await ownerPool.query(
      "insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, $3, $4)",
      [legalEntityId, tenantId, "Platform SRL", "3000001"]
    );
    await ownerPool.query(
      "insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, $4, $5)",
      [branchId, tenantId, legalEntityId, "PLATFORM", "Platform branch"]
    );
    await ownerPool.query(
      "insert into users (id, email, display_name, password_hash) values ($1, $2, $3, $4)",
      [userId, "platform@example.test", "Platform user", "not-a-password"]
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

  it("persists one effect, audit event and outbox event for an idempotent confirmation", async () => {
    const scope = { tenantId, userId, branchId };
    let effects = 0;
    const executeConfirmation = () =>
      idempotency.execute(
        scope,
        "sales.confirm",
        "confirmation-001",
        { saleId, lines: [{ sku: "PARA-500", quantity: 1 }] },
        async (client) => {
          effects += 1;
          const documentNumber = await sequences.allocateInTransaction(
            client,
            scope,
            "NON_FISCAL_RECEIPT"
          );
          await audit.recordInTransaction(client, scope, {
            action: "sales.confirmed",
            entityType: "sale",
            entityId: saleId,
            payload: { documentNumber: documentNumber.toString() }
          });
          await outbox.enqueueInTransaction(client, scope, {
            aggregateType: "sale",
            aggregateId: saleId,
            eventType: "sale.confirmed",
            payload: { documentNumber: documentNumber.toString() }
          });
          return {
            statusCode: 201,
            body: { documentNumber: documentNumber.toString() }
          };
        }
      );

    const first = await executeConfirmation();
    const replay = await idempotency.execute(
      scope,
      "sales.confirm",
      "confirmation-001",
      { lines: [{ quantity: 1, sku: "PARA-500" }], saleId },
      async () => {
        effects += 1;
        return { statusCode: 201, body: { documentNumber: "unexpected" } };
      }
    );

    expect(first).toEqual({ statusCode: 201, body: { documentNumber: "1" } });
    expect(replay).toEqual(first);
    expect(effects).toBe(1);
    await expect(
      idempotency.execute(
        scope,
        "sales.confirm",
        "confirmation-001",
        { saleId, lines: [{ sku: "PARA-500", quantity: 2 }] },
        async () => ({ statusCode: 201, body: {} })
      )
    ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);

    const auditRows = await ownerPool.query<{ action: string }>(
      "select action from audit_events where tenant_id = $1",
      [tenantId]
    );
    const outboxRows = await ownerPool.query<{ status: string }>(
      "select status from outbox_events where tenant_id = $1",
      [tenantId]
    );
    expect(auditRows.rows).toEqual([{ action: "sales.confirmed" }]);
    expect(outboxRows.rows).toEqual([{ status: "PENDING" }]);
    await expect(
      ownerPool.query("update audit_events set action = 'tampered' where tenant_id = $1", [tenantId])
    ).rejects.toThrow("audit events are immutable");
  });

  it("allocates a unique internal document number under concurrent requests", async () => {
    const scope = { tenantId, userId, branchId };
    const values = await Promise.all(
      Array.from({ length: 8 }, () => sequences.allocate(scope, "NON_FISCAL_RECEIPT"))
    );
    expect(values.sort((left, right) => Number(left - right))).toEqual([
      1n,
      2n,
      3n,
      4n,
      5n,
      6n,
      7n,
      8n
    ]);
  });
});
