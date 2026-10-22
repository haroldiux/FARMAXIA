import assert from "node:assert/strict";
import test from "node:test";
import { getSandboxState, purgeSandbox, setSandboxUserId } from "./sandbox-store.ts";
import { handleSandboxRequest } from "./sandbox-interceptor.ts";

test.beforeEach(() => {
  setSandboxUserId("user-demo");
  purgeSandbox();
});

function post(url: string, body: unknown) {
  return handleSandboxRequest(url, { method: "POST", body: JSON.stringify(body) });
}

async function get<T = any>(url: string): Promise<T> {
  const res = await handleSandboxRequest(url);
  assert.equal(res.handled, true, url);
  return res.body as T;
}

function sale(body: Record<string, unknown>) {
  return post("/api/v1/sales/confirm", {
    cashShiftId: "shift-demo-01",
    warehouseId: "WH-DEMO-01",
    payments: [{ method: "CASH", amountBob: "100.00" }],
    lines: [{ presentationId: "pres-demo-1", quantity: 2 }],
    ...body,
  });
}

const rx = {
  doctorName: "Dr. Roberto Mendez",
  doctorLicense: "MED-LPZ-5412",
  patientName: "Ana Clara Silva",
  patientDocument: "4819203 LP",
  issuingCenter: "Clinica Los Andes",
  prescribedAt: "2026-10-20",
};

// ---- Customers and loyalty ----

test("customers search returns demo customers with their points balance", async () => {
  const all = await get<{ items: any[]; total: number }>("/api/v1/customers?active=true&limit=6");
  assert.equal(all.total, all.items.length);
  assert.ok(all.items.length >= 2);
  assert.equal(typeof all.items[0].loyaltyBalance, "number");

  const filtered = await get<{ items: any[] }>("/api/v1/customers?q=maria&active=true&limit=6");
  assert.equal(filtered.items.length, 1);
  assert.match(filtered.items[0].fullName, /Mar/);
  const byDoc = await get<{ items: any[] }>(`/api/v1/customers?q=${all.items[1].docNumber}`);
  assert.equal(byDoc.items[0].id, all.items[1].id);
});

test("loyalty and agreements lookups feed the POS customer picker", async () => {
  const [customer] = (await get<{ items: any[] }>("/api/v1/customers")).items;
  const loyalty = await get<any>(`/api/v1/customers/${customer.id}/loyalty?limit=1`);
  assert.equal(loyalty.customerId, customer.id);
  assert.equal(loyalty.balance, customer.loyaltyBalance);
  assert.equal(loyalty.settings.enabled, true);
  assert.equal(typeof loyalty.settings.pointValueBob, "string");
  assert.ok(Array.isArray(loyalty.movements.items));

  assert.deepEqual((await get<any>(`/api/v1/customers/${customer.id}/agreements`)).items, []);
  assert.equal((await get<any>("/api/v1/loyalty/settings")).enabled, true);
});

test("a sale with a customer records them and earns points", async () => {
  const [customer] = (await get<{ items: any[] }>("/api/v1/customers")).items;
  const before = customer.loyaltyBalance as number;
  const res = await sale({ customerId: customer.id });
  assert.equal(res.status, 201);
  const confirmed = res.body as any;
  assert.equal(confirmed.customer.id, customer.id);
  assert.equal(confirmed.customer.fullName, customer.fullName);
  assert.ok(confirmed.loyalty.earned > 0);
  assert.equal(confirmed.loyalty.redeemed, 0);
  assert.equal(confirmed.loyalty.balance, before + confirmed.loyalty.earned);

  const loyalty = await get<any>(`/api/v1/customers/${customer.id}/loyalty?limit=5`);
  assert.equal(loyalty.balance, before + confirmed.loyalty.earned);
  assert.equal(loyalty.movements.items[0].kind, "EARN");
  assert.equal(loyalty.movements.items[0].saleNumber, confirmed.saleNumber);
});

