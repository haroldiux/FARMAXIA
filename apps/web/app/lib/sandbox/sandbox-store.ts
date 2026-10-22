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
  /** SCHEDULED shifts have no cash control yet; PENDING_APPROVAL ones were counted with a difference. */
  status: "SCHEDULED" | "OPEN" | "PENDING_APPROVAL" | "CLOSED";
  cashRegisterCode: string;
  initialFundBob: string;
  currentCashBob: string;
  expectedCashBob?: string;
  countedCashBob?: string;
  differenceBob?: string;
  openedAt: string;
  countedAt?: string;
  closedAt?: string;
  approvalNote?: string;
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

/** Prescription data the cashier enters in the POS dialog. */
export interface SandboxPrescriptionInput {
  doctorName: string;
  doctorLicense: string;
  patientName: string;
  patientDocument: string;
  issuingCenter: string;
  prescribedAt: string;
  notes?: string;
}

export interface SandboxPrescriptionItem {
  productName: string;
  presentationName: string;
  quantity: number;
  quantityBase: number;
  isControlled: boolean;
  lots: Array<{ lotCode: string; quantityBase: number }>;
}

/** Archived prescription: the input plus the folio and the sale it belongs to. */
export interface SandboxPrescription extends SandboxPrescriptionInput {
  id: string;
  folio: string;
  saleId: string;
  saleNumber: string;
  createdAt: string;
  items: SandboxPrescriptionItem[];
}

export interface SandboxCustomer {
  id: string;
  fullName: string;
  docType: "CI" | "NIT" | "PASSPORT" | "OTHER" | null;
  docNumber: string | null;
  complement: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  isActive: boolean;
  loyaltyBalance: number;
  createdAt: string;
  updatedAt: string;
}

export interface SandboxLoyaltyMovement {
  id: string;
  customerId: string;
  kind: "EARN" | "REDEEM";
  points: number;
  reason: string;
  saleId: string | null;
  saleNumber: string | null;
  createdByName: string | null;
  createdAt: string;
}

/** Loyalty program rules of the demo pharmacy. */
export const SANDBOX_LOYALTY_SETTINGS = {
  enabled: true,
  bobPerPoint: "10.00",
  pointValueBob: "0.10",
} as const;

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
  customer?: { id: string; fullName: string; docType: string | null; docNumber: string | null } | null;
  loyalty?: { earned: number; redeemed: number; balance: number } | null;
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

export interface SandboxSupplier {
  id: string;
  name: string;
  taxId: string | null;
  isActive: boolean;
}

export interface SandboxPurchaseOrderLine {
  presentationId: string;
  presentationName: string;
  productName: string;
  quantityBase: number;
  receivedBase: number;
  unitCost: string;
}

export interface SandboxPurchaseOrder {
  id: string;
  supplierId: string;
  supplierName: string;
  warehouseId: string;
  warehouseName: string;
  status: "SUBMITTED" | "PARTIALLY_RECEIVED" | "RECEIVED";
  orderedAt: string;
  closeReason: string | null;
  closedAt: string | null;
  lines: SandboxPurchaseOrderLine[];
}

export interface SandboxGoodsReceipt {
  id: string;
  supplierId: string;
  supplierName: string;
  purchaseOrderId: string;
  receivedAt: string;
  lineCount: number;
}

export interface SandboxWarehouse {
  id: string;
  name: string;
  branchId: string;
  branchName: string | null;
  warehouseType: "GENERAL" | "CENTRAL" | "QUARANTINE" | "COLD";
}

export interface SandboxTransferItem {
  id: string;
  presentationId: string;
  batchId: string;
  requestedQty: number;
  dispatchedQty: number | null;
  receivedQty: number;
  differenceReason: string | null;
}

export interface SandboxTransfer {
  id: string;
  originWarehouseId: string;
  destinationWarehouseId: string;
  status: "REQUESTED";
  requestedByUserId: string;
  dispatchedByUserId: string | null;
  dispatchedAt: string | null;
  completedAt: string | null;
  approvedAt: string | null;
  approvedByUserId: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  items: SandboxTransferItem[];
}

