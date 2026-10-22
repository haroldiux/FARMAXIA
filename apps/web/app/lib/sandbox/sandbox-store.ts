/**
 * FARMAXIA - In-Memory Ephemeral Sandbox Store for Interactive Training Mode
 * Provides realistic mock operational state (shifts, sales, batches, prescriptions, waste acts)
 * with zero persistence to backend PostgreSQL tables.
 */

export interface SandboxProduct {
  id: string;
  name: string;
  genericName: string;
  barcode: string;
  laboratory: string;
  isControlled: boolean;
  presentationId: string;
  presentationName: string;
  unitPriceBob: string;
}

export interface SandboxBatch {
  id: string;
  presentationId: string;
  lotCode: string;
  expiresOn: string;
  availableQuantity: number;
  reservedQuantity: number;
  status: "AVAILABLE" | "QUARANTINED" | "DISPOSED";
  warehouseId: string;
  warehouseName: string;
}

export interface SandboxCashShift {
  id: string;
  status: "OPEN" | "CLOSED";
  cashRegisterCode: string;
  initialFundBob: string;
  currentCashBob: string;
  expectedCashBob?: string;
  countedCashBob?: string;
  differenceBob?: string;
  openedAt: string;
  closedAt?: string;
}

export interface SandboxCashMovement {
  id: string;
  shiftId: string;
  movementType: "IN" | "OUT";
  amountBob: string;
  category: "CHANGE_FUND" | "EXPENSE" | "DEPOSIT" | "OTHER";
  reason: string;
  createdAt: string;
}

export interface SandboxPayment {
  method: "CASH" | "CARD" | "QR" | "POINTS" | "AGREEMENT";
  amountBob: string;
  reference?: string;
  points?: string;
}

export interface SandboxSaleItem {
  presentationId: string;
  productName: string;
  quantity: number;
  quantityBase?: number;
  unitPriceBob: string;
  lineTotalBob?: string;
  batchId?: string;
  lotCode?: string;
  fefoOverride?: boolean;
  fefoOverrideReason?: string | null;
  allocations?: Array<{
    batchId: string;
    lotCode: string;
    expiresOn: string;
    quantityBase: number;
    fefoOverride: boolean;
  }>;
}

export interface SandboxPrescription {
  doctorName: string;
  doctorLicense: string;
  patientName: string;
  patientDocument: string;
  issuingCenter: string;
  prescribedAt: string;
  notes?: string;
  folio: string;
}

export interface SandboxSale {
  id: string;
  saleNumber: string;
  cashShiftId: string;
  warehouseId: string;
  status?: "CONFIRMED";
  totalBob: string;
  paidAmountBob?: string;
  changeAmountBob: string;
  payments: SandboxPayment[];
  items: SandboxSaleItem[];
  createdAt: string;
  prescription?: SandboxPrescription;
  customer?: null;
  loyalty?: null;
  agreement?: null;
}

export interface SandboxWasteAct {
  id: string;
  actNumber: string;
  batchId: string;
  lotCode: string;
  productName: string;
  quantityBase: number;
  reason: string;
  disposalMethod: string;
  createdAt: string;
}

export interface SandboxState {
  products: SandboxProduct[];
  batches: SandboxBatch[];
  shifts: SandboxCashShift[];
  movements: SandboxCashMovement[];
  sales: SandboxSale[];
  prescriptions: SandboxPrescription[];
  wasteActs: SandboxWasteAct[];
}

