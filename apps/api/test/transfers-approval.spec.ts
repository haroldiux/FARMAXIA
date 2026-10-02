import fastifyCookie from "@fastify/cookie";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AccessTokenService } from "../src/auth/access-token.service.js";
import { TenantDatabase, type TenantScope } from "../src/database/tenant-database.js";
import { TransfersService } from "../src/transfers/transfers.service.js";

function withDatabaseName(connectionString: string, databaseName: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

const role = (name: string) =>
  withDatabaseName(`postgresql://${name}:local-development-only@localhost:5433/farmaxia`, "farmaxia_test");

const testOwnerUrl =
  process.env.DATABASE_TEST_URL ??
  withDatabaseName(process.env.DATABASE_URL ?? "postgresql://farmaxia:local-development-only@localhost:5433/farmaxia", "farmaxia_test");
const testAppUrl = process.env.DATABASE_APP_TEST_URL ?? role("farmaxia_app");
const testAuthUrl = process.env.DATABASE_AUTH_TEST_URL ?? role("farmaxia_auth");

// Needed only for the HTTP-level permission test, which boots the real AppModule.
process.env.AUTH_JWT_SECRET ??= "test-only-secret-with-at-least-thirty-two-characters";
process.env.DATABASE_AUTH_URL = testAuthUrl;

// Tenant A: PREMIUM plan (has `transfers.approval`). Two users: `aprobadorUserId` holds
// transfers.manage + transfers.approve; `solicitanteUserId` holds transfers.manage only, used to
// prove the permission gate on approve/reject.
const tenantId = "00000000-0000-4000-8000-000000008001";
const legalEntityId = "00000000-0000-4000-8000-000000008002";
const branchOriginId = "00000000-0000-4000-8000-000000008011";
const branchDestinationId = "00000000-0000-4000-8000-000000008012";
const aprobadorUserId = "00000000-0000-4000-8000-000000008021";
const solicitanteUserId = "00000000-0000-4000-8000-000000008022";
const productId = "00000000-0000-4000-8000-000000008041";
const presentationId = "00000000-0000-4000-8000-000000008042";
const batchId = "00000000-0000-4000-8000-000000008051";
const originWarehouseId = "00000000-0000-4000-8000-000000008031";
const destinationWarehouseId = "00000000-0000-4000-8000-000000008032";
const approverRoleId = "00000000-0000-4000-8000-000000008091";
const requesterRoleId = "00000000-0000-4000-8000-000000008092";

// Tenant B: PROFESIONAL plan (no `transfers.approval`) — proves approving there is a clear error.
const profTenantId = "00000000-0000-4000-8000-000000008101";
const profLegalEntityId = "00000000-0000-4000-8000-000000008102";
const profBranchId = "00000000-0000-4000-8000-000000008111";
const profUserId = "00000000-0000-4000-8000-000000008121";
const profProductId = "00000000-0000-4000-8000-000000008141";
const profPresentationId = "00000000-0000-4000-8000-000000008142";
const profBatchId = "00000000-0000-4000-8000-000000008151";
const profOriginWarehouseId = "00000000-0000-4000-8000-000000008131";
const profDestinationWarehouseId = "00000000-0000-4000-8000-000000008132";
const profRoleId = "00000000-0000-4000-8000-000000008191";

// Tenant C: PREMIUM plan, no transfers of its own — exists only to prove RLS isolation on
// approve/reject (its own `transfers.approval` is enabled so the isolation failure is NotFound,
// not the plan-mismatch BadRequestException).
const otherTenantId = "00000000-0000-4000-8000-000000008201";
const otherLegalEntityId = "00000000-0000-4000-8000-000000008202";
const otherBranchId = "00000000-0000-4000-8000-000000008211";
const otherUserId = "00000000-0000-4000-8000-000000008221";
const otherRoleId = "00000000-0000-4000-8000-000000008291";

const ownerPool = new Pool({ connectionString: testOwnerUrl });
const database = new TenantDatabase(testAppUrl);
const transfers = new TransfersService(database);
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

const approverScope: TenantScope = { tenantId, userId: aprobadorUserId, branchId: branchOriginId };
const requesterScope: TenantScope = { tenantId, userId: solicitanteUserId, branchId: branchOriginId };
const profScope: TenantScope = { tenantId: profTenantId, userId: profUserId, branchId: profBranchId };
const otherScope: TenantScope = { tenantId: otherTenantId, userId: otherUserId, branchId: otherBranchId };

async function planId(code: string): Promise<string> {
  const result = await ownerPool.query<{ id: string }>("select id from subscription_plans where code = $1", [code]);
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error(`Plan ${code} must be seeded.`);
  }
  return id;
}