export interface SandboxStaffShift {
  id: string;
  userId: string;
  userName: string;
  kind: "REGULAR" | "NIGHT_DUTY";
  startsAt: string;
  endsAt: string;
  notes: string | null;
  status: "SCHEDULED" | "CANCELED";
  cancelReason: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  createdByUserId: string;
  createdAt: string;
}

export interface SandboxRole {
  id: string;
  code: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: string[];
}

export interface SandboxPermission {
  code: string;
  label: string;
  module: string;
}

export interface SandboxBranch {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface SandboxUser {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  twoFactorEnabled: boolean;
  managedHere: boolean;
  roleIds: string[];
  branchIds: string[];
}

export interface SandboxState {
  products: SandboxProduct[];
  batches: SandboxBatch[];
  shifts: SandboxCashShift[];
  movements: SandboxCashMovement[];
  sales: SandboxSale[];
  prescriptions: SandboxPrescription[];
  wasteActs: SandboxWasteAct[];
  suppliers: SandboxSupplier[];
  purchaseOrders: SandboxPurchaseOrder[];
  goodsReceipts: SandboxGoodsReceipt[];
  warehouses: SandboxWarehouse[];
  transfers: SandboxTransfer[];
  staffShifts: SandboxStaffShift[];
  roles: SandboxRole[];
  permissions: SandboxPermission[];
  branches: SandboxBranch[];
  users: SandboxUser[];
  customers: SandboxCustomer[];
  loyaltyMovements: SandboxLoyaltyMovement[];
}

/** Offset of La Paz (UTC-4, no daylight saving). */
const LA_PAZ_OFFSET_MS = 4 * 3600 * 1000;

function createBaselineProcurement(products: SandboxProduct[]) {
  const nowIso = new Date().toISOString();
  const suppliers: SandboxSupplier[] = [
    { id: "sup-demo-01", name: "Laboratorios Bagó", taxId: "1020304050", isActive: true },
  ];
  const lineFor = (presentationId: string, quantityBase: number, unitCost: string): SandboxPurchaseOrderLine => {
    const product = products.find((p) => p.presentationId === presentationId)!;
    return {
      presentationId,
      presentationName: product.presentationName,
      productName: product.name,
      quantityBase,
      receivedBase: 0,
      unitCost,
    };
  };
  const purchaseOrders: SandboxPurchaseOrder[] = [
    {
      id: "po-demo-0001",
      supplierId: "sup-demo-01",
      supplierName: "Laboratorios Bagó",
      warehouseId: "WH-DEMO-01",
      warehouseName: "Almacén Central",
      status: "SUBMITTED",
      orderedAt: nowIso,
      closeReason: null,
      closedAt: null,
      lines: [lineFor("pres-demo-1", 100, "8.5000"), lineFor("pres-demo-4", 60, "10.2000")],
    },
  ];
  const warehouses: SandboxWarehouse[] = [
    { id: "WH-DEMO-01", name: "Almacén Central", branchId: "BR-DEMO-01", branchName: "Sucursal Central", warehouseType: "CENTRAL" },
    { id: "WH-DEMO-02", name: "Almacén Sucursal Norte", branchId: "BR-DEMO-02", branchName: "Sucursal Norte", warehouseType: "GENERAL" },
  ];
  return { suppliers, purchaseOrders, warehouses };
}

let sandboxUserId = "user-demo";

/** Id of the signed-in user, so simulated cash shifts and staff are assigned to the person training. */
export function getSandboxUserId(): string {
  return sandboxUserId;
}

export function setSandboxUserId(userId: string): void {
  if (!userId || userId === sandboxUserId) return;
  const previous = sandboxUserId;
  sandboxUserId = userId;
  for (const user of currentState.users) if (user.id === previous) user.id = userId;
  for (const shift of currentState.staffShifts) {
    if (shift.createdByUserId === previous) shift.createdByUserId = userId;
    if (shift.userId === previous) shift.userId = userId;
  }
}

function createBaselineCustomers() {
  const now = new Date().toISOString();
  const customers: SandboxCustomer[] = [
    { id: "cust-demo-1", fullName: "María Fernández", docType: "CI", docNumber: "6543210", complement: null, phone: "70011122", email: null, notes: null, isActive: true, loyaltyBalance: 85, createdAt: now, updatedAt: now },
    { id: "cust-demo-2", fullName: "Carlos Quispe", docType: "CI", docNumber: "7654321", complement: null, phone: "70033344", email: null, notes: null, isActive: true, loyaltyBalance: 30, createdAt: now, updatedAt: now },
  ];
  return { customers, loyaltyMovements: [] as SandboxLoyaltyMovement[] };
}

function createBaselineDirectory() {
  const createdAt = new Date().toISOString();
  const roles: SandboxRole[] = [
    { id: "role-demo-owner", code: "owner", name: "Propietario", description: "Acceso total a la farmacia.", isSystem: true, permissions: ["users.manage", "sales.create", "inventory.manage"] },
    { id: "role-demo-cajero", code: "cajero", name: "Cajero", description: "Ventas y caja.", isSystem: true, permissions: ["sales.create", "cash.manage"] },
    { id: "role-demo-almacenero", code: "almacenero", name: "Almacenero", description: "Inventario y recepción.", isSystem: true, permissions: ["inventory.manage"] },
    { id: "role-demo-regente", code: "regente", name: "Regente Farmacéutico", description: "Control de medicamentos controlados.", isSystem: true, permissions: ["controlled.view"] },
  ];
  const permissions: SandboxPermission[] = [
    { code: "users.manage", label: "Administrar usuarios", module: "Usuarios" },
    { code: "sales.create", label: "Registrar ventas", module: "Ventas" },
    { code: "cash.manage", label: "Administrar caja", module: "Caja" },
    { code: "inventory.manage", label: "Administrar inventario", module: "Inventario" },
    { code: "controlled.view", label: "Ver controlados", module: "Controlados" },
  ];
  const branches: SandboxBranch[] = [
    { id: "BR-DEMO-01", code: "CENTRAL", name: "Sucursal Central", isActive: true },
    { id: "BR-DEMO-02", code: "NORTE", name: "Sucursal Norte", isActive: true },
  ];
  const users: SandboxUser[] = [
    { id: sandboxUserId, email: "propietario@demo.test", displayName: "Usuario Demo", isActive: true, createdAt, lastLoginAt: createdAt, twoFactorEnabled: false, managedHere: true, roleIds: ["role-demo-owner"], branchIds: ["BR-DEMO-01"] },
    { id: "user-demo-2", email: "maria.cajera@demo.test", displayName: "María Cajera", isActive: true, createdAt, lastLoginAt: null, twoFactorEnabled: false, managedHere: true, roleIds: ["role-demo-cajero"], branchIds: ["BR-DEMO-01"] },
  ];
  const day = new Date(Date.now() - LA_PAZ_OFFSET_MS).toISOString().slice(0, 10);
  const staffShifts: SandboxStaffShift[] = [
    {
      id: "shift-staff-demo-01",
      userId: "user-demo-2",
      userName: "María Cajera",
      kind: "REGULAR",
      startsAt: new Date(`${day}T08:00:00-04:00`).toISOString(),
      endsAt: new Date(`${day}T16:00:00-04:00`).toISOString(),
      notes: "Turno de mañana",
      status: "SCHEDULED",
      cancelReason: null,
      checkedInAt: null,
      checkedOutAt: null,
      createdByUserId: sandboxUserId,
      createdAt,
    },
  ];
  return { roles, permissions, branches, users, staffShifts };
}

/** Calendar date (YYYY-MM-DD) `days` from today, so seeded expiry dates stay meaningful over time. */
function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Cash shift every role starts with. Most roles get an OPEN shift so they can sell right away;
 * the cajero starts from a scheduled shift (to practice opening it) and the encargado from a
 * counted shift awaiting approval (to practice the supervisor step on its own).
 */
function createBaselineShifts(roleCode?: string): SandboxCashShift[] {
  const openedAt = new Date().toISOString();
  const base = { id: "shift-demo-01", cashRegisterCode: "CAJA-DEMO-01", openedAt };
  if (roleCode === "cajero") {
    return [{ ...base, status: "SCHEDULED", initialFundBob: "0.00", currentCashBob: "0.00" }];
  }
  if (roleCode === "encargado") {
    return [
      {
        ...base,
        status: "PENDING_APPROVAL",
        initialFundBob: "200.00",
        currentCashBob: "200.00",
        expectedCashBob: "200.00",
        countedCashBob: "185.00",
        differenceBob: "-15.00",
        countedAt: openedAt,
      },
    ];
  }
  return [{ ...base, status: "OPEN", initialFundBob: "200.00", currentCashBob: "200.00" }];
}

function createBaselineState(roleCode?: string): SandboxState {
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
      expiresOn: daysFromNow(300),
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
      expiresOn: daysFromNow(25),
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
      expiresOn: daysFromNow(400),
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
      expiresOn: daysFromNow(60),
      availableQuantity: 30,
      reservedQuantity: 0,
      status: "AVAILABLE",
      warehouseId: "WH-DEMO-01",
      warehouseName: "Almacén Central",
    },
  ];

  const shifts = createBaselineShifts(roleCode);

  return {
    products,
    batches,
    shifts,
    movements: [],
    sales: [],
    prescriptions: [],
    wasteActs: [],
    goodsReceipts: [],
    transfers: [],
    ...createBaselineProcurement(products),
    ...createBaselineDirectory(),
    ...createBaselineCustomers(),
  };
}

