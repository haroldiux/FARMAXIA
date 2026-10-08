import fastifyCookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AccessTokenService } from "../src/auth/access-token.service.js";
import { API_KEY_RATE_LIMIT_PER_MINUTE } from "../src/integrations/api-keys.service.js";

function withDatabaseName(connectionString: string, databaseName: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}
const role = (name: string) => withDatabaseName(`postgresql://${name}:local-development-only@localhost:5433/farmaxia`, "farmaxia_test");
const testOwnerUrl =
  process.env.DATABASE_TEST_URL ??
  withDatabaseName(process.env.DATABASE_URL ?? "postgresql://farmaxia:local-development-only@localhost:5433/farmaxia", "farmaxia_test");
const testAuthUrl = process.env.DATABASE_AUTH_TEST_URL ?? role("farmaxia_auth");

process.env.AUTH_JWT_SECRET ??= "test-only-secret-with-at-least-thirty-two-characters";
process.env.DATABASE_AUTH_URL = testAuthUrl;

const id = (n: number) => `00000000-0000-4000-8000-${String(993000 + n).padStart(12, "0")}`;
const tenantId = id(1);
const legalEntityId = id(2);
const branchA = id(11);
const branchB = id(12);
const ownerUser = id(21); // integrations.manage, member of A and B
const plainUser = id(22); // no integrations.manage, member of A
const roleIntegrations = id(31);
const roleNone = id(32);
const otherTenantId = id(101);
const otherLegalEntityId = id(102);
const otherBranchId = id(111);
const otherOwner = id(121);
const otherRole = id(131);

const ownerPool = new Pool({ connectionString: testOwnerUrl });
const accessTokens = new AccessTokenService();
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

async function setPlan(planCode: string, tenant = tenantId, status = "ACTIVE"): Promise<void> {
  await ownerPool.query("delete from tenant_subscriptions where tenant_id = $1", [tenant]);
  const plan = await ownerPool.query<{ id: string }>("select id from subscription_plans where code = $1", [planCode]);
  await ownerPool.query("insert into tenant_subscriptions (tenant_id, plan_id, status, starts_at) values ($1, $2, $3, now())", [
    tenant,
    plan.rows[0]!.id,
    status
  ]);
}

async function seed(): Promise<void> {
  await ownerPool.query(
    `insert into permissions (code, description, label, module, sort_order)
     values ('integrations.manage', 'Manage API keys, webhooks and integrations', 'Administrar integraciones y API', 'Administración', 85)
     on conflict (code) do nothing`
  );
  await ownerPool.query("insert into tenants (id, slug, name) values ($1, 'integrations', 'Farmacia Integrada'), ($2, 'integrations-other', 'Otra Farmacia')", [
    tenantId,
    otherTenantId
  ]);
  await ownerPool.query("insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, 'Integrada SRL', '9930001'), ($3, $4, 'Otra SRL', '9930002')", [
    legalEntityId,
    tenantId,
    otherLegalEntityId,
    otherTenantId
  ]);
  await ownerPool.query("insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $3, $4, 'MAIN', 'Central'), ($2, $3, $4, 'SUR', 'Sur')", [
    branchA,
    branchB,
    tenantId,
    legalEntityId
  ]);
  await ownerPool.query("insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, 'OTRA', 'Otra')", [otherBranchId, otherTenantId, otherLegalEntityId]);
  await ownerPool.query(
    `insert into users (id, email, display_name, password_hash) values
       ($1, 'int-owner@example.test', 'Duena', 'x'), ($2, 'int-plain@example.test', 'Sin permiso', 'x'), ($3, 'int-other@example.test', 'Otra', 'x')`,
    [ownerUser, plainUser, otherOwner]
  );
  await ownerPool.query(
    "insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $3, $4), ($1, $3, $5), ($2, $3, $4), ($6, $7, $8)",
    [ownerUser, plainUser, tenantId, branchA, branchB, otherOwner, otherTenantId, otherBranchId]
  );
  await ownerPool.query("insert into roles (id, tenant_id, code) values ($1, $3, 'integrador'), ($2, $3, 'sin-integraciones')", [roleIntegrations, roleNone, tenantId]);
  await ownerPool.query("insert into roles (id, tenant_id, code) values ($1, $2, 'integrador')", [otherRole, otherTenantId]);
  await ownerPool.query("insert into role_permissions (role_id, permission_code) values ($1, 'integrations.manage'), ($2, 'integrations.manage')", [roleIntegrations, otherRole]);
  await ownerPool.query("insert into user_roles (user_id, tenant_id, role_id) values ($1, $3, $4), ($2, $3, $5), ($6, $7, $8)", [
    ownerUser,
    plainUser,
    tenantId,
    roleIntegrations,
    roleNone,
    otherOwner,
    otherTenantId,
    otherRole
  ]);
}