test("a sale without customer has null customer and loyalty; unknown customer is rejected", async () => {
  const plain = (await sale({})).body as any;
  assert.equal(plain.customer, null);
  assert.equal(plain.loyalty, null);
  const bad = await sale({ customerId: "ghost" });
  assert.equal(bad.status, 400);
  assert.equal(getSandboxState().sales.length, 1);
});

test("paying with points redeems them and needs enough balance", async () => {
  const [customer] = (await get<{ items: any[] }>("/api/v1/customers")).items;
  const pointValue = Number((await get<any>("/api/v1/loyalty/settings")).pointValueBob);
  const redeemBob = (5 * pointValue).toFixed(2);
  const res = await sale({
    customerId: customer.id,
    lines: [{ presentationId: "pres-demo-1", quantity: 1 }],
    payments: [
      { method: "POINTS", amountBob: redeemBob },
      { method: "CASH", amountBob: (12.5 - Number(redeemBob)).toFixed(2) },
    ],
  });
  assert.equal(res.status, 201);
  assert.equal((res.body as any).loyalty.redeemed, 5);

  const tooMuch = await sale({
    customerId: customer.id,
    lines: [{ presentationId: "pres-demo-1", quantity: 1 }],
    payments: [{ method: "POINTS", amountBob: "12.50" }, { method: "CASH", amountBob: "0.00" }],
  });
  // 12.50 / 0.10 = 125 points; the demo balance is below that.
  assert.equal(tooMuch.status, 400);
});

// ---- Sale detail for the receipt ----

test("GET /sales/:id returns the SaleDetail used by the receipt page", async () => {
  const [customer] = (await get<{ items: any[] }>("/api/v1/customers")).items;
  const confirmed = (await sale({ customerId: customer.id })).body as any;
  const detail = await get<any>(`/api/v1/sales/${confirmed.id}`);
  assert.equal(detail.id, confirmed.id);
  assert.equal(detail.number, confirmed.saleNumber);
  assert.equal(detail.status, "CONFIRMED");
  assert.equal(detail.totalBob, "25.00");
  assert.equal(detail.pharmacy.legalName.length > 0, true);
  assert.equal(detail.branch.code.length > 0, true);
  assert.equal(detail.warehouse.id, "WH-DEMO-01");
  assert.equal(detail.shift.id, "shift-demo-01");
  assert.deepEqual(detail.returns, []);
  assert.equal(detail.void, null);
  assert.equal(detail.items[0].productName, "Paracetamol 500 mg");
  assert.equal(detail.items[0].presentationName, "Caja x 20 comprimidos");
  assert.equal(detail.items[0].returnedQuantity, 0);
  assert.ok(detail.items[0].allocations[0].lotCode);
  assert.equal(detail.payments[0].reversed, false);
  assert.equal(detail.payments[0].reference, null);
  assert.equal(detail.customer.fullName, customer.fullName);
  assert.equal(detail.loyalty.earned, confirmed.loyalty.earned);
});

test("GET /sales/:id for an unknown sale is a 404 with a message", async () => {
  const res = await handleSandboxRequest("/api/v1/sales/sale-demo-9999");
  assert.equal(res.handled, true);
  assert.equal(res.status, 404);
  assert.equal(typeof (res.body as any).message, "string");
});

// ---- Controlled medicines ----

async function controlledSale() {
  return sale({
    lines: [{ presentationId: "pres-demo-3", quantity: 2 }],
    payments: [{ method: "CASH", amountBob: "90.00" }],
    prescription: rx,
  });
}

