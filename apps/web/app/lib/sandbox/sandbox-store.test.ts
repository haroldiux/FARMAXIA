import assert from "node:assert/strict";
import test from "node:test";
import {
  getSandboxState,
  purgeSandbox,
  openCashShift,
  addCashMovement,
  closeCashShift,
  confirmMockSale,
  quarantineMockBatch,
  recordMockWaste,
} from "./sandbox-store.ts";
import { handleSandboxRequest } from "./sandbox-interceptor.ts";

test.beforeEach(() => {
  purgeSandbox();
});

test("initial sandbox state contains realistic seed products and batches", () => {
  const state = getSandboxState();

  assert.ok(state.products.length >= 3);
  const paracetamol = state.products.find((p) => p.name.includes("Paracetamol"));
  assert.ok(paracetamol);
  assert.equal(paracetamol.isControlled, false);

  const clonazepam = state.products.find((p) => p.name.includes("Clonazepam"));
  assert.ok(clonazepam);
  assert.equal(clonazepam.isControlled, true);

  assert.ok(state.batches.length >= 3);
  const amoxBatch = state.batches.find((b) => b.lotCode === "L-AMOX-01");
  assert.ok(amoxBatch);
  assert.equal(amoxBatch.status, "AVAILABLE");
  assert.ok(amoxBatch.availableQuantity > 0);
});

test("cash shift lifecycle: open, cash movements (IN/OUT), and close with difference", () => {
  // Open shift
  const shift = openCashShift("200.00", "CAJA-DEMO-02");
  assert.equal(shift.status, "OPEN");
  assert.equal(shift.initialFundBob, "200.00");
  assert.equal(shift.currentCashBob, "200.00");

  // Cash movement IN (e.g. additional small cash float)
  const movementIn = addCashMovement(shift.id, "IN", "50.00", "Ingreso para cambio menudo", "CHANGE_FUND");
  assert.equal(movementIn.movementType, "IN");
  assert.equal(movementIn.amountBob, "50.00");

  let state = getSandboxState();
  let updatedShift = state.shifts.find((s) => s.id === shift.id);
  assert.equal(updatedShift?.currentCashBob, "250.00");

  // Cash movement OUT (petty cash expense for cleaning supplies)
  const movementOut = addCashMovement(shift.id, "OUT", "30.00", "Compra de insumos de limpieza", "EXPENSE");
  assert.equal(movementOut.movementType, "OUT");

  state = getSandboxState();
  updatedShift = state.shifts.find((s) => s.id === shift.id);
  assert.equal(updatedShift?.currentCashBob, "220.00");

  // Close shift with counted cash = 215.00 (expected 220.00 => difference -5.00)
  const closed = closeCashShift(shift.id, "215.00");
  assert.equal(closed.status, "CLOSED");
  assert.equal(closed.expectedCashBob, "220.00");
  assert.equal(closed.countedCashBob, "215.00");
  assert.equal(closed.differenceBob, "-5.00");
});

test("sales confirmation: confirms mock sale, generates V-DEMO receipt, decrements batch stock, and updates cash", () => {
  const state = getSandboxState();
  const shift = state.shifts.find((s) => s.status === "OPEN") ?? openCashShift("200.00");
  const paracetamol = state.products.find((p) => p.name.includes("Paracetamol"))!;
  const initialBatch = state.batches.find((b) => b.presentationId === paracetamol.presentationId)!;
  const initialStock = initialBatch.availableQuantity;

  const sale = confirmMockSale({
    cashShiftId: shift.id,
    warehouseId: "WH-DEMO-01",
    lines: [
      {
        presentationId: paracetamol.presentationId,
        quantity: 2,
        unitPriceBob: paracetamol.unitPriceBob,
      },
    ],
    payments: [
      {
        method: "CASH",
        amountBob: "25.00",
      },
    ],
  });

  assert.ok(sale.saleNumber.startsWith("V-DEMO-"));
  assert.equal(sale.totalBob, "25.00");
  assert.equal(sale.items.length, 1);
  assert.equal(sale.items[0]?.quantity, 2);

  // Check batch stock decreased
  const postState = getSandboxState();
  const updatedBatch = postState.batches.find((b) => b.id === initialBatch.id)!;
  assert.equal(updatedBatch.availableQuantity, initialStock - 2);

  // Check shift cash increased by 25.00
  const postShift = postState.shifts.find((s) => s.id === shift.id)!;
  assert.equal(postShift.currentCashBob, "225.00");
});

