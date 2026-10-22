import assert from "node:assert/strict";
import test from "node:test";
import { getSandboxState, purgeSandbox } from "./sandbox-store.ts";
import { handleSandboxRequest } from "./sandbox-interceptor.ts";

test.beforeEach(() => {
  purgeSandbox();
});

function post(url: string, body: unknown) {
  return handleSandboxRequest(url, { method: "POST", body: JSON.stringify(body) });
}

// ---- Procurement ----

test("procurement lists expose a pending purchase order from Laboratorios Bago", async () => {
  const orders = await handleSandboxRequest("/api/v1/procurement/purchase-orders");
  assert.equal(orders.handled, true);
  const items = (orders.body as { items: Array<Record<string, any>> }).items;
  assert.equal(items.length, 1);
  assert.equal(items[0]!.status, "SUBMITTED");
  assert.match(items[0]!.supplierName, /Bag/);
  assert.equal(items[0]!.lines[0].receivedBase, 0);

  const suppliers = await handleSandboxRequest("/api/v1/procurement/suppliers");
  assert.equal((suppliers.body as { items: unknown[] }).items.length, 1);
  const presentations = await handleSandboxRequest("/api/v1/procurement/presentations");
  assert.equal((presentations.body as { items: unknown[] }).items.length, 4);
  const receipts = await handleSandboxRequest("/api/v1/procurement/receipts");
  assert.deepEqual((receipts.body as { items: unknown[] }).items, []);
  const costs = await handleSandboxRequest("/api/v1/procurement/costs");
  assert.deepEqual((costs.body as { items: unknown[] }).items, []);
});

test("receiving a batch creates inventory, a receipt and updates the order", async () => {
  const [order] = (
    (await handleSandboxRequest("/api/v1/procurement/purchase-orders")).body as { items: Array<Record<string, any>> }
  ).items;
  const line = order!.lines[0];
  const res = await post("/api/v1/procurement/receipts", {
    idempotencyKey: "k1",
    supplierId: order!.supplierId,
    purchaseOrderId: order!.id,
    warehouseId: order!.warehouseId,
    receivedAt: new Date().toISOString(),
    lines: [
      { presentationId: line.presentationId, lotCode: "L-NEW-01", expiresOn: "2028-01-31", quantityBase: 40, unitCost: "8.5000" },
    ],
  });
  assert.equal(res.status, 201);
  const result = res.body as { receiptId: string; lineCount: number };
  assert.equal(result.lineCount, 1);

  const state = getSandboxState();
  const batch = state.batches.find((b) => b.lotCode === "L-NEW-01");
  assert.ok(batch);
  assert.equal(batch.availableQuantity, 40);
  assert.equal(batch.status, "AVAILABLE");
  assert.equal(state.purchaseOrders[0]!.status, "PARTIALLY_RECEIVED");

  const receipts = await handleSandboxRequest("/api/v1/procurement/receipts");
  assert.equal((receipts.body as { items: Array<{ id: string }> }).items[0]!.id, result.receiptId);
});

test("receiving more than ordered, or an unknown order, is rejected without side effects", async () => {
  const [order] = (
    (await handleSandboxRequest("/api/v1/procurement/purchase-orders")).body as { items: Array<Record<string, any>> }
  ).items;
  const line = order!.lines[0];
  const tooMuch = await post("/api/v1/procurement/receipts", {
    purchaseOrderId: order!.id,
    warehouseId: order!.warehouseId,
    lines: [{ presentationId: line.presentationId, lotCode: "L-X", expiresOn: "2028-01-31", quantityBase: 9999, unitCost: "1" }],
  });
  assert.equal(tooMuch.status, 400);
  const unknown = await post("/api/v1/procurement/receipts", { purchaseOrderId: "nope", warehouseId: "w", lines: [] });
  assert.equal(unknown.status, 400);
  assert.equal(getSandboxState().batches.length, 4);
});

// ---- Transfers ----

test("transfer lookups list two warehouses and stock of the origin", async () => {
  const wh = await handleSandboxRequest("/api/v1/transfers/lookup/warehouses");
  const whItems = (wh.body as { items: Array<Record<string, any>> }).items;
  assert.equal(whItems.length, 2);
  assert.deepEqual(Object.keys(whItems[0]!).sort(), ["branchId", "branchName", "id", "name", "warehouseType"]);

  const stock = await handleSandboxRequest("/api/v1/transfers/lookup/stock?warehouseId=WH-DEMO-01");
  const stockItems = (stock.body as { items: Array<Record<string, any>> }).items;
  assert.equal(stockItems.length, 4);
  assert.deepEqual(Object.keys(stockItems[0]!).sort(), [
    "availableQty",
    "batchId",
    "lotCode",
    "presentationId",
    "presentationName",
    "productName",
  ]);
});

test("requesting a transfer stores a REQUESTED transfer visible in the list and detail", async () => {
  const res = await post("/api/v1/transfers", {
    idempotencyKey: "t1",
    originWarehouseId: "WH-DEMO-01",
    destinationWarehouseId: "WH-DEMO-02",
    items: [{ presentationId: "pres-demo-1", batchId: "batch-demo-1", requestedQty: 5 }],
  });
  assert.equal(res.status, 201);
  const transfer = res.body as Record<string, any>;
  assert.equal(transfer.status, "REQUESTED");
  assert.equal(transfer.items[0].requestedQty, 5);
  // A request does not move stock.
  assert.equal(getSandboxState().batches.find((b) => b.id === "batch-demo-1")!.availableQuantity, 50);

  const list = await handleSandboxRequest("/api/v1/transfers");
  assert.equal((list.body as { items: unknown[] }).items.length, 1);
  const detail = await handleSandboxRequest(`/api/v1/transfers/${transfer.id}`);
  assert.equal((detail.body as { id: string }).id, transfer.id);
});