function createBaselineState(): SandboxState {
  const products: SandboxProduct[] = [
    {
      id: "prod-demo-1",
      name: "Paracetamol 500 mg",
      genericName: "Paracetamol",
      barcode: "777123450001",
      laboratory: "Laboratorios Bagó",
      isControlled: false,
      presentationId: "pres-demo-1",
      presentationName: "Caja x 20 comprimidos",
      unitPriceBob: "12.50",
    },
    {
      id: "prod-demo-2",
      name: "Amoxicilina 500 mg",
      genericName: "Amoxicilina",
      barcode: "777123450002",
      laboratory: "Laboratorios IFA",
      isControlled: false,
      presentationId: "pres-demo-2",
      presentationName: "Frasco suspensión 100 ml",
      unitPriceBob: "28.00",
    },
    {
      id: "prod-demo-3",
      name: "Clonazepam 2 mg",
      genericName: "Clonazepam",
      barcode: "777123450003",
      laboratory: "Laboratorios Vita",
      isControlled: true,
      presentationId: "pres-demo-3",
      presentationName: "Caja x 30 comprimidos",
      unitPriceBob: "45.00",
    },
    {
      id: "prod-demo-4",
      name: "Ibuprofeno 400 mg",
      genericName: "Ibuprofeno",
      barcode: "777123450004",
      laboratory: "Laboratorios Terbol",
      isControlled: false,
      presentationId: "pres-demo-4",
      presentationName: "Caja x 10 cápsulas blandas",
      unitPriceBob: "15.00",
    },
  ];

  const batches: SandboxBatch[] = [
    {
      id: "batch-demo-1",
      presentationId: "pres-demo-1",
      lotCode: "L-PARA-01",
      expiresOn: "2027-04-15",
      availableQuantity: 50,
      reservedQuantity: 0,
      status: "AVAILABLE",
      warehouseId: "WH-DEMO-01",
      warehouseName: "Almacén Central",
    },
    {
      id: "batch-demo-2",
      presentationId: "pres-demo-2",
      lotCode: "L-AMOX-01",
      expiresOn: "2026-11-20",
      availableQuantity: 15,
      reservedQuantity: 0,
      status: "AVAILABLE",
      warehouseId: "WH-DEMO-01",
      warehouseName: "Almacén Central",
    },
    {
      id: "batch-demo-3",
      presentationId: "pres-demo-3",
      lotCode: "L-CLON-01",
      expiresOn: "2027-08-30",
      availableQuantity: 20,
      reservedQuantity: 0,
      status: "AVAILABLE",
      warehouseId: "WH-DEMO-01",
      warehouseName: "Almacén Central",
    },
    {
      id: "batch-demo-4",
      presentationId: "pres-demo-4",
      lotCode: "L-IBU-01",
      expiresOn: "2026-12-10",
      availableQuantity: 30,
      reservedQuantity: 0,
      status: "AVAILABLE",
      warehouseId: "WH-DEMO-01",
      warehouseName: "Almacén Central",
    },
  ];

  const shifts: SandboxCashShift[] = [
    {
      id: "shift-demo-01",
      status: "OPEN",
      cashRegisterCode: "CAJA-DEMO-01",
      initialFundBob: "200.00",
      currentCashBob: "200.00",
      openedAt: new Date().toISOString(),
    },
  ];

  return {
    products,
    batches,
    shifts,
    movements: [],
    sales: [],
    prescriptions: [],
    wasteActs: [],
  };
}

let currentState: SandboxState = createBaselineState();
let saleCounter = 1;
let actCounter = 1;
let rxCounter = 1;
let movementCounter = 1;
let shiftCounter = 2;

/**
 * Returns a cloned snapshot of the current in-memory sandbox state.
 */
export function getSandboxState(): SandboxState {
  return JSON.parse(JSON.stringify(currentState));
}

/**
 * Purges all ephemeral mock records and restores pristine baseline seed data.
 */
export function purgeSandbox(): void {
  currentState = createBaselineState();
  saleCounter = 1;
  actCounter = 1;
  rxCounter = 1;
  movementCounter = 1;
  shiftCounter = 2;
}

/**
 * Opens a simulated cash shift.
 */
export function openCashShift(
  initialFundBob: string,
  cashRegisterCode: string = `CAJA-DEMO-${String(shiftCounter).padStart(2, "0")}`,
): SandboxCashShift {
  const newShift: SandboxCashShift = {
    id: `shift-demo-${String(shiftCounter++).padStart(2, "0")}`,
    status: "OPEN",
    cashRegisterCode,
    initialFundBob,
    currentCashBob: initialFundBob,
    openedAt: new Date().toISOString(),
  };

  currentState.shifts.push(newShift);
  return { ...newShift };
}

