/**
 * FARMAXIA - Simulated record routes: customers and loyalty, sale detail (receipt),
 * controlled medicines (prescriptions, book, balance) and waste acts.
 * Everything is derived from the in-memory sandbox store so the learner sees what they just did.
 */

import {
  SANDBOX_LOYALTY_SETTINGS,
  getSandboxState,
  type SandboxState,
  type SandboxWasteAct,
} from "./sandbox-store.ts";
import { ok, type SandboxInterceptResult } from "./sandbox-http.ts";

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function notFound(message: string): SandboxInterceptResult {
  return ok({ message }, 404);
}

function paged<T>(items: T[], searchParams: URLSearchParams) {
  const limit = Number(searchParams.get("limit") || items.length || 20);
  const offset = Number(searchParams.get("offset") || 0);
  return { items: items.slice(offset, offset + limit), total: items.length, limit, offset };
}

// ---- Customers and loyalty ----

function handleCustomers(route: string, method: string, searchParams: URLSearchParams): SandboxInterceptResult | null {
  if (method !== "GET") return null;
  const state = getSandboxState();

  if (route === "/loyalty/settings") {
    return ok({ ...SANDBOX_LOYALTY_SETTINGS });
  }
  if (route === "/customers") {
    const q = normalize(searchParams.get("q") ?? "");
    const active = searchParams.get("active");
    const matches = state.customers.filter(
      (c) =>
        (active === null || String(c.isActive) === active) &&
        (!q || normalize(c.fullName).includes(q) || (c.docNumber ?? "").includes(q) || (c.phone ?? "").includes(q)),
    );
    return ok(paged(matches, searchParams));
  }

  const loyalty = /^\/customers\/([^/]+)\/loyalty$/.exec(route);
  if (loyalty) {
    const customer = state.customers.find((c) => c.id === decodeURIComponent(loyalty[1]!));
    if (!customer) return notFound("Cliente no encontrado.");
    const movements = state.loyaltyMovements
      .filter((m) => m.customerId === customer.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    return ok({
      customerId: customer.id,
      balance: customer.loyaltyBalance,
      settings: { ...SANDBOX_LOYALTY_SETTINGS },
      movements: paged(movements, searchParams),
    });
  }
  if (/^\/customers\/[^/]+\/agreements$/.test(route)) {
    return ok({ items: [] });
  }
  const detail = /^\/customers\/([^/]+)$/.exec(route);
  if (detail) {
    const customer = state.customers.find((c) => c.id === decodeURIComponent(detail[1]!));
    return customer ? ok(customer) : notFound("Cliente no encontrado.");
  }
  return null;
}

// ---- Sale detail (receipt) ----

function handleSaleDetail(route: string, method: string): SandboxInterceptResult | null {
  const match = /^\/sales\/([^/]+)$/.exec(route);
  if (!match || method !== "GET") return null;
  const id = decodeURIComponent(match[1]!);
  // Other /sales/<segment> routes (summary, quotes, ...) are not simulated and keep reading real data.
  if (!id.startsWith("sale-demo-")) return null;
  const state = getSandboxState();
  const sale = state.sales.find((s) => s.id === id);
  if (!sale) return notFound("Venta no encontrada.");

  const shift = state.shifts.find((s) => s.id === sale.cashShiftId);
  const warehouse = state.warehouses.find((w) => w.id === sale.warehouseId);
  const cashier = state.users[0];
  return ok({
    id: sale.id,
    number: sale.saleNumber,
    status: "CONFIRMED",
    createdAt: sale.createdAt,
    totalBob: sale.totalBob,
    paidAmountBob: sale.paidAmountBob ?? sale.totalBob,
    changeAmountBob: sale.changeAmountBob,
    cashier: { id: cashier?.id ?? "user-demo", name: cashier?.displayName ?? "Usuario Demo" },
    shift: { id: sale.cashShiftId, registerCode: shift?.cashRegisterCode ?? "CAJA-DEMO-01" },
    branch: { id: "BR-DEMO-01", code: "CENTRAL", name: "Sucursal Central" },
    pharmacy: { name: "Farmacia Demo", legalName: "Farmacia Demo S.R.L.", taxId: "1020304011" },
    warehouse: { id: sale.warehouseId, name: warehouse?.name ?? "Almacén Central" },
    void: null,
    returns: [],
    customer: sale.customer ?? null,
    loyalty: sale.customer ? (sale.loyalty ?? null) : null,
    agreement: null,
    items: sale.items.map((item, index) => {
      const product = state.products.find((p) => p.presentationId === item.presentationId);
      return {
        id: `${sale.id}-item-${index + 1}`,
        returnedQuantity: 0,
        productName: item.productName,
        presentationName: product?.presentationName ?? "",
        quantity: item.quantity,
        quantityBase: item.quantityBase ?? item.quantity,
        unitPriceBob: item.unitPriceBob,
        lineTotalBob: item.lineTotalBob ?? (item.quantity * Number(item.unitPriceBob)).toFixed(2),
        fefoOverride: item.fefoOverride ?? false,
        fefoOverrideReason: item.fefoOverrideReason ?? null,
        allocations: (item.allocations ?? []).map((a) => ({
          lotCode: a.lotCode,
          expiresOn: a.expiresOn,
          quantityBase: a.quantityBase,
          fefoOverride: a.fefoOverride,
        })),
      };
    }),
    payments: sale.payments.map((p) => ({
      method: p.method,
      amountBob: p.amountBob,
      reference: p.reference ?? null,
      reversed: false,
    })),
  });
}

// ---- Controlled medicines ----

function prescriptionMatches(rx: SandboxState["prescriptions"][number], searchParams: URLSearchParams): boolean {
  const q = normalize(searchParams.get("q") ?? "");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const day = rx.createdAt.slice(0, 10);
  const haystack = normalize(
    [rx.folio, rx.saleNumber, rx.doctorName, rx.doctorLicense, rx.patientName, rx.patientDocument].join(" "),
  );
  return (!q || haystack.includes(q)) && (!from || day >= from) && (!to || day <= to);
}

interface ControlledMovement {
  at: string;
  presentationId: string;
  productId: string;
  productName: string;
  presentationName: string;
  lotCode: string;
  warehouseName: string;
  type: "SALE" | "WASTE";
  quantityOut: number;
  document: { type: string; number: string };
  prescription: { folio: string; doctorName: string; doctorLicense: string; patientName: string; patientDocument: string } | null;
}

/** Exits of controlled products (sales and waste acts) in chronological order. */
function controlledMovements(state: SandboxState): ControlledMovement[] {
  const controlled = new Map(state.products.filter((p) => p.isControlled).map((p) => [p.presentationId, p]));
  const batchById = new Map(state.batches.map((b) => [b.id, b]));
  const movements: ControlledMovement[] = [];

  for (const sale of state.sales) {
    for (const item of sale.items) {
      const product = controlled.get(item.presentationId);
      if (!product) continue;
      for (const allocation of item.allocations ?? []) {
        const rx = sale.prescription;
        movements.push({
          at: sale.createdAt,
          presentationId: product.presentationId,
          productId: product.id,
          productName: product.name,
          presentationName: product.presentationName,
          lotCode: allocation.lotCode,
          warehouseName: batchById.get(allocation.batchId)?.warehouseName ?? "Almacén Central",
          type: "SALE",
          quantityOut: allocation.quantityBase,
          document: { type: "SALE", number: sale.saleNumber },
          prescription: rx
            ? {
                folio: rx.folio,
                doctorName: rx.doctorName,
                doctorLicense: rx.doctorLicense,
                patientName: rx.patientName,
                patientDocument: rx.patientDocument,
              }
            : null,
        });
      }
    }
  }
  for (const act of state.wasteActs) {
    const batch = batchById.get(act.batchId);
    const product = batch ? controlled.get(batch.presentationId) : undefined;
    if (!batch || !product) continue;
    movements.push({
      at: act.createdAt,
      presentationId: product.presentationId,
      productId: product.id,
      productName: product.name,
      presentationName: product.presentationName,
      lotCode: batch.lotCode,
      warehouseName: batch.warehouseName,
      type: "WASTE",
      quantityOut: act.quantityBase,
      document: { type: "WASTE", number: act.actNumber },
      prescription: null,
    });
  }
  return movements.sort((a, b) => a.at.localeCompare(b.at));
}

/** Opening stock of the sandbox session: what is left plus everything that left. */
function openingByPresentation(state: SandboxState, movements: ControlledMovement[]): Map<string, number> {
  const opening = new Map<string, number>();
  for (const product of state.products.filter((p) => p.isControlled)) {
    const stock = state.batches
      .filter((b) => b.presentationId === product.presentationId)
      .reduce((acc, b) => acc + b.availableQuantity, 0);
    const out = movements
      .filter((m) => m.presentationId === product.presentationId)
      .reduce((acc, m) => acc + m.quantityOut, 0);
    opening.set(product.presentationId, stock + out);
  }
  return opening;
}

function isCurrentMonth(month: string): boolean {
  return month === new Date().toISOString().slice(0, 7);
}

function handleControlled(route: string, method: string, searchParams: URLSearchParams): SandboxInterceptResult | null {
  if (method !== "GET" || !route.startsWith("/controlled/")) return null;
  const state = getSandboxState();

  if (route === "/controlled/prescriptions") {
    const matches = state.prescriptions
      .filter((rx) => prescriptionMatches(rx, searchParams))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .map((rx) => ({ ...rx, notes: rx.notes ?? null, createdByUserId: state.users[0]?.id ?? "user-demo" }));
    return ok(paged(matches, searchParams));
  }
  const detail = /^\/controlled\/prescriptions\/([^/]+)$/.exec(route);
  if (detail) {
    const rx = state.prescriptions.find((p) => p.id === decodeURIComponent(detail[1]!));
    return rx
      ? ok({ ...rx, notes: rx.notes ?? null, createdByUserId: state.users[0]?.id ?? "user-demo" })
      : notFound("Receta no encontrada.");
  }

  const month = searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
  const movements = controlledMovements(state);
  const opening = openingByPresentation(state, movements);

  if (route === "/controlled/book") {
    if (!isCurrentMonth(month)) return ok({ month, openings: [], lines: [] });
    const running = new Map(opening);
    const lines = movements.map((m, index) => {
      const balance = (running.get(m.presentationId) ?? 0) - m.quantityOut;
      running.set(m.presentationId, balance);
      return {
        folio: index + 1,
        occurredAt: m.at,
        date: m.at.slice(0, 10),
        productId: m.productId,
        productName: m.productName,
        presentationName: m.presentationName,
        lotCode: m.lotCode,
        warehouseName: m.warehouseName,
        movementType: m.type,
        quantityIn: 0,
        quantityOut: m.quantityOut,
        balanceBase: balance,
        document: m.document,
        prescription: m.prescription,
      };
    });
    const openings = state.products
      .filter((p) => p.isControlled)
      .map((p) => ({ productId: p.id, productName: p.name, openingBase: opening.get(p.presentationId) ?? 0 }));
    return ok({ month, openings, lines });
  }

  if (route === "/controlled/balance") {
    if (!isCurrentMonth(month)) return ok({ month, items: [] });
    const items = state.products
      .filter((p) => p.isControlled)
      .map((p) => {
        const own = movements.filter((m) => m.presentationId === p.presentationId);
        const byType: Record<string, number> = {};
        for (const m of own) byType[m.type] = (byType[m.type] ?? 0) + m.quantityOut;
        const exits = own.reduce((acc, m) => acc + m.quantityOut, 0);
        const openingBase = opening.get(p.presentationId) ?? 0;
        return {
          productId: p.id,
          productName: p.name,
          presentations: [{ id: p.presentationId, name: p.presentationName, baseUnitFactor: 1 }],
          openingBase,
          entries: { total: 0, byType: {} },
          exits: { total: exits, byType },
          closingBase: openingBase - exits,
          currentStockBase: openingBase - exits,
        };
      });
    return ok({ month, items });
  }
  return null;
}

// ---- Waste acts ----

function wasteActView(act: SandboxWasteAct, state: SandboxState) {
  const batch = state.batches.find((b) => b.id === act.batchId);
  const product = state.products.find((p) => p.presentationId === batch?.presentationId);
  return {
    id: act.id,
    actNumber: act.actNumber,
    createdAt: act.createdAt,
    warehouseName: batch?.warehouseName ?? "Almacén Central",
    productName: act.productName,
    presentationName: product?.presentationName ?? "",
    lotCode: act.lotCode,
    expiresOn: batch?.expiresOn ?? act.createdAt.slice(0, 10),
    quantityBase: act.quantityBase,
    reason: act.reason,
    disposalMethod: act.disposalMethod,
    createdByName: state.users[0]?.displayName ?? "Usuario Demo",
  };
}

function handleWasteActs(route: string, method: string): SandboxInterceptResult | null {
  if (method !== "GET") return null;
  const state = getSandboxState();
  if (route === "/inventory/waste-acts") {
    const items = [...state.wasteActs]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .map((act) => wasteActView(act, state));
    return ok({ items });
  }
  const detail = /^\/inventory\/waste-acts\/([^/]+)$/.exec(route);
  if (detail) {
    const act = state.wasteActs.find((a) => a.id === decodeURIComponent(detail[1]!));
    if (!act) return notFound("Acta no encontrada.");
    const unitCost = "10.0000";
    return ok({
      ...wasteActView(act, state),
      tenantName: "Farmacia Demo",
      legalName: "Farmacia Demo S.R.L.",
      taxId: "1020304011",
      branchCode: "CENTRAL",
      branchName: "Sucursal Central",
      unitCost,
      totalCost: (Number(unitCost) * act.quantityBase).toFixed(4),
    });
  }
  return null;
}

/**
 * Resolves the simulated record routes. Returns null when the route is not simulated.
 * `route` is already normalized (no /api or /api/v1 prefix, no trailing slash).
 */
export function handleRecordRoutes(
  route: string,
  method: string,
  searchParams: URLSearchParams,
): SandboxInterceptResult | null {
  return (
    handleCustomers(route, method, searchParams) ??
    handleSaleDetail(route, method) ??
    handleControlled(route, method, searchParams) ??
    handleWasteActs(route, method)
  );
}