test("invalid transfer requests are rejected", async () => {
  const same = await post("/api/v1/transfers", {
    originWarehouseId: "WH-DEMO-01",
    destinationWarehouseId: "WH-DEMO-01",
    items: [{ presentationId: "pres-demo-1", batchId: "batch-demo-1", requestedQty: 1 }],
  });
  assert.equal(same.status, 400);
  const tooMany = await post("/api/v1/transfers", {
    originWarehouseId: "WH-DEMO-01",
    destinationWarehouseId: "WH-DEMO-02",
    items: [{ presentationId: "pres-demo-1", batchId: "batch-demo-1", requestedQty: 5000 }],
  });
  assert.equal(tooMany.status, 400);
  assert.equal(getSandboxState().transfers.length, 0);
});

// ---- Staff ----

test("staff members and weekly shifts are simulated and filtered by range", async () => {
  const members = await handleSandboxRequest("/api/v1/staff/members");
  const memberList = members.body as Array<{ userId: string; displayName: string }>;
  assert.ok(memberList.length >= 2);

  const created = await post("/api/v1/staff/shifts", {
    userId: memberList[0]!.userId,
    kind: "REGULAR",
    startsAt: "2030-03-04T12:00:00.000Z",
    endsAt: "2030-03-04T20:00:00.000Z",
    notes: null,
  });
  assert.equal(created.status, 201);
  const shift = created.body as Record<string, any>;
  assert.equal(shift.status, "SCHEDULED");
  assert.equal(shift.userName, memberList[0]!.displayName);

  const inRange = await handleSandboxRequest("/api/v1/staff/shifts?from=2030-03-04&to=2030-03-10");
  assert.equal((inRange.body as unknown[]).some((s: any) => s.id === shift.id), true);
  const outOfRange = await handleSandboxRequest("/api/v1/staff/shifts?from=2030-04-01&to=2030-04-07");
  assert.equal((outOfRange.body as unknown[]).some((s: any) => s.id === shift.id), false);
});

test("staff shift with end before start or unknown user is rejected", async () => {
  const bad = await post("/api/v1/staff/shifts", {
    userId: "user-demo",
    kind: "REGULAR",
    startsAt: "2030-03-04T20:00:00.000Z",
    endsAt: "2030-03-04T12:00:00.000Z",
  });
  assert.equal(bad.status, 400);
  const unknown = await post("/api/v1/staff/shifts", {
    userId: "ghost",
    kind: "REGULAR",
    startsAt: "2030-03-04T12:00:00.000Z",
    endsAt: "2030-03-04T20:00:00.000Z",
  });
  assert.equal(unknown.status, 400);
});

// ---- Users ----

test("created users appear in the users list with resolved roles and branches", async () => {
  const roles = (await handleSandboxRequest("/api/v1/roles")).body as Array<{ id: string; name: string }>;
  const branches = (await handleSandboxRequest("/api/v1/branches")).body as Array<{ id: string }>;
  const perms = (await handleSandboxRequest("/api/v1/permissions")).body as unknown[];
  assert.ok(roles.length >= 2 && branches.length >= 1 && perms.length >= 1);

  const before = ((await handleSandboxRequest("/api/v1/users")).body as unknown[]).length;
  const res = await post("/api/v1/users", {
    displayName: "Nuevo Colaborador",
    email: "nuevo@demo.test",
    password: "Clave-Segura-1",
    roleIds: [roles[0]!.id],
    branchIds: [branches[0]!.id],
  });
  assert.equal(res.status, 201);
  const users = (await handleSandboxRequest("/api/v1/users")).body as Array<Record<string, any>>;
  assert.equal(users.length, before + 1);
  const created = users.find((u) => u.email === "nuevo@demo.test");
  assert.ok(created);
  assert.equal(created.roles[0].name, roles[0]!.name);
  assert.equal(created.branches[0].id, branches[0]!.id);
  assert.equal("password" in created, false);
});

test("duplicate or incomplete users are rejected", async () => {
  const first = await post("/api/v1/users", {
    displayName: "A",
    email: "a@demo.test",
    password: "Clave-Segura-1",
    roleIds: [],
    branchIds: [],
  });
  assert.equal(first.status, 201);
  const dup = await post("/api/v1/users", { displayName: "B", email: "A@demo.test", password: "Clave-Segura-1", roleIds: [], branchIds: [] });
  assert.equal(dup.status, 400);
  const incomplete = await post("/api/v1/users", { displayName: "", email: "", password: "" });
  assert.equal(incomplete.status, 400);
});

test("purge removes simulated procurement, transfers, shifts and users", async () => {
  await post("/api/v1/users", { displayName: "A", email: "a@demo.test", password: "Clave-Segura-1", roleIds: [], branchIds: [] });
  purgeSandbox();
  const state = getSandboxState();
  assert.equal(state.transfers.length, 0);
  assert.equal(state.goodsReceipts.length, 0);
  assert.equal(state.users.some((u) => u.email === "a@demo.test"), false);
});