let app: NestFastifyApplication | undefined;
async function getApp(): Promise<NestFastifyApplication> {
  if (!app) {
    const { AppModule } = await import("../src/app.module.js");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(new FastifyAdapter());
    await app.register(fastifyCookie);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }
  return app;
}

type Body = Record<string, unknown> & { items?: Array<Record<string, unknown>> };

async function asUser(
  method: "GET" | "POST",
  url: string,
  userId: string,
  options: { branchId?: string; tenant?: string; payload?: unknown } = {}
): Promise<{ status: number; body: Body }> {
  const token = await accessTokens.issue({ userId, tenantId: options.tenant ?? tenantId, branchId: options.branchId ?? branchA });
  const response = await (await getApp()).inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(options.payload === undefined ? {} : { payload: options.payload as Record<string, unknown> })
  });
  return { status: response.statusCode, body: response.body ? (JSON.parse(response.body) as Body) : {} };
}

async function withKey(url: string, key: string | undefined): Promise<{ status: number; body: Body }> {
  const response = await (await getApp()).inject({ method: "GET", url, headers: key === undefined ? {} : { "x-api-key": key } });
  return { status: response.statusCode, body: response.body ? (JSON.parse(response.body) as Body) : {} };
}

async function createKey(name = "Tienda online", userId = ownerUser, branchId = branchA, tenant = tenantId): Promise<{ id: string; key: string }> {
  const created = await asUser("POST", "/api/v1/integrations/api-keys", userId, { branchId, tenant, payload: { name } });
  expect(created.status).toBe(201);
  return { id: created.body.id as string, key: created.body.key as string };
}

const KEYS_URL = "/api/v1/integrations/api-keys";
const PUBLIC_URL = "/api/public/v1/products";