test("sales confirmation: requires medical prescription for controlled medication", () => {
  const state = getSandboxState();
  const shift = state.shifts.find((s) => s.status === "OPEN") ?? openCashShift("200.00");
  const clonazepam = state.products.find((p) => p.name.includes("Clonazepam"))!;

  // Attempt sale without prescription -> must throw
  assert.throws(() => {
    confirmMockSale({
      cashShiftId: shift.id,
      warehouseId: "WH-DEMO-01",
      lines: [
        {
          presentationId: clonazepam.presentationId,
          quantity: 1,
          unitPriceBob: clonazepam.unitPriceBob,
        },
      ],
      payments: [
        {
          method: "CASH",
          amountBob: clonazepam.unitPriceBob,
        },
      ],
    });
  }, /receta médica obligatoria/i);

  // Providing valid prescription succeeds
  const sale = confirmMockSale({
    cashShiftId: shift.id,
    warehouseId: "WH-DEMO-01",
    lines: [
      {
        presentationId: clonazepam.presentationId,
        quantity: 1,
        unitPriceBob: clonazepam.unitPriceBob,
      },
    ],
    payments: [
      {
        method: "QR",
        amountBob: clonazepam.unitPriceBob,
        reference: "QR-PAY-12345",
      },
    ],
    prescription: {
      doctorName: "Dr. Roberto Méndez",
      doctorLicense: "MED-LPZ-5412",
      patientName: "Ana Clara Silva",
      patientDocument: "4819203 LP",
      issuingCenter: "Clínica Los Andes",
      prescribedAt: "2026-10-20",
    },
  });

  assert.ok(sale.saleNumber.startsWith("V-DEMO-"));
  assert.ok(sale.prescription);
  assert.equal(sale.prescription.doctorName, "Dr. Roberto Méndez");
  assert.ok(sale.prescription.folio.startsWith("RX-DEMO-"));
});

test("inventory operations: quarantine batch and record waste act", () => {
  const state = getSandboxState();
  const batch = state.batches[0]!;
  const initialQty = batch.availableQuantity;

  // Quarantine batch
  const quarantined = quarantineMockBatch(batch.id, "Empaque secundario roto", "DAMAGE");
  assert.equal(quarantined.status, "QUARANTINED");

  const stateAfterQuarantine = getSandboxState();
  assert.equal(stateAfterQuarantine.batches.find((b) => b.id === batch.id)?.status, "QUARANTINED");

  // Record waste act
  const waste = recordMockWaste(batch.id, 5, "Merma por rotura de frasco", "DESTRUCTION");
  assert.ok(waste.actNumber.startsWith("AB-DEMO-"));
  assert.equal(waste.quantityBase, 5);

  const stateAfterWaste = getSandboxState();
  const finalBatch = stateAfterWaste.batches.find((b) => b.id === batch.id)!;
  assert.equal(finalBatch.availableQuantity, initialQty - 5);
});

test("purgeSandbox() wipes all mutations and restores pristine initial baseline", () => {
  // Mutate sandbox
  const shift = openCashShift("500.00", "CAJA-TEST");
  addCashMovement(shift.id, "IN", "100.00", "Inyección");
  const batch = getSandboxState().batches[0]!;
  quarantineMockBatch(batch.id, "Motivo test");

  let modifiedState = getSandboxState();
  assert.ok(modifiedState.shifts.length >= 2);
  assert.equal(modifiedState.batches.find((b) => b.id === batch.id)?.status, "QUARANTINED");

  // Purge
  purgeSandbox();

  const resetState = getSandboxState();
  assert.equal(resetState.shifts.length, 1);
  assert.equal(resetState.shifts[0]?.status, "OPEN");
  assert.equal(resetState.shifts[0]?.initialFundBob, "200.00");
  assert.equal(resetState.batches.find((b) => b.id === batch.id)?.status, "AVAILABLE");
  assert.equal(resetState.sales.length, 0);
  assert.equal(resetState.wasteActs.length, 0);
});

test("handleSandboxRequest intercepts simulated API calls properly", async () => {
  // Test sales lookup query
  const lookupRes = await handleSandboxRequest("/api/sales/lookup?query=Paracetamol&warehouseId=wh-1");
  assert.equal(lookupRes.handled, true);
  assert.equal(lookupRes.status, 200);
  const items = lookupRes.body as Array<{ productName: string }>;
  assert.ok(items.length > 0);
  assert.ok(items[0]!.productName.includes("Paracetamol"));

  // Test cash movements POST
  const moveRes = await handleSandboxRequest("/api/cash/movements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cashShiftId: getSandboxState().shifts[0]!.id,
      movementType: "IN",
      amountBob: "20.00",
      reason: "Cambio inicial",
      category: "CHANGE_FUND",
    }),
  });
  assert.equal(moveRes.handled, true);
  assert.equal(moveRes.status, 201);

  // Unhandled API routes return handled: false
  const unhandled = await handleSandboxRequest("/api/unknown/endpoint");
  assert.equal(unhandled.handled, false);
});
