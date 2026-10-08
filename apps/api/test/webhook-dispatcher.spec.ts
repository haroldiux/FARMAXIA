import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createHmac } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  WEBHOOK_MAX_ATTEMPTS,
  WebhookDispatcherService,
  verifyWebhookSignature,
  type WebhookFetch
} from "../src/integrations/webhook-dispatcher.service.js";
import { PlatformDatabase } from "../src/saas/platform-database.js";

function withDatabaseName(connectionString: string, databaseName: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}
const role = (name: string) => withDatabaseName(`postgresql://${name}:local-development-only@localhost:5433/farmaxia`, "farmaxia_test");
const testOwnerUrl =
  process.env.DATABASE_TEST_URL ??
  withDatabaseName(process.env.DATABASE_URL ?? "postgresql://farmaxia:local-development-only@localhost:5433/farmaxia", "farmaxia_test");
const testPlatformUrl = process.env.DATABASE_PLATFORM_TEST_URL ?? role("farmaxia_platform");

const id = (n: number) => `00000000-0000-4000-8000-${String(996000 + n).padStart(12, "0")}`;
const tenantA = id(1);
const tenantB = id(2);
const branchA = id(11);
const branchB = id(12);
const userA = id(21);
const userB = id(22);
const SECRET_A = "whsec_test-secret-a";
const SECRET_B = "whsec_test-secret-b";

const ownerPool = new Pool({ connectionString: testOwnerUrl });
const platform = new PlatformDatabase(testPlatformUrl);
const dispatcher = new WebhookDispatcherService(platform);
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