/**
 * Records an in/out cash movement for a shift.
 */
export function addCashMovement(
  shiftId: string,
  movementType: "IN" | "OUT",
  amountBob: string,
  reason: string,
  category: "CHANGE_FUND" | "EXPENSE" | "DEPOSIT" | "OTHER" = "OTHER",
): SandboxCashMovement {
  const shift = currentState.shifts.find((s) => s.id === shiftId);
  if (!shift) {
    throw new Error(`Turno ${shiftId} no encontrado en el modo entrenamiento.`);
  }

  const movementAmount = Number(amountBob);
  const currentCash = Number(shift.currentCashBob);

  if (movementType === "IN") {
    shift.currentCashBob = (currentCash + movementAmount).toFixed(2);
  } else {
    shift.currentCashBob = (currentCash - movementAmount).toFixed(2);
  }

  const movement: SandboxCashMovement = {
    id: `mov-demo-${String(movementCounter++).padStart(4, "0")}`,
    shiftId,
    movementType,
    amountBob,
    category,
    reason,
    createdAt: new Date().toISOString(),
  };

  currentState.movements.push(movement);
  return { ...movement };
}

/**
 * Closes a simulated cash shift, calculating discrepancies.
 */
export function closeCashShift(shiftId: string, countedCashBob: string): SandboxCashShift {
  const shift = currentState.shifts.find((s) => s.id === shiftId);
  if (!shift) {
    throw new Error(`Turno ${shiftId} no encontrado en el modo entrenamiento.`);
  }

  const expected = Number(shift.currentCashBob);
  const counted = Number(countedCashBob);
  const diff = counted - expected;

  shift.status = "CLOSED";
  shift.expectedCashBob = expected.toFixed(2);
  shift.countedCashBob = counted.toFixed(2);
  shift.differenceBob = diff.toFixed(2);
  shift.closedAt = new Date().toISOString();

  return { ...shift };
}

export interface ConfirmMockSaleParams {
  cashShiftId: string;
  warehouseId: string;
  lines: Array<{
    presentationId: string;
    quantity: number;
    unitPriceBob?: string;
    batchId?: string;
  }>;
  payments: SandboxPayment[];
  prescription?: Omit<SandboxPrescription, "folio">;
}

/**
 * Confirms a mock sale, reducing stock and updating cash shift balance.
 */