test("controlled prescriptions list and detail come from sandbox sales", async () => {
  assert.deepEqual((await get<any>("/api/v1/controlled/prescriptions?limit=20&offset=0")).items, []);

  const confirmed = (await controlledSale()).body as any;
  assert.ok(confirmed.prescription.id);
  const list = await get<any>("/api/v1/controlled/prescriptions?limit=20&offset=0");
  assert.equal(list.total, 1);
  const item = list.items[0];
  assert.equal(item.id, confirmed.prescription.id);
  assert.equal(item.folio, confirmed.prescription.folio);
  assert.equal(item.saleId, confirmed.id);
  assert.equal(item.saleNumber, confirmed.saleNumber);
  assert.equal(item.items[0].isControlled, true);
  assert.equal(item.items[0].lots[0].quantityBase, 2);

  const filtered = await get<any>("/api/v1/controlled/prescriptions?q=silva");
  assert.equal(filtered.total, 1);
  const none = await get<any>("/api/v1/controlled/prescriptions?q=zzzz");
  assert.equal(none.total, 0);

  const detail = await get<any>(`/api/v1/controlled/prescriptions/${item.id}`);
  assert.equal(detail.patientName, "Ana Clara Silva");
  const missing = await handleSandboxRequest("/api/v1/controlled/prescriptions/ghost");
  assert.equal(missing.status, 404);
});

test("controlled book and balance reflect the dispensed lot", async () => {
  const month = new Date().toISOString().slice(0, 7);
  const empty = await get<any>(`/api/v1/controlled/book?month=${month}`);
  assert.deepEqual(empty.lines, []);

  const confirmed = (await controlledSale()).body as any;
  const book = await get<any>(`/api/v1/controlled/book?month=${month}`);
  assert.equal(book.month, month);
  assert.equal(book.openings[0].productName, "Clonazepam 2 mg");
  assert.equal(book.openings[0].openingBase, 20);
  assert.equal(book.lines.length, 1);
  const line = book.lines[0];
  assert.equal(line.movementType, "SALE");
  assert.equal(line.quantityOut, 2);
  assert.equal(line.quantityIn, 0);
  assert.equal(line.balanceBase, 18);
  assert.equal(line.lotCode, "L-CLON-01");
  assert.equal(line.document.number, confirmed.saleNumber);
  assert.equal(line.prescription.folio, confirmed.prescription.folio);

  const balance = await get<any>(`/api/v1/controlled/balance?month=${month}`);
  const clon = balance.items[0];
  assert.equal(clon.openingBase, 20);
  assert.equal(clon.exits.total, 2);
  assert.equal(clon.exits.byType.SALE, 2);
  assert.equal(clon.closingBase, 18);
  assert.equal(clon.currentStockBase, 18);

  const other = await get<any>("/api/v1/controlled/book?month=2020-01");
  assert.deepEqual(other.lines, []);
});

// ---- Waste acts ----

test("waste acts list and detail show the simulated act", async () => {
  assert.deepEqual((await get<any>("/api/v1/inventory/waste-acts")).items, []);
  const res = await post("/api/v1/inventory/batches/batch-demo-2/waste", {
    quantityBase: 3,
    reason: "Frasco roto",
    disposalMethod: "DESTRUCTION",
  });
  assert.equal(res.status, 201);
  const list = await get<any>("/api/v1/inventory/waste-acts");
  assert.equal(list.items.length, 1);
  const act = list.items[0];
  assert.equal(act.actNumber, "AB-DEMO-0001");
  assert.equal(act.lotCode, "L-AMOX-01");
  assert.equal(act.quantityBase, 3);
  assert.equal(act.disposalMethod, "DESTRUCTION");
  assert.equal(typeof act.warehouseName, "string");

  const detail = await get<any>(`/api/v1/inventory/waste-acts/${act.id}`);
  assert.equal(detail.actNumber, "AB-DEMO-0001");
  assert.equal(typeof detail.legalName, "string");
  assert.equal(typeof detail.totalCost, "string");
});

test("non-demo sale routes are not hijacked (summary keeps reading the real API)", async () => {
  const res = await handleSandboxRequest("/api/v1/sales/summary");
  assert.equal(res.handled, false);
});