let currentState: SandboxState = createBaselineState();
let saleCounter = 1;
let actCounter = 1;
let rxCounter = 1;
let movementCounter = 1;
let shiftCounter = 2;
let receiptCounter = 1;
let transferCounter = 1;
let staffShiftCounter = 2;
let userCounter = 3;
let loyaltyCounter = 1;

/**
 * Returns a cloned snapshot of the current in-memory sandbox state.
 */
export function getSandboxState(): SandboxState {
  return JSON.parse(JSON.stringify(currentState));
}

/**
 * Purges all ephemeral mock records and restores pristine baseline seed data.
 */
export function purgeSandbox(roleCode?: string): void {
  currentState = createBaselineState(roleCode);
  saleCounter = 1;
  actCounter = 1;
  rxCounter = 1;
  movementCounter = 1;
  shiftCounter = 2;
  receiptCounter = 1;
  transferCounter = 1;
  staffShiftCounter = 2;
  userCounter = 3;
  loyaltyCounter = 1;
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
export function openScheduledShift(shiftId: string, initialFundBob: string): SandboxCashShift {
  const shift = currentState.shifts.find((s) => s.id === shiftId);
  if (!shift || shift.status !== "SCHEDULED") {
    throw new Error("El turno no está programado para abrirse.");
  }
  shift.status = "OPEN";
  shift.initialFundBob = initialFundBob;
  shift.currentCashBob = initialFundBob;
  shift.openedAt = new Date().toISOString();
  return { ...shift };
}

/**
 * Counts the physical cash of an open shift: an exact match closes it, any difference
 * leaves it pending supervisor approval (like the real cash module).
 */
export function countMockShift(shiftId: string, countedCashBob: string): SandboxCashShift {
  const shift = currentState.shifts.find((s) => s.id === shiftId);
  if (!shift) {
    throw new Error(`Turno ${shiftId} no encontrado en el modo entrenamiento.`);
  }
  if (shift.status !== "OPEN") {
    throw new Error("Solo un turno abierto puede contarse.");
  }
  const expected = Number(shift.currentCashBob);
  const counted = Number(countedCashBob);
  const diff = counted - expected;
  shift.expectedCashBob = expected.toFixed(2);
  shift.countedCashBob = counted.toFixed(2);
  shift.differenceBob = diff.toFixed(2);
  shift.countedAt = new Date().toISOString();
  if (diff === 0) {
    shift.status = "CLOSED";
    shift.closedAt = shift.countedAt;
  } else {
    shift.status = "PENDING_APPROVAL";
  }
  return { ...shift };
}

/** Supervisor approval of a counted shift with a difference: closes it. */
export function approveMockShift(shiftId: string, approvalNote: string = "Diferencia revisada por supervisor"): SandboxCashShift {
  const shift = currentState.shifts.find((s) => s.id === shiftId);
  if (!shift) {
    throw new Error(`Turno ${shiftId} no encontrado en el modo entrenamiento.`);
  }
  if (shift.status !== "PENDING_APPROVAL") {
    throw new Error("El turno no está pendiente de aprobación.");
  }
  shift.status = "CLOSED";
  shift.approvalNote = approvalNote;
  shift.closedAt = new Date().toISOString();
  return { ...shift };
}

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
  customerId?: string;
  prescription?: SandboxPrescriptionInput;
}

