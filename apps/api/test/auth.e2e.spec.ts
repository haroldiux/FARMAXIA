import argon2 from "argon2";
import fastifyCookie from "@fastify/cookie";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { Pool } from "pg";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";

const developmentDatabaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://farmaxia:local-development-only@localhost:5433/farmaxia";
const developmentAuthDatabaseUrl =
  process.env.DATABASE_AUTH_URL ??
  "postgresql://farmaxia_auth:local-development-only@localhost:5433/farmaxia";

function withDatabaseName(connectionString: string, databaseName: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

const testDatabaseUrl =
  process.env.DATABASE_TEST_URL ??
  withDatabaseName(developmentDatabaseUrl, "farmaxia_test");
const testAuthDatabaseUrl =
  process.env.DATABASE_AUTH_TEST_URL ??
  withDatabaseName(developmentAuthDatabaseUrl, "farmaxia_test");
const tenantA = "00000000-0000-4000-8000-000000000101";
const tenantB = "00000000-0000-4000-8000-000000000102";
const legalEntityA = "00000000-0000-4000-8000-000000000111";
const legalEntityB = "00000000-0000-4000-8000-000000000112";
const branchA = "00000000-0000-4000-8000-000000000121";
const branchB = "00000000-0000-4000-8000-000000000122";
const userId = "00000000-0000-4000-8000-000000000131";
const roleId = "00000000-0000-4000-8000-000000000141";

const ownerPool = new Pool({ connectionString: testDatabaseUrl });
const authPool = new Pool({ connectionString: testAuthDatabaseUrl });
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

function cookieValue(setCookie: string | string[] | undefined): string {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!value) {
    throw new Error("Expected refresh cookie.");
  }
  const [cookie] = value.split(";");
  if (!cookie) {
    throw new Error("Expected a refresh cookie value.");
  }
  return cookie;
}

async function createApp(): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.register(fastifyCookie);
  await app.init();
  return app;
}