async function seedPermissions(): Promise<void> {
  // Defensive: other spec files truncate the global `permissions` catalog in their own
  // beforeEach without reseeding every code (see transfers.spec.ts for the same note).
  await ownerPool.query(
    `insert into permissions (code, description, label, module, sort_order) values
       ('transfers.manage', 'Request, dispatch and receive branch-to-branch transfers', 'Solicitar, despachar y recibir traspasos', 'Traspasos', 36),
       ('transfers.approve', 'Approve branch-to-branch transfer requests before dispatch', 'Aprobar traspasos antes del despacho', 'Traspasos', 37)
     on conflict (code) do nothing`
  );
}

describe("F14 module 7: branch-to-branch transfers (T2 approval flow)", () => {
  beforeEach(async () => {
    await ownerPool.query("truncate table tenants, users cascade");
    await seedPermissions();

    // Tenant A — PREMIUM (transfers.approval enabled).
    await ownerPool.query("insert into tenants (id, slug, name) values ($1, 'transfers-approval-premium', 'Farmacia Premium Aprobacion')", [
      tenantId
    ]);
    await ownerPool.query("insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, 'Farmacia Premium SRL', '8000701')", [
      legalEntityId,
      tenantId
    ]);
    await ownerPool.query("insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, 'ORIGEN', 'Sucursal Origen')", [
      branchOriginId,
      tenantId,
      legalEntityId
    ]);
    await ownerPool.query("insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, 'DESTINO', 'Sucursal Destino')", [
      branchDestinationId,
      tenantId,
      legalEntityId
    ]);
    await ownerPool.query("insert into users (id, email, display_name, password_hash) values ($1, 'aprobador@example.test', 'Encargado', 'x')", [
      aprobadorUserId
    ]);
    await ownerPool.query("insert into users (id, email, display_name, password_hash) values ($1, 'solicitante@example.test', 'Almacenero', 'x')", [
      solicitanteUserId
    ]);
    for (const userId of [aprobadorUserId, solicitanteUserId]) {
      await ownerPool.query("insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $2, $3)", [
        userId,
        tenantId,
        branchOriginId
      ]);
      await ownerPool.query("insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $2, $3)", [
        userId,
        tenantId,
        branchDestinationId
      ]);
    }
    await ownerPool.query(
      "insert into warehouses (id, tenant_id, branch_id, name, warehouse_type) values ($1, $2, $3, 'Central Origen', 'GENERAL')",
      [originWarehouseId, tenantId, branchOriginId]
    );
    await ownerPool.query(
      "insert into warehouses (id, tenant_id, branch_id, name, warehouse_type) values ($1, $2, $3, 'Central Destino', 'GENERAL')",
      [destinationWarehouseId, tenantId, branchDestinationId]
    );
    await ownerPool.query("insert into products (id, tenant_id, name) values ($1, $2, 'Amoxicilina 500 mg')", [productId, tenantId]);
    await ownerPool.query(
      "insert into product_presentations (id, tenant_id, product_id, name, base_unit_factor) values ($1, $2, $3, 'Caja x 10', 10)",
      [presentationId, tenantId, productId]
    );
    await ownerPool.query(
      "insert into inventory_batches (id, tenant_id, presentation_id, lot_code, expires_on, unit_cost) values ($1, $2, $3, 'LOT-APR', current_date + 180, 8.0000)",
      [batchId, tenantId, presentationId]
    );
    await ownerPool.query(
      "insert into inventory_balances (tenant_id, warehouse_id, batch_id, quantity_base, reserved_base) values ($1, $2, $3, 50, 0)",
      [tenantId, originWarehouseId, batchId]
    );
    const premiumPlanId = await planId("PREMIUM");
    await ownerPool.query(
      "insert into tenant_subscriptions (tenant_id, plan_id, status, starts_at) values ($1, $2, 'ACTIVE', now())",
      [tenantId, premiumPlanId]
    );
    await ownerPool.query("insert into roles (id, tenant_id, code) values ($1, $2, 'aprobador')", [approverRoleId, tenantId]);
    await ownerPool.query(
      "insert into role_permissions (role_id, permission_code) values ($1, 'transfers.manage'), ($1, 'transfers.approve')",
      [approverRoleId]
    );
    await ownerPool.query("insert into user_roles (user_id, tenant_id, role_id) values ($1, $2, $3)", [
      aprobadorUserId,
      tenantId,
      approverRoleId
    ]);
    await ownerPool.query("insert into roles (id, tenant_id, code) values ($1, $2, 'solicitante')", [requesterRoleId, tenantId]);
    await ownerPool.query("insert into role_permissions (role_id, permission_code) values ($1, 'transfers.manage')", [requesterRoleId]);
    await ownerPool.query("insert into user_roles (user_id, tenant_id, role_id) values ($1, $2, $3)", [
      solicitanteUserId,
      tenantId,
      requesterRoleId
    ]);

    // Tenant B — PROFESIONAL (transfers.approval NOT enabled).
    await ownerPool.query("insert into tenants (id, slug, name) values ($1, 'transfers-approval-prof', 'Farmacia Profesional Aprobacion')", [
      profTenantId
    ]);
    await ownerPool.query("insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, 'Farmacia Prof SRL', '8010701')", [
      profLegalEntityId,
      profTenantId
    ]);
    await ownerPool.query("insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, 'MAIN', 'Central')", [
      profBranchId,
      profTenantId,
      profLegalEntityId
    ]);
    await ownerPool.query("insert into users (id, email, display_name, password_hash) values ($1, 'prof@example.test', 'Almacenero', 'x')", [
      profUserId
    ]);
    await ownerPool.query("insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $2, $3)", [
      profUserId,
      profTenantId,
      profBranchId
    ]);
    await ownerPool.query(
      "insert into warehouses (id, tenant_id, branch_id, name, warehouse_type) values ($1, $2, $3, 'Origen Prof', 'GENERAL')",
      [profOriginWarehouseId, profTenantId, profBranchId]
    );
    await ownerPool.query(
      "insert into warehouses (id, tenant_id, branch_id, name, warehouse_type) values ($1, $2, $3, 'Destino Prof', 'GENERAL')",
      [profDestinationWarehouseId, profTenantId, profBranchId]
    );
    await ownerPool.query("insert into products (id, tenant_id, name) values ($1, $2, 'Ibuprofeno 400 mg')", [profProductId, profTenantId]);
    await ownerPool.query(
      "insert into product_presentations (id, tenant_id, product_id, name, base_unit_factor) values ($1, $2, $3, 'Caja x 20', 20)",
      [profPresentationId, profTenantId, profProductId]
    );
    await ownerPool.query(
      "insert into inventory_batches (id, tenant_id, presentation_id, lot_code, expires_on, unit_cost) values ($1, $2, $3, 'LOT-PROF', current_date + 180, 5.0000)",
      [profBatchId, profTenantId, profPresentationId]
    );
    await ownerPool.query(
      "insert into inventory_balances (tenant_id, warehouse_id, batch_id, quantity_base, reserved_base) values ($1, $2, $3, 30, 0)",
      [profTenantId, profOriginWarehouseId, profBatchId]
    );
    const profPlanId = await planId("PROFESIONAL");
    await ownerPool.query(
      "insert into tenant_subscriptions (tenant_id, plan_id, status, starts_at) values ($1, $2, 'ACTIVE', now())",
      [profTenantId, profPlanId]
    );
    await ownerPool.query("insert into roles (id, tenant_id, code) values ($1, $2, 'almacenero')", [profRoleId, profTenantId]);
    await ownerPool.query(
      "insert into role_permissions (role_id, permission_code) values ($1, 'transfers.manage'), ($1, 'transfers.approve')",
      [profRoleId]
    );
    await ownerPool.query("insert into user_roles (user_id, tenant_id, role_id) values ($1, $2, $3)", [profUserId, profTenantId, profRoleId]);

    // Tenant C — PREMIUM, used only for RLS isolation (no transfers of its own).
    await ownerPool.query("insert into tenants (id, slug, name) values ($1, 'transfers-approval-other', 'Farmacia Otra')", [otherTenantId]);
    await ownerPool.query("insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, 'Farmacia Otra SRL', '8020701')", [
      otherLegalEntityId,
      otherTenantId
    ]);
    await ownerPool.query("insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, 'MAIN', 'Central')", [
      otherBranchId,
      otherTenantId,
      otherLegalEntityId
    ]);
    await ownerPool.query("insert into users (id, email, display_name, password_hash) values ($1, 'otra@example.test', 'Encargado', 'x')", [
      otherUserId
    ]);
    await ownerPool.query("insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $2, $3)", [
      otherUserId,
      otherTenantId,
      otherBranchId
    ]);
    const otherPremiumPlanId = await planId("PREMIUM");
    await ownerPool.query(
      "insert into tenant_subscriptions (tenant_id, plan_id, status, starts_at) values ($1, $2, 'ACTIVE', now())",
      [otherTenantId, otherPremiumPlanId]
    );
    await ownerPool.query("insert into roles (id, tenant_id, code) values ($1, $2, 'encargado')", [otherRoleId, otherTenantId]);
    await ownerPool.query(
      "insert into role_permissions (role_id, permission_code) values ($1, 'transfers.manage'), ($1, 'transfers.approve')",
      [otherRoleId]
    );
    await ownerPool.query("insert into user_roles (user_id, tenant_id, role_id) values ($1, $2, $3)", [
      otherUserId,
      otherTenantId,
      otherRoleId
    ]);
  });

  afterAll(async () => {
    await database.close();
    await ownerPool.end();
  });

  async function requestTransfer(scope: TenantScope, key: string, origin: string, destination: string, presentation: string, batch: string, qty = 10) {
    return transfers.requestTransfer(scope, {
      idempotencyKey: key,
      originWarehouseId: origin,
      destinationWarehouseId: destination,
      items: [{ presentationId: presentation, batchId: batch, requestedQty: qty }]
    });
  }

  it("approving a Premium transfer unblocks dispatch (D53)", async () => {
    const created = await requestTransfer(requesterScope, "req-ap-001", originWarehouseId, destinationWarehouseId, presentationId, batchId);

    await expect(
      transfers.dispatchTransfer(requesterScope, created.id, { idempotencyKey: "dis-ap-001a" })
    ).rejects.toBeInstanceOf(ConflictException);

    const approved = await transfers.approveTransfer(approverScope, created.id, { idempotencyKey: "appr-ap-001" });
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedByUserId).toBe(aprobadorUserId);
    expect(approved.approvedAt).not.toBeNull();

    const dispatched = await transfers.dispatchTransfer(requesterScope, created.id, { idempotencyKey: "dis-ap-001b" });
    expect(dispatched.status).toBe("DISPATCHED");
  });

  it("rejecting a transfer blocks dispatch and reception forever", async () => {
    const created = await requestTransfer(requesterScope, "req-ap-002", originWarehouseId, destinationWarehouseId, presentationId, batchId);

    const rejected = await transfers.rejectTransfer(approverScope, created.id, {
      idempotencyKey: "rej-ap-002",
      reason: "Stock reservado para otra sucursal"
    });
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.rejectionReason).toBe("Stock reservado para otra sucursal");
    expect(rejected.rejectedAt).not.toBeNull();

    await expect(
      transfers.dispatchTransfer(requesterScope, created.id, { idempotencyKey: "dis-ap-002" })
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      transfers.receiveTransfer(
        { ...requesterScope, branchId: branchDestinationId },
        created.id,
        { idempotencyKey: "rec-ap-002", items: [{ itemId: rejected.items[0]!.id, receivedQty: 1 }] }
      )
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("allows rejecting a transfer that was already APPROVED", async () => {
    const created = await requestTransfer(requesterScope, "req-ap-003", originWarehouseId, destinationWarehouseId, presentationId, batchId);
    await transfers.approveTransfer(approverScope, created.id, { idempotencyKey: "appr-ap-003" });

    const rejected = await transfers.rejectTransfer(approverScope, created.id, {
      idempotencyKey: "rej-ap-003",
      reason: "Se canceló la necesidad en destino"
    });
    expect(rejected.status).toBe("REJECTED");
  });

  it("is idempotent on approve: repeating the same idempotency key does not re-run the transition", async () => {
    const created = await requestTransfer(requesterScope, "req-ap-004", originWarehouseId, destinationWarehouseId, presentationId, batchId);

    const first = await transfers.approveTransfer(approverScope, created.id, { idempotencyKey: "appr-ap-004" });
    const second = await transfers.approveTransfer(approverScope, created.id, { idempotencyKey: "appr-ap-004" });

    expect(second.approvedAt).toBe(first.approvedAt);
    expect(second.status).toBe("APPROVED");
  });

  it("is idempotent on reject: repeating the same idempotency key does not re-run the transition", async () => {
    const created = await requestTransfer(requesterScope, "req-ap-005", originWarehouseId, destinationWarehouseId, presentationId, batchId);

    const first = await transfers.rejectTransfer(approverScope, created.id, { idempotencyKey: "rej-ap-005", reason: "Motivo inicial" });
    const second = await transfers.rejectTransfer(approverScope, created.id, { idempotencyKey: "rej-ap-005", reason: "Motivo inicial" });

    expect(second.rejectedAt).toBe(first.rejectedAt);
    expect(second.rejectionReason).toBe("Motivo inicial");
  });

  it("rejects approving a transfer that is not in REQUESTED (e.g. already DISPATCHED)", async () => {
    const created = await requestTransfer(requesterScope, "req-ap-006", originWarehouseId, destinationWarehouseId, presentationId, batchId);
    await transfers.approveTransfer(approverScope, created.id, { idempotencyKey: "appr-ap-006" });
    await transfers.dispatchTransfer(requesterScope, created.id, { idempotencyKey: "dis-ap-006" });

    await expect(
      transfers.approveTransfer(approverScope, created.id, { idempotencyKey: "appr-ap-006b" })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects approving on a PROFESIONAL tenant (no transfers.approval feature) with a clear error", async () => {
    const created = await requestTransfer(
      profScope,
      "req-ap-007",
      profOriginWarehouseId,
      profDestinationWarehouseId,
      profPresentationId,
      profBatchId
    );

    await expect(transfers.approveTransfer(profScope, created.id, { idempotencyKey: "appr-ap-007" })).rejects.toBeInstanceOf(
      BadRequestException
    );
    await expect(transfers.approveTransfer(profScope, created.id, { idempotencyKey: "appr-ap-007b" })).rejects.toThrow(/Premium/);

    // Rejecting has no plan gate (it is not something only Premium can do), so it still works.
    const rejected = await transfers.rejectTransfer(profScope, created.id, { idempotencyKey: "rej-ap-007", reason: "Prueba" });
    expect(rejected.status).toBe("REJECTED");
  });

  it("requires a non-empty rejection reason", async () => {
    const created = await requestTransfer(requesterScope, "req-ap-008", originWarehouseId, destinationWarehouseId, presentationId, batchId);

    await expect(
      transfers.rejectTransfer(approverScope, created.id, { idempotencyKey: "rej-ap-008", reason: "" })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("isolates tenants via RLS: another tenant cannot approve or reject this transfer", async () => {
    const created = await requestTransfer(requesterScope, "req-ap-009", originWarehouseId, destinationWarehouseId, presentationId, batchId);

    await expect(
      transfers.approveTransfer(otherScope, created.id, { idempotencyKey: "appr-ap-009-cross" })
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      transfers.rejectTransfer(otherScope, created.id, { idempotencyKey: "rej-ap-009-cross", reason: "x" })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  describe("HTTP permission gate", () => {
    let app: NestFastifyApplication;
    const accessTokens = new AccessTokenService();

    afterAll(async () => {
      await app?.close();
    });

    it("requires transfers.approve (403 for a transfers.manage-only user, 200/201 for an approver)", async () => {
      const created = await requestTransfer(requesterScope, "req-ap-http-001", originWarehouseId, destinationWarehouseId, presentationId, batchId);

      const { AppModule } = await import("../src/app.module.js");
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication(new FastifyAdapter());
      await app.register(fastifyCookie);
      await app.init();
      await app.getHttpAdapter().getInstance().ready();

      const solicitanteAuth = { authorization: `Bearer ${await accessTokens.issue(requesterScope)}` };
      const aprobadorAuth = { authorization: `Bearer ${await accessTokens.issue(approverScope)}` };

      const deniedApprove = await app.inject({
        method: "POST",
        url: `/api/v1/transfers/${created.id}/approve`,
        headers: solicitanteAuth,
        payload: { idempotencyKey: "http-appr-denied" }
      });
      expect(deniedApprove.statusCode).toBe(403);

      const deniedReject = await app.inject({
        method: "POST",
        url: `/api/v1/transfers/${created.id}/reject`,
        headers: solicitanteAuth,
        payload: { idempotencyKey: "http-rej-denied", reason: "x" }
      });
      expect(deniedReject.statusCode).toBe(403);

      const allowedApprove = await app.inject({
        method: "POST",
        url: `/api/v1/transfers/${created.id}/approve`,
        headers: aprobadorAuth,
        payload: { idempotencyKey: "http-appr-allowed" }
      });
      // No @HttpCode override on this endpoint, same as dispatch/receive in T1: NestJS's default
      // for @Post() is 201, independent of the service's own internal `statusCode` bookkeeping
      // field (which only feeds the idempotency record, not the actual HTTP response).
      expect(allowedApprove.statusCode).toBe(201);
      expect(allowedApprove.json()).toMatchObject({ status: "APPROVED" });
    }, 30_000);
  });
});