/**
 * Confirms a mock sale, reducing stock and updating cash shift balance.
 */
export function confirmMockSale(params: ConfirmMockSaleParams): SandboxSale {
  const shift = currentState.shifts.find((s) => s.id === params.cashShiftId);
  if (!shift || shift.status !== "OPEN") {
    throw new Error("No hay un turno de caja abierto para registrar la venta.");
  }

  const customer = params.customerId
    ? currentState.customers.find((c) => c.id === params.customerId && c.isActive)
    : undefined;
  if (params.customerId && !customer) {
    throw new Error("Cliente no encontrado en el modo entrenamiento.");
  }
  if (params.payments.some((p) => p.method === "AGREEMENT")) {
    throw new Error("Los convenios no se simulan en el modo entrenamiento.");
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

  // Points tender: BOB amount converted at the program's point value; needs a customer with balance.
  const pointValue = Number(SANDBOX_LOYALTY_SETTINGS.pointValueBob);
  const pointsBob = params.payments
    .filter((p) => p.method === "POINTS")
    .reduce((acc, p) => acc + Number(p.amountBob || 0), 0);
  const redeemedPoints = pointsBob > 0 ? Math.round(pointsBob / pointValue) : 0;
  if (redeemedPoints > 0 && (!customer || customer.loyaltyBalance < redeemedPoints)) {
    throw new Error("El cliente no tiene puntos suficientes para ese canje.");
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

  const saleNumberSeq = String(saleCounter).padStart(4, "0");
  const saleId = `sale-demo-${saleNumberSeq}`;
  const saleNumber = `V-DEMO-${saleNumberSeq}`;
  const createdAt = new Date().toISOString();

  let finalPrescription: SandboxPrescription | undefined;
  if (params.prescription) {
    const rxSeq = String(rxCounter++).padStart(4, "0");
    finalPrescription = {
      ...params.prescription,
      id: `rx-demo-${rxSeq}`,
      folio: `RX-DEMO-${rxSeq}`,
      saleId,
      saleNumber,
      createdAt,
      items: saleItems.map((item) => {
        const product = currentState.products.find((p) => p.presentationId === item.presentationId);
        return {
          productName: item.productName,
          presentationName: product?.presentationName ?? "",
          quantity: item.quantity,
          quantityBase: item.quantityBase ?? item.quantity,
          isControlled: product?.isControlled ?? false,
          lots: (item.allocations ?? []).map((a) => ({ lotCode: a.lotCode, quantityBase: a.quantityBase })),
        };
      }),
    };
    currentState.prescriptions.push(finalPrescription);
  }

  let loyalty: SandboxSale["loyalty"] = null;
  if (customer) {
    const earned = Math.max(
      0,
      Math.floor((calculatedTotal - pointsBob) / Number(SANDBOX_LOYALTY_SETTINGS.bobPerPoint)),
    );
    customer.loyaltyBalance += earned - redeemedPoints;
    customer.updatedAt = createdAt;
    const movement = (kind: "EARN" | "REDEEM", points: number, reason: string): SandboxLoyaltyMovement => ({
      id: `loy-demo-${String(loyaltyCounter++).padStart(4, "0")}`,
      customerId: customer.id,
      kind,
      points,
      reason,
      saleId,
      saleNumber,
      createdByName: "Usuario Demo",
      createdAt,
    });
    if (earned > 0) currentState.loyaltyMovements.push(movement("EARN", earned, "Puntos por compra"));
    if (redeemedPoints > 0) currentState.loyaltyMovements.push(movement("REDEEM", -redeemedPoints, "Canje en venta"));
    loyalty = { earned, redeemed: redeemedPoints, balance: customer.loyaltyBalance };
  }

  const sale: SandboxSale = {
    id: saleId,
    saleNumber,
    cashShiftId: params.cashShiftId,
    warehouseId: params.warehouseId,
    status: "CONFIRMED",
    totalBob: calculatedTotal.toFixed(2),
    paidAmountBob: totalPaid.toFixed(2),
    payments: params.payments,
    items: saleItems,
    changeAmountBob: changeAmount.toFixed(2),
    createdAt,
    prescription: finalPrescription,
    customer: customer
      ? { id: customer.id, fullName: customer.fullName, docType: customer.docType, docNumber: customer.docNumber }
      : null,
    loyalty,
    agreement: null,
  };
  saleCounter++;

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

export interface ReceiveMockPurchaseOrderParams {
  purchaseOrderId: string;
  warehouseId?: string;
  receivedAt?: string;
  lines: Array<{
    presentationId: string;
    lotCode: string;
    expiresOn: string;
    quantityBase: number;
    unitCost?: string;
  }>;
}

/**
 * Receives physical stock against a purchase order: creates one inventory lot per line,
 * a goods receipt and updates the order status. Validates everything before mutating.
 */
export function receiveMockPurchaseOrder(params: ReceiveMockPurchaseOrderParams): {
  receiptId: string;
  lineCount: number;
} {
  const order = currentState.purchaseOrders.find((o) => o.id === params.purchaseOrderId);
  if (!order) {
    throw new Error("Orden de compra no encontrada en el modo entrenamiento.");
  }
  if (order.status === "RECEIVED") {
    throw new Error("La orden de compra ya fue recibida por completo.");
  }
  if (!params.lines?.length) {
    throw new Error("Registra al menos un lote recibido.");
  }

  const pending = new Map(order.lines.map((l) => [l.presentationId, l.quantityBase - l.receivedBase]));
  for (const line of params.lines) {
    const remaining = pending.get(line.presentationId);
    if (remaining === undefined) {
      throw new Error("La presentación no pertenece a la orden de compra.");
    }
    if (!line.lotCode?.trim() || !line.expiresOn || !Number.isSafeInteger(line.quantityBase) || line.quantityBase <= 0) {
      throw new Error("Cada lote necesita código, vencimiento y cantidad entera positiva.");
    }
    if (line.quantityBase > remaining) {
      throw new Error("No puedes recibir más de lo ordenado.");
    }
    pending.set(line.presentationId, remaining - line.quantityBase);
  }

  const warehouseId = params.warehouseId || order.warehouseId;
  const warehouseName = currentState.warehouses.find((w) => w.id === warehouseId)?.name ?? order.warehouseName;
  let batchSeq = currentState.batches.length + 1;
  for (const line of params.lines) {
    currentState.batches.push({
      id: `batch-demo-${batchSeq++}`,
      presentationId: line.presentationId,
      lotCode: line.lotCode.trim(),
      expiresOn: line.expiresOn,
      availableQuantity: line.quantityBase,
      reservedQuantity: 0,
      status: "AVAILABLE",
      warehouseId,
      warehouseName,
    });
    const orderLine = order.lines.find((l) => l.presentationId === line.presentationId)!;
    orderLine.receivedBase += line.quantityBase;
  }
  order.status = order.lines.every((l) => l.receivedBase >= l.quantityBase) ? "RECEIVED" : "PARTIALLY_RECEIVED";

  const receipt: SandboxGoodsReceipt = {
    id: `receipt-demo-${String(receiptCounter++).padStart(4, "0")}`,
    supplierId: order.supplierId,
    supplierName: order.supplierName,
    purchaseOrderId: order.id,
    receivedAt: params.receivedAt ?? new Date().toISOString(),
    lineCount: params.lines.length,
  };
  currentState.goodsReceipts.push(receipt);
  return { receiptId: receipt.id, lineCount: receipt.lineCount };
}

export interface RequestMockTransferParams {
  originWarehouseId: string;
  destinationWarehouseId: string;
  items: Array<{ presentationId: string; batchId: string; requestedQty: number }>;
}

/**
 * Registers an inter-branch transfer request. A request does not move stock.
 */
export function requestMockTransfer(params: RequestMockTransferParams): SandboxTransfer {
  const known = (id: string) => currentState.warehouses.some((w) => w.id === id);
  if (!known(params.originWarehouseId) || !known(params.destinationWarehouseId)) {
    throw new Error("Almacén de origen o destino no encontrado.");
  }
  if (params.originWarehouseId === params.destinationWarehouseId) {
    throw new Error("El origen y el destino deben ser almacenes distintos.");
  }
  if (!params.items?.length) {
    throw new Error("Agrega al menos un producto al traspaso.");
  }
  for (const item of params.items) {
    const batch = currentState.batches.find((b) => b.id === item.batchId && b.warehouseId === params.originWarehouseId);
    if (!batch || batch.presentationId !== item.presentationId) {
      throw new Error("El lote no existe en el almacén de origen.");
    }
    if (!Number.isSafeInteger(item.requestedQty) || item.requestedQty <= 0 || item.requestedQty > batch.availableQuantity) {
      throw new Error("La cantidad solicitada supera el stock disponible del lote.");
    }
  }

  const now = new Date().toISOString();
  const id = `transfer-demo-${String(transferCounter++).padStart(4, "0")}`;
  const transfer: SandboxTransfer = {
    id,
    originWarehouseId: params.originWarehouseId,
    destinationWarehouseId: params.destinationWarehouseId,
    status: "REQUESTED",
    requestedByUserId: "user-demo",
    dispatchedByUserId: null,
    dispatchedAt: null,
    completedAt: null,
    approvedAt: null,
    approvedByUserId: null,
    rejectedAt: null,
    rejectionReason: null,
    createdAt: now,
    updatedAt: now,
    items: params.items.map((item, index) => ({
      id: `${id}-item-${index + 1}`,
      presentationId: item.presentationId,
      batchId: item.batchId,
      requestedQty: item.requestedQty,
      dispatchedQty: null,
      receivedQty: 0,
      differenceReason: null,
    })),
  };
  currentState.transfers.push(transfer);
  return JSON.parse(JSON.stringify(transfer));
}

export interface CreateMockStaffShiftParams {
  userId: string;
  kind?: "REGULAR" | "NIGHT_DUTY";
  startsAt: string;
  endsAt: string;
  notes?: string | null;
}

/**
 * Schedules a staff shift for a branch member.
 */
export function createMockStaffShift(params: CreateMockStaffShiftParams): SandboxStaffShift {
  const user = currentState.users.find((u) => u.id === params.userId && u.isActive);
  if (!user) {
    throw new Error("El colaborador no pertenece a la sucursal.");
  }
  const start = Date.parse(params.startsAt);
  const end = Date.parse(params.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error("La hora de fin debe ser posterior a la de inicio.");
  }
  const shift: SandboxStaffShift = {
    id: `shift-staff-demo-${String(staffShiftCounter++).padStart(2, "0")}`,
    userId: user.id,
    userName: user.displayName,
    kind: params.kind === "NIGHT_DUTY" ? "NIGHT_DUTY" : "REGULAR",
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(end).toISOString(),
    notes: params.notes ?? null,
    status: "SCHEDULED",
    cancelReason: null,
    checkedInAt: null,
    checkedOutAt: null,
    createdByUserId: "user-demo",
    createdAt: new Date().toISOString(),
  };
  currentState.staffShifts.push(shift);
  return { ...shift };
}

export interface CreateMockUserParams {
  displayName: string;
  email: string;
  password: string;
  roleIds?: string[];
  branchIds?: string[];
}

/**
 * Creates a simulated team member. The password is validated but never stored.
 */
export function createMockUser(params: CreateMockUserParams): SandboxUser {
  const displayName = params.displayName?.trim();
  const email = params.email?.trim().toLowerCase();
  if (!displayName || !email || !params.password) {
    throw new Error("Nombre, correo y contraseña son obligatorios.");
  }
  if (currentState.users.some((u) => u.email.toLowerCase() === email)) {
    throw new Error("Ya existe un usuario con ese correo.");
  }
  const user: SandboxUser = {
    id: `user-demo-${userCounter++}`,
    email,
    displayName,
    isActive: true,
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
    twoFactorEnabled: false,
    managedHere: true,
    roleIds: (params.roleIds ?? []).filter((id) => currentState.roles.some((r) => r.id === id)),
    branchIds: (params.branchIds ?? []).filter((id) => currentState.branches.some((b) => b.id === id)),
  };
  currentState.users.push(user);
  return { ...user };
}