describe("authentication API", () => {
  beforeAll(async () => {
    process.env.DATABASE_AUTH_URL = testAuthDatabaseUrl;
    process.env.AUTH_JWT_SECRET = "test-only-secret-with-at-least-thirty-two-characters";
    await migrate(drizzle(ownerPool), { migrationsFolder });
  });

  beforeEach(async () => {
    await ownerPool.query(`
      truncate table
        cash_shift_users,
        cash_shifts,
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
    const passwordHash = await argon2.hash("CorrectHorseBatteryStaple!", {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1
    });

    await ownerPool.query(
      "insert into tenants (id, slug, name) values ($1, $2, $3), ($4, $5, $6)",
      [tenantA, "farmacia-a", "Farmacia A", tenantB, "farmacia-b", "Farmacia B"]
    );
    await ownerPool.query(
      `insert into legal_entities (id, tenant_id, legal_name, tax_id)
       values ($1, $2, $3, $4), ($5, $6, $7, $8)`,
      [
        legalEntityA,
        tenantA,
        "Farmacia A SRL",
        "1000101",
        legalEntityB,
        tenantB,
        "Farmacia B SRL",
        "1000102"
      ]
    );
    await ownerPool.query(
      `insert into branches (id, tenant_id, legal_entity_id, code, name)
       values ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)`,
      [
        branchA,
        tenantA,
        legalEntityA,
        "A-CENTRAL",
        "Central A",
        branchB,
        tenantB,
        legalEntityB,
        "B-CENTRAL",
        "Central B"
      ]
    );
    await ownerPool.query(
      `insert into users (id, email, display_name, password_hash)
       values ($1, $2, $3, $4)`,
      [userId, "cashier@example.test", "Cajero", passwordHash]
    );
    await ownerPool.query(
      "insert into roles (id, tenant_id, code) values ($1, $2, $3)",
      [roleId, tenantA, "cashier"]
    );
    await ownerPool.query(
      "insert into permissions (code, description) values ($1, $2)",
      ["sales.confirm", "Confirmar ventas"]
    );
    await ownerPool.query(
      "insert into role_permissions (role_id, permission_code) values ($1, $2)",
      [roleId, "sales.confirm"]
    );
    await ownerPool.query(
      "insert into user_roles (user_id, tenant_id, role_id) values ($1, $2, $3)",
      [userId, tenantA, roleId]
    );
    await ownerPool.query(
      `insert into user_branch_memberships (user_id, tenant_id, branch_id)
       values ($1, $2, $3)`,
      [userId, tenantA, branchA]
    );
  });

  afterAll(async () => {
    await authPool.end();
    await ownerPool.end();
  });

  it("limits the authentication database role to the requested identity or session", async () => {
    await ownerPool.query(
      `insert into auth_sessions (token_hash, user_id, tenant_id, branch_id, expires_at)
       values ($1, $2, $3, $4, now() + interval '1 day')`,
      ["a".repeat(64), userId, tenantA, branchA]
    );

    expect((await authPool.query("select id from users")).rows).toEqual([]);
    expect((await authPool.query("select id from auth_sessions")).rows).toEqual([]);

    await authPool.query("begin");
    try {
      await authPool.query("select set_config('app.login_email', $1, true)", [
        "cashier@example.test"
      ]);
      const users = await authPool.query("select id from users");
      expect(users.rows).toEqual([{ id: userId }]);
      await authPool.query("commit");
    } catch (error) {
      await authPool.query("rollback");
      throw error;
    }

    await authPool.query("begin");
    try {
      await authPool.query("select set_config('app.refresh_token_hash', $1, true)", [
        "a".repeat(64)
      ]);
      const sessions = await authPool.query("select token_hash from auth_sessions");
      expect(sessions.rows).toEqual([{ token_hash: "a".repeat(64) }]);
      await authPool.query("commit");
    } catch (error) {
      await authPool.query("rollback");
      throw error;
    }
  });

  it("issues a session only for a valid password and exact membership", async () => {
    const app = await createApp();
    try {
      const login = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          email: "cashier@example.test",
          password: "CorrectHorseBatteryStaple!",
          tenantId: tenantA,
          branchId: branchA
        }
      });

      expect(login.statusCode).toBe(201);
      expect(login.json()).toMatchObject({
        accessToken: expect.any(String),
        expiresInSeconds: 900
      });
      expect(login.headers["set-cookie"]).toContain("farmaxia_refresh=");

      const accessToken = login.json<{ accessToken: string }>().accessToken;
      const me = await app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
        headers: { authorization: `Bearer ${accessToken}` }
      });
      expect(me.statusCode).toBe(200);
      expect(me.json()).toEqual({
        userId,
        tenantId: tenantA,
        branchId: branchA,
        permissions: ["sales.confirm"]
      });
    } finally {
      await app.close();
    }
  });

  it("does not accept a branch merely because the client supplies its id", async () => {
    const app = await createApp();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          email: "cashier@example.test",
          password: "CorrectHorseBatteryStaple!",
          tenantId: tenantA,
          branchId: branchB
        }
      });

      expect(response.statusCode).toBe(401);
      const sessions = await ownerPool.query("select * from auth_sessions");
      expect(sessions.rows).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("rotates refresh sessions and protects routes without a bearer token", async () => {
    const app = await createApp();
    try {
      const unauthenticated = await app.inject({ method: "GET", url: "/api/v1/auth/me" });
      expect(unauthenticated.statusCode).toBe(401);

      const login = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          email: "cashier@example.test",
          password: "CorrectHorseBatteryStaple!",
          tenantId: tenantA,
          branchId: branchA
        }
      });
      const originalCookie = cookieValue(login.headers["set-cookie"]);
      const refresh = await app.inject({
        method: "POST",
        url: "/api/v1/auth/refresh",
        headers: { cookie: originalCookie }
      });
      expect(refresh.statusCode).toBe(201);
      expect(refresh.json()).toMatchObject({ accessToken: expect.any(String) });
      const newCookie = cookieValue(refresh.headers["set-cookie"]);
      expect(newCookie).not.toBe(originalCookie);

      const replay = await app.inject({
        method: "POST",
        url: "/api/v1/auth/refresh",
        headers: { cookie: originalCookie }
      });
      expect(replay.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