export function confirmMockSale(params: ConfirmMockSaleParams): SandboxSale {
  const shift = currentState.shifts.find((s) => s.id === params.cashShiftId);
  if (!shift || shift.status !== "OPEN") {
    throw new Error("No hay un turno de caja abierto para registrar la venta.");
  }

  const saleItems: SandboxSaleItem[] = [];
  let calculatedTotal = 0;

  for (const line of params.lines) {
    const product = currentState.products.find((p) => p.presentationId === line.presentationId);
    if (!product) {
      throw new Error(`Producto ${line.presentationId} no encontrado.`);
    }

    if (product.isControlled && !params.prescription) {
      throw new Error("Receta médica obligatoria para medicamentos controlados.");
    }

    // Find batch
    let batch: SandboxBatch | undefined;
    if (line.batchId) {
      batch = currentState.batches.find((b) => b.id === line.batchId);
    } else {
      // FEFO: earliest expiry with enough stock
      batch = currentState.batches
        .filter((b) => b.presentationId === line.presentationId && b.status === "AVAILABLE" && b.availableQuantity >= line.quantity)
        .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))[0];
    }

    if (!batch || batch.availableQuantity < line.quantity) {
      throw new Error(`Stock insuficiente para ${product.name}.`);
    }

    // Decrement stock
    batch.availableQuantity -= line.quantity;

    const unitPrice = line.unitPriceBob ?? product.unitPriceBob;
    calculatedTotal += line.quantity * Number(unitPrice);

    saleItems.push({
      presentationId: line.presentationId,
      productName: product.name,
      quantity: line.quantity,
      quantityBase: line.quantity,
      unitPriceBob: unitPrice,
      lineTotalBob: (line.quantity * Number(unitPrice)).toFixed(2),
      batchId: batch.id,
      lotCode: batch.lotCode,
      fefoOverride: false,
      fefoOverrideReason: null,
      allocations: [
        {
          batchId: batch.id,
          lotCode: batch.lotCode,
          expiresOn: batch.expiresOn,
          quantityBase: line.quantity,
          fefoOverride: false,
        },
      ],
    });
  }

  const totalPaid = params.payments.reduce((acc, p) => acc + Number(p.amountBob || 0), 0);
  const changeAmount = Math.max(0, totalPaid - calculatedTotal);

  // Update cash if cash tender used
  const cashPaid = params.payments
    .filter((p) => p.method === "CASH")
    .reduce((acc, p) => acc + Number(p.amountBob || 0), 0);

  if (cashPaid > 0) {
    const netCashInflow = cashPaid - changeAmount;
    shift.currentCashBob = (Number(shift.currentCashBob) + netCashInflow).toFixed(2);
  }

  let finalPrescription: SandboxPrescription | undefined;
  if (params.prescription) {
    finalPrescription = {
      ...params.prescription,
      folio: `RX-DEMO-${String(rxCounter++).padStart(4, "0")}`,
    };
    currentState.prescriptions.push(finalPrescription);
  }

  const sale: SandboxSale = {
    id: `sale-demo-${String(saleCounter).padStart(4, "0")}`,
    saleNumber: `V-DEMO-${String(saleCounter++).padStart(4, "0")}`,
    cashShiftId: params.cashShiftId,
    warehouseId: params.warehouseId,
    status: "CONFIRMED",
    totalBob: calculatedTotal.toFixed(2),
    paidAmountBob: totalPaid.toFixed(2),
    payments: params.payments,
    items: saleItems,
    changeAmountBob: changeAmount.toFixed(2),
    createdAt: new Date().toISOString(),
    prescription: finalPrescription,
    customer: null,
    loyalty: null,
    agreement: null,
  };

  currentState.sales.push(sale);
  return { ...sale };
}

/**
 * Quarantines an inventory batch.
 */
export function quarantineMockBatch(
  batchId: string,
  reason: string,
  reasonCode: string = "QUALITY",
  temperatureCelsius?: number,
): SandboxBatch {
  const batch = currentState.batches.find((b) => b.id === batchId);
  if (!batch) {
    throw new Error(`Lote ${batchId} no encontrado en inventario.`);
  }

  batch.status = "QUARANTINED";
  return { ...batch };
}

/**
 * Releases an inventory batch from quarantine back to available.
 */
export function releaseMockBatch(batchId: string, reason: string): SandboxBatch {
  const batch = currentState.batches.find((b) => b.id === batchId);
  if (!batch) {
    throw new Error(`Lote ${batchId} no encontrado en inventario.`);
  }

  batch.status = "AVAILABLE";
  return { ...batch };
}

/**
 * Records a waste act for expired or damaged items.
 */
export function recordMockWaste(
  batchId: string,
  quantityBase: number,
  reason: string,
  disposalMethod: string = "DESTRUCTION",
): SandboxWasteAct {
  const batch = currentState.batches.find((b) => b.id === batchId);
  if (!batch) {
    throw new Error(`Lote ${batchId} no encontrado en inventario.`);
  }

  const product = currentState.products.find((p) => p.presentationId === batch.presentationId);
  batch.availableQuantity = Math.max(0, batch.availableQuantity - quantityBase);
  if (batch.availableQuantity === 0) {
    batch.status = "DISPOSED";
  }

  const act: SandboxWasteAct = {
    id: `act-demo-${String(actCounter).padStart(4, "0")}`,
    actNumber: `AB-DEMO-${String(actCounter++).padStart(4, "0")}`,
    batchId,
    lotCode: batch.lotCode,
    productName: product?.name ?? "Producto Demo",
    quantityBase,
    reason,
    disposalMethod,
    createdAt: new Date().toISOString(),
  };

  currentState.wasteActs.push(act);
  return { ...act };
}