describe("F19 integrations: API keys (T1)", () => {
  beforeAll(async () => {
    await migrate(drizzle(ownerPool), { migrationsFolder });
  });
  afterAll(async () => {
    await app?.close();
    await ownerPool.end();
  });
  beforeEach(async () => {
    await ownerPool.query("truncate table tenants, users cascade");
    await seed();
    await setPlan("PREMIUM");
    await setPlan("PREMIUM", otherTenantId);
  });

  it("seeds integrations.manage for the owner role only", async () => {
    const { rows } = await ownerPool.query<{ code: string; module: string }>("select code, module from permissions where code = 'integrations.manage'");
    expect(rows).toEqual([{ code: "integrations.manage", module: "Administración" }]);
  });

  describe("management", () => {
    it("returns the plaintext key only on creation and stores only its SHA-256 hash", async () => {
      const created = await asUser("POST", KEYS_URL, ownerUser, { payload: { name: "  Tienda online  " } });
      expect(created.status).toBe(201);
      const key = created.body.key as string;
      expect(key).toMatch(/^fxk_[A-Za-z0-9_-]{43}$/);
      expect(created.body).toMatchObject({ name: "Tienda online", prefix: key.slice(0, 12), branchId: branchA, createdByUserId: ownerUser, revokedAt: null, lastUsedAt: null });

      const stored = await ownerPool.query<Record<string, unknown>>("select * from api_keys where id = $1", [created.body.id]);
      expect(stored.rows[0]).toMatchObject({ key_hash: sha256(key), key_prefix: key.slice(0, 12), tenant_id: tenantId, branch_id: branchA, created_by_user_id: ownerUser });
      expect(Object.values(stored.rows[0]!)).not.toContain(key);

      const listed = await asUser("GET", KEYS_URL, ownerUser);
      expect(listed.status).toBe(200);
      expect(listed.body.items).toHaveLength(1);
      expect(listed.body.items![0]).toMatchObject({ id: created.body.id, name: "Tienda online", prefix: key.slice(0, 12) });
      expect(listed.body.items![0]).not.toHaveProperty("key");
      expect(JSON.stringify(listed.body)).not.toContain(key);

      const audits = await ownerPool.query<{ action: string }>("select action from audit_events where tenant_id = $1 and entity_id = $2", [tenantId, created.body.id]);
      expect(audits.rows.map((row) => row.action)).toEqual(["integrations.api_key.created"]);
    });

    it("validates the name", async () => {
      expect((await asUser("POST", KEYS_URL, ownerUser, { payload: { name: "  " } })).status).toBe(400);
      expect((await asUser("POST", KEYS_URL, ownerUser, { payload: { name: "x".repeat(101) } })).status).toBe(400);
      expect((await asUser("POST", KEYS_URL, ownerUser, { payload: {} })).status).toBe(400);
    });

    it("requires integrations.manage", async () => {
      expect((await asUser("GET", KEYS_URL, plainUser)).status).toBe(403);
      expect((await asUser("POST", KEYS_URL, plainUser, { payload: { name: "X" } })).status).toBe(403);
      const { id: keyId } = await createKey();
      expect((await asUser("POST", `${KEYS_URL}/${keyId}/revoke`, plainUser)).status).toBe(403);
    });

    it("is restricted to plans with public_api", async () => {
      for (const plan of ["BASICO", "PROFESIONAL"]) {
        await setPlan(plan);
        const listed = await asUser("GET", KEYS_URL, ownerUser);
        expect(listed.status).toBe(403);
        expect(listed.body.code).toBe("PLAN_FEATURE_RESTRICTED");
      }
      await setPlan("COMPLETO");
      expect((await asUser("GET", KEYS_URL, ownerUser)).status).toBe(200);
    });

    it("lists keys of the session branch only and never another pharmacy's", async () => {
      const { id: keyA } = await createKey("Sucursal A");
      await createKey("Sucursal B", ownerUser, branchB);
      const other = await createKey("Otra farmacia", otherOwner, otherBranchId, otherTenantId);

      const listedA = await asUser("GET", KEYS_URL, ownerUser);
      expect(listedA.body.items!.map((item) => item.name)).toEqual(["Sucursal A"]);
      const listedB = await asUser("GET", KEYS_URL, ownerUser, { branchId: branchB });
      expect(listedB.body.items!.map((item) => item.name)).toEqual(["Sucursal B"]);
      const listedOther = await asUser("GET", KEYS_URL, otherOwner, { branchId: otherBranchId, tenant: otherTenantId });
      expect(listedOther.body.items!.map((item) => item.id)).toEqual([other.id]);

      expect((await asUser("POST", `${KEYS_URL}/${other.id}/revoke`, ownerUser)).status).toBe(404);
      expect((await asUser("POST", `${KEYS_URL}/${keyA}/revoke`, otherOwner, { branchId: otherBranchId, tenant: otherTenantId })).status).toBe(404);
      expect((await asUser("POST", `${KEYS_URL}/not-a-uuid/revoke`, ownerUser)).status).toBe(400);
    });
  });

  describe("public API authentication", () => {
    it("accepts a valid key and stamps last_used_at", async () => {
      const { id: keyId, key } = await createKey();
      const response = await withKey(PUBLIC_URL, key);
      expect(response.status).toBe(200);
      const stored = await ownerPool.query<{ last_used_at: Date | null }>("select last_used_at from api_keys where id = $1", [keyId]);
      expect(stored.rows[0]!.last_used_at).toBeInstanceOf(Date);
    });

    it("rejects missing, malformed and unknown keys with 401 INVALID_API_KEY", async () => {
      for (const key of [undefined, "", "not-a-key", `fxk_${"A".repeat(43)}`]) {
        const response = await withKey(PUBLIC_URL, key);
        expect(response.status).toBe(401);
        expect(response.body.code).toBe("INVALID_API_KEY");
      }
    });

    it("rejects a revoked key", async () => {
      const { id: keyId, key } = await createKey();
      expect((await withKey(PUBLIC_URL, key)).status).toBe(200);
      const revoked = await asUser("POST", `${KEYS_URL}/${keyId}/revoke`, ownerUser);
      expect(revoked.status).toBe(201);
      expect(revoked.body.revokedAt).toEqual(expect.any(String));
      const response = await withKey(PUBLIC_URL, key);
      expect(response.status).toBe(401);
      expect(response.body.code).toBe("INVALID_API_KEY");
      // Revoking twice is harmless and audited once.
      expect((await asUser("POST", `${KEYS_URL}/${keyId}/revoke`, ownerUser)).status).toBe(201);
      const audits = await ownerPool.query<{ action: string }>("select action from audit_events where entity_id = $1 order by occurred_at", [keyId]);
      expect(audits.rows.map((row) => row.action)).toEqual(["integrations.api_key.created", "integrations.api_key.revoked"]);
    });

    it("rejects the key when its creator is deactivated or loses the branch", async () => {
      const { key } = await createKey();
      await ownerPool.query("update users set is_active = false where id = $1", [ownerUser]);
      expect((await withKey(PUBLIC_URL, key)).status).toBe(401);
      await ownerPool.query("update users set is_active = true where id = $1", [ownerUser]);
      expect((await withKey(PUBLIC_URL, key)).status).toBe(200);
      await ownerPool.query("delete from user_branch_memberships where user_id = $1 and branch_id = $2", [ownerUser, branchA]);
      expect((await withKey(PUBLIC_URL, key)).status).toBe(401);
    });

    it("rejects the key when the branch is deactivated", async () => {
      const { key } = await createKey();
      await ownerPool.query("update branches set is_active = false where id = $1", [branchA]);
      expect((await withKey(PUBLIC_URL, key)).status).toBe(401);
    });

    it("returns 403 PLAN_FEATURE_RESTRICTED on plans without public_api", async () => {
      const { key } = await createKey();
      for (const plan of ["BASICO", "PROFESIONAL"]) {
        await setPlan(plan);
        const response = await withKey(PUBLIC_URL, key);
        expect(response.status).toBe(403);
        expect(response.body.code).toBe("PLAN_FEATURE_RESTRICTED");
      }
    });

    it("returns 402 SUBSCRIPTION_INACTIVE when the subscription is suspended", async () => {
      const { key } = await createKey();
      await setPlan("PREMIUM", tenantId, "SUSPENDED");
      const response = await withKey(PUBLIC_URL, key);
      expect(response.status).toBe(402);
      expect(response.body.code).toBe("SUBSCRIPTION_INACTIVE");
    });

    it("rate limits each key", async () => {
      const { key } = await createKey("Limite");
      for (let i = 0; i < API_KEY_RATE_LIMIT_PER_MINUTE; i += 1) {
        expect((await withKey(`${PUBLIC_URL}?limit=1`, key)).status).toBe(200);
      }
      const limited = await withKey(`${PUBLIC_URL}?limit=1`, key);
      expect(limited.status).toBe(429);
      expect(limited.body.code).toBe("RATE_LIMITED");
      // Other keys are not affected.
      const { key: second } = await createKey("Otra clave");
      expect((await withKey(PUBLIC_URL, second)).status).toBe(200);
    }, 60_000);
  });
});
