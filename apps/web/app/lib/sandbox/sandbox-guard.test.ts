import assert from "node:assert/strict";
import test from "node:test";
import { purgeSandbox } from "./sandbox-store.ts";
import { handleSandboxRequest } from "./sandbox-interceptor.ts";
import { authenticatedFetch } from "../session.ts";

test.beforeEach(() => {
  purgeSandbox();
});

test("unhandled mutating requests are blocked with a Spanish message", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const res = await handleSandboxRequest("/api/v1/some/unknown/write", { method });
    assert.equal(res.handled, true, method);
    assert.equal(res.status, 423, method);
    const body = res.body as { message: string };
    assert.match(body.message, /Modo entrenamiento/);
  }
});

test("unhandled GET requests still fall through to the real API", async () => {
  const res = await handleSandboxRequest("/api/v1/some/unknown/read");
  assert.equal(res.handled, false);
});

test("authenticatedFetch never calls fetch for a mutating request while sandbox is active", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  (globalThis as { window?: unknown }).window = {
    sessionStorage: {
      getItem: (key: string) => (key === "farmaxia.sandbox_active" ? "true" : null),
      setItem: () => {},
      removeItem: () => {},
    },
    location: { pathname: "/dashboard", assign: () => {} },
  };
  try {
    const res = await authenticatedFetch("/api/v1/some/unknown/write", {
      method: "POST",
      body: JSON.stringify({ a: 1 }),
    });
    assert.equal(fetchCalls, 0);
    assert.equal(res.status, 423);
    const body = (await res.json()) as { message: string };
    assert.match(body.message, /Modo entrenamiento/);
  } finally {
    globalThis.fetch = originalFetch;
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

// ---- T2: exact route matching ----

test("/sales/lookup/batches returns correctly shaped batch options, not the product list", async () => {
  const res = await handleSandboxRequest(
    "/api/v1/sales/lookup/batches?presentationId=pres-demo-1&warehouseId=WH-DEMO-01",
  );
  assert.equal(res.handled, true);
  const body = res.body as { items: Array<Record<string, unknown>> };
  assert.equal(body.items.length, 1);
  assert.deepEqual(Object.keys(body.items[0]!).sort(), [
    "availableBase",
    "batchId",
    "expiresOn",
    "fefoSuggested",
    "lotCode",
  ]);
  assert.equal(body.items[0]!.batchId, "batch-demo-1");
  assert.equal(body.items[0]!.fefoSuggested, true);
});

test("/sales/lookup/batches only lists available lots of the requested presentation in FEFO order", async () => {
  await handleSandboxRequest("/api/v1/inventory/batches/batch-demo-2/quarantine", {
    method: "POST",
    body: JSON.stringify({ reason: "x" }),
  });
  const res = await handleSandboxRequest("/api/v1/sales/lookup/batches?presentationId=pres-demo-2");
  assert.deepEqual((res.body as { items: unknown[] }).items, []);
});

test("/inventory/warehouses/details returns WarehouseDetail rows", async () => {
  const res = await handleSandboxRequest("/api/v1/inventory/warehouses/details?includeInactive=true");
  assert.equal(res.handled, true);
  const body = res.body as { items: Array<Record<string, unknown>> };
  assert.equal(body.items.length, 1);
  const wh = body.items[0]!;
  assert.equal(wh.id, "WH-DEMO-01");
  assert.equal(wh.isActive, true);
  assert.equal(wh.batchCount, 4);
  assert.equal(wh.stockBase, 115);
  assert.equal(wh.reservedBase, 0);
  assert.equal(typeof wh.createdAt, "string");
});

test("/inventory/warehouses plain list keeps its own shape", async () => {
  const res = await handleSandboxRequest("/api/v1/inventory/warehouses");
  const body = res.body as { items: Array<Record<string, unknown>> };
  assert.equal(body.items[0]!.isDispatchEnabled, true);
  assert.equal("batchCount" in body.items[0]!, false);
});

test("loose substrings no longer match", async () => {
  const res = await handleSandboxRequest("/api/v1/foo/sales/lookup/extra");
  assert.equal(res.handled, false);
});

test("logout clears sandbox keys and purges the store", async () => {
  const { logout } = await import("../session.ts");
  const { openCashShift: openShift, getSandboxState: snapshot } = await import("./sandbox-store.ts");
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;
  const data = new Map<string, string>([
    ["farmaxia.access_token", "tok"],
    ["farmaxia.sandbox_active", "true"],
    ["farmaxia.sandbox_state", JSON.stringify({ roleCode: "cajero", stepIndex: 1 })],
  ]);
  globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;
  (globalThis as { window?: unknown }).window = {
    sessionStorage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
  };
  try {
    openShift("999.00");
    await logout();
    assert.equal(data.size, 0);
    assert.equal(snapshot().shifts.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

// ---- T5: FEFO horizon + inventory alerts ----

test("expiry alerts honour the horizonDays filter", async () => {
  const wide = await handleSandboxRequest("/api/v1/inventory/expiry-alerts?warehouseId=WH-DEMO-01&horizonDays=90");
  const narrow = await handleSandboxRequest("/api/v1/inventory/expiry-alerts?warehouseId=WH-DEMO-01&horizonDays=30");
  const wideItems = wide.body as Array<{ lotCode: string }>;
  const narrowItems = narrow.body as Array<{ lotCode: string }>;
  assert.ok(narrowItems.length >= 1);
  assert.ok(narrowItems.length < wideItems.length);
  assert.ok(narrowItems.some((a) => a.lotCode === "L-AMOX-01"));
  assert.equal(narrowItems.some((a) => a.lotCode === "L-PARA-01"), false);
});

test("/inventory/alerts is simulated from near-expiry batches", async () => {
  const res = await handleSandboxRequest("/api/v1/inventory/alerts?includeAcknowledged=true");
  assert.equal(res.handled, true);
  const items = (res.body as { items: Array<Record<string, any>> }).items;
  assert.ok(items.length >= 1);
  assert.equal(items[0]!.alertType, "EXPIRING");
  assert.equal(typeof items[0]!.daysToExpiry, "number");
  assert.equal(items[0]!.acknowledgedAt, null);
});
