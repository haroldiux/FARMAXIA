import fastifyCookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AccessTokenService } from "../src/auth/access-token.service.js";

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

const id = (n: number) => `00000000-0000-4000-8000-${String(995000 + n).padStart(12, "0")}`;
const tenantId = id(1);
const legalEntityId = id(2);
const branchA = id(11);
const ownerUser = id(21); // integrations.manage
const plainUser = id(22); // no integrations.manage
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

async function setPlan(planCode: string, tenant = tenantId): Promise<void> {
  await ownerPool.query("delete from tenant_subscriptions where tenant_id = $1", [tenant]);
  const plan = await ownerPool.query<{ id: string }>("select id from subscription_plans where code = $1", [planCode]);
  await ownerPool.query("insert into tenant_subscriptions (tenant_id, plan_id, status, starts_at) values ($1, $2, 'ACTIVE', now())", [tenant, plan.rows[0]!.id]);
}

async function seed(): Promise<void> {
  await ownerPool.query(
    `insert into permissions (code, description, label, module, sort_order)
     values ('integrations.manage', 'Manage API keys, webhooks and integrations', 'Administrar integraciones y API', 'Administración', 85)
     on conflict (code) do nothing`
  );
  await ownerPool.query("insert into tenants (id, slug, name) values ($1, 'webhooks', 'Farmacia Webhooks'), ($2, 'webhooks-other', 'Otra Farmacia')", [
    tenantId,
    otherTenantId
  ]);
  await ownerPool.query("insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, 'Webhooks SRL', '9950001'), ($3, $4, 'Otra SRL', '9950002')", [
    legalEntityId,
    tenantId,
    otherLegalEntityId,
    otherTenantId
  ]);
  await ownerPool.query("insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, 'MAIN', 'Central'), ($4, $5, $6, 'OTRA', 'Otra')", [
    branchA,
    tenantId,
    legalEntityId,
    otherBranchId,
    otherTenantId,
    otherLegalEntityId
  ]);
  await ownerPool.query(
    `insert into users (id, email, display_name, password_hash) values
       ($1, 'wh-owner@example.test', 'Duena', 'x'), ($2, 'wh-plain@example.test', 'Sin permiso', 'x'), ($3, 'wh-other@example.test', 'Otra', 'x')`,
    [ownerUser, plainUser, otherOwner]
  );
  await ownerPool.query("insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $3, $4), ($2, $3, $4), ($5, $6, $7)", [
    ownerUser,
    plainUser,
    tenantId,
    branchA,
    otherOwner,
    otherTenantId,
    otherBranchId
  ]);
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
  method: "GET" | "POST" | "PATCH",
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

const URL_BASE = "/api/v1/integrations/webhooks";
const asOther = { branchId: otherBranchId, tenant: otherTenantId };

async function createEndpoint(payload: Record<string, unknown> = {}, userId = ownerUser, options: { branchId?: string; tenant?: string } = {}) {
  const created = await asUser("POST", URL_BASE, userId, {
    ...options,
    payload: { url: "https://shop.example.test/hooks", eventTypes: ["sales.cash_sale_confirmed"], ...payload }
  });
  expect(created.status).toBe(201);
  return created.body as Body & { id: string; secret: string };
}

describe("F19 integrations: webhook endpoints management (T3)", () => {
  beforeAll(async () => {
    await migrate(drizzle(ownerPool), { migrationsFolder });
    await getApp(); // boot once here so the first test does not absorb the app start-up time
  }, 60_000);
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

  it("publishes the catalog of event types", async () => {
    const response = await asUser("GET", `${URL_BASE}/event-types`, ownerUser);
    expect(response.status).toBe(200);
    const types = (response.body.items as unknown as Array<{ type: string }>).map((item) => item.type);
    expect(types).toEqual(
      expect.arrayContaining([
        "*",
        "sales.cash_sale_confirmed",
        "sales.sale_voided",
        "sales.sale_returned",
        "sales.quote_created",
        "sales.quote_converted",
        "sales.quote_canceled",
        "cash.movement_registered",
        "transfers.requested",
        "transfers.approved",
        "transfers.rejected",
        "transfers.dispatched",
        "transfers.received",
        "transfers.partially_received"
      ])
    );
    expect(types).toHaveLength(14);
  });

  it("returns the secret only on creation and lists a masked hint", async () => {
    const created = await asUser("POST", URL_BASE, ownerUser, {
      payload: { url: " https://shop.example.test/hooks ", description: " Tienda ", eventTypes: ["sales.cash_sale_confirmed", "sales.cash_sale_confirmed", "transfers.received"] }
    });
    expect(created.status).toBe(201);
    const secret = created.body.secret as string;
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(created.body).toMatchObject({
      url: "https://shop.example.test/hooks",
      description: "Tienda",
      eventTypes: ["sales.cash_sale_confirmed", "transfers.received"],
      isActive: true,
      createdByUserId: ownerUser,
      secretHint: `whsec_…${secret.slice(-4)}`
    });

    const listed = await asUser("GET", URL_BASE, ownerUser);
    expect(listed.status).toBe(200);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items![0]).toMatchObject({ id: created.body.id, secretHint: `whsec_…${secret.slice(-4)}` });
    expect(listed.body.items![0]).not.toHaveProperty("secret");
    expect(JSON.stringify(listed.body)).not.toContain(secret);

    const audits = await ownerPool.query<{ action: string; payload: unknown }>("select action, payload from audit_events where entity_id = $1", [created.body.id]);
    expect(audits.rows.map((row) => row.action)).toEqual(["integrations.webhook.created"]);
    expect(JSON.stringify(audits.rows)).not.toContain(secret);
  });

  it("validates url, description and event types", async () => {
    const bad = async (payload: Record<string, unknown>) =>
      asUser("POST", URL_BASE, ownerUser, { payload: { url: "https://ok.example.test/h", eventTypes: ["sales.sale_voided"], ...payload } });
    expect((await bad({ url: "http://shop.example.test/hooks" })).body.code).toBe("INVALID_WEBHOOK_URL");
    expect((await bad({ url: "ftp://shop.example.test/hooks" })).status).toBe(400);
    expect((await bad({ url: "not a url" })).status).toBe(400);
    expect((await bad({ url: "https://user:pass@shop.example.test/hooks" })).status).toBe(400);
    expect((await bad({ url: `https://shop.example.test/${"x".repeat(500)}` })).status).toBe(400);
    expect((await bad({ description: "x".repeat(201) })).status).toBe(400);
    const unknown = await bad({ eventTypes: ["sales.unknown"] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe("INVALID_WEBHOOK_EVENT_TYPES");
    expect((await bad({ eventTypes: [] })).status).toBe(400);
    expect((await bad({ eventTypes: "sales.sale_voided" })).status).toBe(400);
    // http is allowed for local development receivers only (D79).
    expect((await bad({ url: "http://localhost:4000/hooks" })).status).toBe(201);
    expect((await bad({ url: "http://127.0.0.1:4000/hooks", eventTypes: ["*"] })).status).toBe(201);
  });

  it("updates an endpoint and audits the change", async () => {
    const created = await createEndpoint();
    const updated = await asUser("PATCH", `${URL_BASE}/${created.id}`, ownerUser, {
      payload: { url: "https://shop.example.test/v2", description: "", eventTypes: ["*"], isActive: false }
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ url: "https://shop.example.test/v2", description: null, eventTypes: ["*"], isActive: false });
    expect(updated.body).not.toHaveProperty("secret");
    expect((await asUser("PATCH", `${URL_BASE}/${created.id}`, ownerUser, { payload: { url: "http://evil.example.test" } })).status).toBe(400);
    expect((await asUser("PATCH", `${URL_BASE}/${created.id}`, ownerUser, { payload: { isActive: "yes" } })).status).toBe(400);
    const audits = await ownerPool.query<{ action: string }>("select action from audit_events where entity_id = $1 order by occurred_at", [created.id]);
    expect(audits.rows.map((row) => row.action)).toEqual(["integrations.webhook.created", "integrations.webhook.updated"]);
  });

  it("rotates the secret and returns the new one once", async () => {
    const created = await createEndpoint();
    const rotated = await asUser("POST", `${URL_BASE}/${created.id}/rotate-secret`, ownerUser);
    expect(rotated.status).toBe(201);
    const secret = rotated.body.secret as string;
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(secret).not.toBe(created.secret);
    const stored = await ownerPool.query<{ secret: string }>("select secret from webhook_endpoints where id = $1", [created.id]);
    expect(stored.rows[0]!.secret).toBe(secret);
    const listed = await asUser("GET", URL_BASE, ownerUser);
    expect(JSON.stringify(listed.body)).not.toContain(secret);
    const audits = await ownerPool.query<{ action: string }>("select action from audit_events where entity_id = $1 order by occurred_at", [created.id]);
    expect(audits.rows.map((row) => row.action)).toEqual(["integrations.webhook.created", "integrations.webhook.secret_rotated"]);
  });

  it("lists the delivery log of an endpoint with status filter and pagination", async () => {
    const created = await createEndpoint();
    const events: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const event = await ownerPool.query<{ id: string }>(
        `insert into outbox_events (tenant_id, branch_id, aggregate_type, aggregate_id, event_type, payload, created_at)
         values ($1, $2, 'sale', $3, 'sales.cash_sale_confirmed', '{}', now() + make_interval(secs => $4)) returning id`,
        [tenantId, branchA, `sale-${i}`, i]
      );
      events.push(event.rows[0]!.id);
    }
    await ownerPool.query(
      `insert into webhook_deliveries (tenant_id, endpoint_id, outbox_event_id, event_type, status, attempts, last_status_code, created_at)
       values ($1, $2, $3, 'sales.cash_sale_confirmed', 'SUCCEEDED', 1, 200, now() - interval '3 minutes'),
              ($1, $2, $4, 'sales.cash_sale_confirmed', 'FAILED', 8, 500, now() - interval '2 minutes'),
              ($1, $2, $5, 'sales.cash_sale_confirmed', 'PENDING', 0, null, now() - interval '1 minute')`,
      [tenantId, created.id, events[0], events[1], events[2]]
    );
    const all = await asUser("GET", `${URL_BASE}/${created.id}/deliveries`, ownerUser);
    expect(all.status).toBe(200);
    expect(all.body.items!.map((item) => item.status)).toEqual(["PENDING", "FAILED", "SUCCEEDED"]);
    expect(all.body.items![1]).toMatchObject({ outboxEventId: events[1], eventType: "sales.cash_sale_confirmed", attempts: 8, lastStatusCode: 500 });
    const failed = await asUser("GET", `${URL_BASE}/${created.id}/deliveries?status=FAILED`, ownerUser);
    expect(failed.body.items!.map((item) => item.outboxEventId)).toEqual([events[1]]);
    const paged = await asUser("GET", `${URL_BASE}/${created.id}/deliveries?limit=1&offset=1`, ownerUser);
    expect(paged.body.items!.map((item) => item.status)).toEqual(["FAILED"]);
    expect((await asUser("GET", `${URL_BASE}/${created.id}/deliveries?status=LOST`, ownerUser)).status).toBe(400);
  });

  it("requires integrations.manage", async () => {
    const created = await createEndpoint();
    expect((await asUser("GET", URL_BASE, plainUser)).status).toBe(403);
    expect((await asUser("POST", URL_BASE, plainUser, { payload: { url: "https://a.example.test", eventTypes: ["*"] } })).status).toBe(403);
    expect((await asUser("PATCH", `${URL_BASE}/${created.id}`, plainUser, { payload: { isActive: false } })).status).toBe(403);
    expect((await asUser("POST", `${URL_BASE}/${created.id}/rotate-secret`, plainUser)).status).toBe(403);
    expect((await asUser("GET", `${URL_BASE}/${created.id}/deliveries`, plainUser)).status).toBe(403);
  });

  it("is restricted to plans with public_api", async () => {
    for (const plan of ["BASICO", "PROFESIONAL"]) {
      await setPlan(plan);
      const listed = await asUser("GET", URL_BASE, ownerUser);
      expect(listed.status).toBe(403);
      expect(listed.body.code).toBe("PLAN_FEATURE_RESTRICTED");
    }
  });

  it("never exposes or changes another pharmacy's endpoints", async () => {
    const mine = await createEndpoint();
    const other = await createEndpoint({ url: "https://other.example.test/h" }, otherOwner, asOther);
    const listed = await asUser("GET", URL_BASE, ownerUser);
    expect(listed.body.items!.map((item) => item.id)).toEqual([mine.id]);
    expect((await asUser("PATCH", `${URL_BASE}/${other.id}`, ownerUser, { payload: { isActive: false } })).status).toBe(404);
    expect((await asUser("POST", `${URL_BASE}/${other.id}/rotate-secret`, ownerUser)).status).toBe(404);
    expect((await asUser("GET", `${URL_BASE}/${other.id}/deliveries`, ownerUser)).status).toBe(404);
    expect((await asUser("PATCH", `${URL_BASE}/not-a-uuid`, ownerUser, { payload: { isActive: false } })).status).toBe(400);
    const stored = await ownerPool.query<{ is_active: boolean }>("select is_active from webhook_endpoints where id = $1", [other.id]);
    expect(stored.rows[0]!.is_active).toBe(true);
  });
});