/** Base clock: every endpoint is created at T0 unless stated otherwise. */
const T0 = new Date("2026-10-01T12:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

interface SentRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function fakeFetch(respond: (request: SentRequest, index: number) => Promise<Response> | Response = () => new Response("ok", { status: 200 })) {
  const sent: SentRequest[] = [];
  const fetchImpl: WebhookFetch = async (url, init) => {
    const request = { url: String(url), headers: { ...(init.headers as Record<string, string>) }, body: String(init.body) };
    sent.push(request);
    return respond(request, sent.length - 1);
  };
  return { sent, fetchImpl };
}

async function seed(): Promise<void> {
  await ownerPool.query("insert into tenants (id, slug, name) values ($1, 'dispatch-a', 'Farmacia A'), ($2, 'dispatch-b', 'Farmacia B')", [tenantA, tenantB]);
  await ownerPool.query("insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, 'A SRL', '9960001'), ($3, $4, 'B SRL', '9960002')", [
    id(3),
    tenantA,
    id(4),
    tenantB
  ]);
  await ownerPool.query("insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, 'MAIN', 'A'), ($4, $5, $6, 'MAIN', 'B')", [
    branchA,
    tenantA,
    id(3),
    branchB,
    tenantB,
    id(4)
  ]);
  await ownerPool.query("insert into users (id, email, display_name, password_hash) values ($1, 'disp-a@example.test', 'A', 'x'), ($2, 'disp-b@example.test', 'B', 'x')", [
    userA,
    userB
  ]);
}

async function addEndpoint(options: { tenant?: string; user?: string; url?: string; secret?: string; eventTypes?: string[]; createdAt?: Date; isActive?: boolean } = {}) {
  const result = await ownerPool.query<{ id: string }>(
    `insert into webhook_endpoints (tenant_id, url, secret, event_types, is_active, created_by_user_id, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $7) returning id`,
    [
      options.tenant ?? tenantA,
      options.url ?? "https://shop-a.example.test/hooks",
      options.secret ?? SECRET_A,
      options.eventTypes ?? ["sales.cash_sale_confirmed"],
      options.isActive ?? true,
      options.user ?? userA,
      options.createdAt ?? T0
    ]
  );
  return result.rows[0]!.id;
}

async function addEvent(eventType: string, createdAt: Date, options: { tenant?: string; branch?: string; payload?: Record<string, unknown> } = {}) {
  const result = await ownerPool.query<{ id: string }>(
    `insert into outbox_events (tenant_id, branch_id, aggregate_type, aggregate_id, event_type, payload, created_at)
     values ($1, $2, 'sale', 'agg-1', $3, $4, $5) returning id`,
    [options.tenant ?? tenantA, options.branch ?? branchA, eventType, JSON.stringify(options.payload ?? { saleId: "s-1", total: 10 }), createdAt]
  );
  return result.rows[0]!.id;
}

async function deliveries(endpointId?: string) {
  const result = await ownerPool.query<{
    id: string;
    endpoint_id: string;
    outbox_event_id: string;
    status: string;
    attempts: number;
    next_attempt_at: Date;
    last_status_code: number | null;
    last_error: string | null;
    delivered_at: Date | null;
  }>(`select * from webhook_deliveries ${endpointId ? "where endpoint_id = $1" : ""} order by created_at, id`, endpointId ? [endpointId] : []);
  return result.rows;
}

describe("F19 webhook dispatcher (T3)", () => {
  beforeAll(async () => {
    await migrate(drizzle(ownerPool), { migrationsFolder });
  });
  afterAll(async () => {
    await platform.close();
    await ownerPool.end();
  });
  beforeEach(async () => {
    await ownerPool.query("truncate table tenants, users cascade");
    await seed();
  });

  it("fans out only matching events created after the endpoint, without duplicates and without touching the outbox", async () => {
    const endpoint = await addEndpoint();
    const wildcard = await addEndpoint({ url: "https://all.example.test/h", eventTypes: ["*"] });
    await addEvent("sales.cash_sale_confirmed", at(-5)); // before both endpoints
    const matching = await addEvent("sales.cash_sale_confirmed", at(1));
    const other = await addEvent("transfers.requested", at(2));

    const { fetchImpl } = fakeFetch();
    const first = await dispatcher.runOnce({ now: at(10), fetchImpl });
    expect(first.enqueued).toBe(3);
    expect((await deliveries(endpoint)).map((row) => row.outbox_event_id)).toEqual([matching]);
    expect((await deliveries(wildcard)).map((row) => row.outbox_event_id).sort()).toEqual([matching, other].sort());

    const second = await dispatcher.runOnce({ now: at(11), fetchImpl });
    expect(second.enqueued).toBe(0);
    expect(await deliveries()).toHaveLength(3);

    const outbox = await ownerPool.query<{ status: string; processed_at: Date | null }>("select status, processed_at from outbox_events");
    expect(outbox.rows.every((row) => row.status === "PENDING" && row.processed_at === null)).toBe(true);
  });

  it("posts a signed JSON payload and marks the delivery SUCCEEDED", async () => {
    const endpoint = await addEndpoint();
    const eventId = await addEvent("sales.cash_sale_confirmed", at(1), { payload: { saleId: "s-9", total: 25.5 } });
    const { sent, fetchImpl } = fakeFetch();
    const result = await dispatcher.runOnce({ now: at(10), fetchImpl });
    expect(result).toMatchObject({ enqueued: 1, attempted: 1, succeeded: 1 });
    expect(sent).toHaveLength(1);
    const [request] = sent;
    const [delivery] = await deliveries(endpoint);
    expect(request!.url).toBe("https://shop-a.example.test/hooks");
    expect(request!.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Farmaxia-Event": "sales.cash_sale_confirmed",
      "X-Farmaxia-Delivery": delivery!.id
    });
    expect(JSON.parse(request!.body)).toEqual({
      id: delivery!.id,
      type: "sales.cash_sale_confirmed",
      occurredAt: at(1).toISOString(),
      tenantId: tenantA,
      branchId: branchA,
      data: { saleId: "s-9", total: 25.5 }
    });
    const signature = request!.headers["X-Farmaxia-Signature"]!;
    const t = Math.floor(at(10).getTime() / 1000);
    expect(signature).toBe(`t=${t},v1=${createHmac("sha256", SECRET_A).update(`${t}.${request!.body}`).digest("hex")}`);
    expect(verifyWebhookSignature(SECRET_A, signature, request!.body, 300, t + 10)).toBe(true);
    expect(verifyWebhookSignature(SECRET_B, signature, request!.body, 300, t + 10)).toBe(false);
    expect(verifyWebhookSignature(SECRET_A, signature, `${request!.body} `, 300, t + 10)).toBe(false);
    expect(verifyWebhookSignature(SECRET_A, signature, request!.body, 300, t + 301)).toBe(false);
    expect(verifyWebhookSignature(SECRET_A, "garbage", request!.body, 300, t)).toBe(false);

    expect(delivery).toMatchObject({ outbox_event_id: eventId, status: "SUCCEEDED", attempts: 1, last_status_code: 200, last_error: null });
    expect(delivery!.delivered_at).toBeInstanceOf(Date);
    // A succeeded delivery is never sent again.
    await dispatcher.runOnce({ now: at(500), fetchImpl });
    expect(sent).toHaveLength(1);
  });

  it("retries non-2xx responses with exponential backoff and fails after the maximum attempts", async () => {
    const endpoint = await addEndpoint();
    await addEvent("sales.cash_sale_confirmed", at(1));
    const { sent, fetchImpl } = fakeFetch(() => new Response("boom", { status: 503 }));

    const first = await dispatcher.runOnce({ now: at(10), fetchImpl });
    expect(first).toMatchObject({ attempted: 1, succeeded: 0, retried: 1, failed: 0 });
    let [delivery] = await deliveries(endpoint);
    expect(delivery).toMatchObject({ status: "PENDING", attempts: 1, last_status_code: 503 });
    expect(delivery!.next_attempt_at.toISOString()).toBe(at(11).toISOString()); // +1 minute

    // Not due yet: nothing is sent.
    await dispatcher.runOnce({ now: at(10.5), fetchImpl });
    expect(sent).toHaveLength(1);

    await dispatcher.runOnce({ now: at(11), fetchImpl });
    [delivery] = await deliveries(endpoint);
    expect(delivery).toMatchObject({ status: "PENDING", attempts: 2 });
    expect(delivery!.next_attempt_at.toISOString()).toBe(at(16).toISOString()); // +5 minutes

    let now = delivery!.next_attempt_at;
    while (delivery!.status === "PENDING") {
      await dispatcher.runOnce({ now, fetchImpl });
      [delivery] = await deliveries(endpoint);
      now = delivery!.next_attempt_at;
    }
    expect(delivery).toMatchObject({ status: "FAILED", attempts: WEBHOOK_MAX_ATTEMPTS, last_status_code: 503 });
    expect(sent).toHaveLength(WEBHOOK_MAX_ATTEMPTS);
    await dispatcher.runOnce({ now: at(100_000), fetchImpl });
    expect(sent).toHaveLength(WEBHOOK_MAX_ATTEMPTS);
  });

  it("records network errors and timeouts", async () => {
    const endpoint = await addEndpoint();
    await addEvent("sales.cash_sale_confirmed", at(1));
    const network = fakeFetch(() => {
      throw new TypeError("fetch failed: ECONNREFUSED");
    });
    await dispatcher.runOnce({ now: at(10), fetchImpl: network.fetchImpl });
    let [delivery] = await deliveries(endpoint);
    expect(delivery).toMatchObject({ status: "PENDING", attempts: 1, last_status_code: null });
    expect(delivery!.last_error).toContain("ECONNREFUSED");

    const hanging: WebhookFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    await dispatcher.runOnce({ now: at(11), fetchImpl: hanging, timeoutMs: 50 });
    [delivery] = await deliveries(endpoint);
    expect(delivery).toMatchObject({ status: "PENDING", attempts: 2, last_status_code: null });
    expect(delivery!.last_error).toMatch(/timeout/i);
  });

  it("holds deliveries of inactive endpoints and never fans out to them", async () => {
    const endpoint = await addEndpoint();
    await addEvent("sales.cash_sale_confirmed", at(1));
    await dispatcher.runOnce({ now: at(2), fetchImpl: fakeFetch(() => new Response(null, { status: 500 })).fetchImpl });
    await ownerPool.query("update webhook_endpoints set is_active = false where id = $1", [endpoint]);
    await addEvent("sales.cash_sale_confirmed", at(3));

    const { sent, fetchImpl } = fakeFetch();
    const result = await dispatcher.runOnce({ now: at(60), fetchImpl });
    expect(result).toMatchObject({ enqueued: 0, attempted: 0 });
    expect(sent).toHaveLength(0);
    expect((await deliveries(endpoint)).map((row) => row.status)).toEqual(["PENDING"]);
  });

  it("never sends a pharmacy's event to another pharmacy's endpoint", async () => {
    const endpointA = await addEndpoint({ eventTypes: ["*"] });
    const endpointB = await addEndpoint({ tenant: tenantB, user: userB, url: "https://shop-b.example.test/h", secret: SECRET_B, eventTypes: ["*"] });
    const eventA = await addEvent("sales.cash_sale_confirmed", at(1));
    const eventB = await addEvent("transfers.requested", at(1), { tenant: tenantB, branch: branchB });

    const { sent, fetchImpl } = fakeFetch();
    await dispatcher.runOnce({ now: at(5), fetchImpl });
    expect((await deliveries(endpointA)).map((row) => row.outbox_event_id)).toEqual([eventA]);
    expect((await deliveries(endpointB)).map((row) => row.outbox_event_id)).toEqual([eventB]);
    const toB = sent.filter((request) => request.url.includes("shop-b"));
    expect(toB.map((request) => JSON.parse(request.body).tenantId)).toEqual([tenantB]);
    expect(verifyWebhookSignature(SECRET_B, toB[0]!.headers["X-Farmaxia-Signature"]!, toB[0]!.body, 300, Math.floor(at(5).getTime() / 1000))).toBe(true);
  });
});
