/**
 * FARMAXIA - Client-side Fetch Interceptor for Interactive Training Sandbox
 * Routes simulated backend requests to the in-memory SandboxStore.
 */

import {
  getSandboxState,
  openCashShift,
  addCashMovement,
  closeCashShift,
  confirmMockSale,
  quarantineMockBatch,
  releaseMockBatch,
  recordMockWaste,
  type ConfirmMockSaleParams,
} from "./sandbox-store.ts";

export interface SandboxInterceptResult {
  handled: boolean;
  status: number;
  body: unknown;
}

/**
 * Parses JSON body from RequestInit safely.
 */
function parseBody<T>(init?: RequestInit): T | null {
  if (!init?.body) return null;
  try {
    if (typeof init.body === "string") {
      return JSON.parse(init.body) as T;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Intercepts an API request and resolves it using in-memory sandbox data if recognized.
 */
export async function handleSandboxRequest(
  url: string,
  init?: RequestInit,
): Promise<SandboxInterceptResult> {
  const method = (init?.method || "GET").toUpperCase();
  const [pathname, searchString] = url.split("?");
  const searchParams = new URLSearchParams(searchString || "");

  if (!pathname) {
    return { handled: false, status: 404, body: null };
  }

  // 1. Sales lookup: /api/sales/lookup or /api/v1/sales/lookup
  if (pathname.includes("/sales/lookup") && method === "GET") {
    const query = (searchParams.get("q") || searchParams.get("query") || "").toLowerCase().trim();
    const state = getSandboxState();

    const matches = query
      ? state.products.filter(
          (p) =>
            p.name.toLowerCase().includes(query) ||
            p.genericName.toLowerCase().includes(query) ||
            p.barcode.includes(query),
        )
      : state.products;

    const formatted = matches.map((p) => {
      const batch = state.batches.find(
        (b) => b.presentationId === p.presentationId && b.status === "AVAILABLE",
      );
      return {
        presentationId: p.presentationId,
        productId: p.id,
        productName: p.name,
        presentationName: p.presentationName,
        genericName: p.genericName,
        activeIngredient: p.genericName,
        laboratory: p.laboratory,
        baseUnitFactor: 1,
        priceBob: p.unitPriceBob,
        availableBase: batch ? batch.availableQuantity : 0,
        availableQuantity: batch ? batch.availableQuantity : 0,
        barcode: p.barcode,
        isControlled: p.isControlled,
      };
    });

    if (searchParams.has("query") && !searchParams.has("q")) {
      return { handled: true, status: 200, body: formatted };
    }
    return { handled: true, status: 200, body: { items: formatted } };
  }

  // 2. Sales confirm: /api/sales/confirm or /api/v1/sales/confirm
  if (pathname.includes("/sales/confirm") && method === "POST") {
    const body = parseBody<ConfirmMockSaleParams>(init);
    if (!body) {
      return { handled: true, status: 400, body: { message: "Cuerpo de solicitud inválido." } };
    }

    try {
      const sale = confirmMockSale(body);
      return { handled: true, status: 201, body: sale };
    } catch (err) {
      return {
        handled: true,
        status: 400,
        body: { message: err instanceof Error ? err.message : "Error al confirmar venta demo." },
      };
    }
  }

  // 3. Inventory warehouses
  if (pathname.includes("/inventory/warehouses") && method === "GET") {
    return {
      handled: true,
      status: 200,
      body: {
        items: [
          {
            id: "WH-DEMO-01",
            name: "Almacén Central",
            isDispatchEnabled: true,
            warehouseType: "CENTRAL",
          },
        ],
      },
    };
  }

  // 4. Inventory expiry alerts
  if (pathname.includes("/inventory/expiry-alerts") && method === "GET") {
    const state = getSandboxState();
    const alerts = state.batches.map((b) => ({
      batchId: b.id,
      lotCode: b.lotCode,
      expiresOn: b.expiresOn,
      status: new Date(b.expiresOn) < new Date() ? "EXPIRED" : "DUE_SOON",
      batchStatus: b.status,
      quantityBase: b.availableQuantity,
      reservedBase: b.reservedQuantity,
      availableQuantity: b.availableQuantity,
    }));
    return { handled: true, status: 200, body: alerts };
  }

  // 5. Inventory batch quarantine
  if (pathname.includes("/inventory/batches/") && pathname.includes("/quarantine") && method === "POST") {
    const parts = pathname.split("/");
    const qIndex = parts.indexOf("quarantine");
    const batchId = parts[qIndex - 1] ?? "batch-demo-1";
    const body = parseBody<{ reason: string; reasonCode?: string; temperatureCelsius?: number }>(init);

    const batch = quarantineMockBatch(
      batchId,
      body?.reason ?? "Cuarentena demo",
      body?.reasonCode,
      body?.temperatureCelsius,
    );
    return { handled: true, status: 200, body: batch };
  }

  // 6. Inventory batch release
  if (
    pathname.includes("/inventory/batches/") &&
    (pathname.includes("/release-quarantine") || pathname.endsWith("/release")) &&
    method === "POST"
  ) {
    const parts = pathname.split("/");
    const relIndex = parts.findIndex((p) => p === "release" || p === "release-quarantine");
    const batchId = parts[relIndex - 1] ?? "batch-demo-1";
    const body = parseBody<{ reason: string }>(init);

    const batch = releaseMockBatch(batchId, body?.reason ?? "Liberación demo");
    return { handled: true, status: 200, body: batch };
  }

  // 7. Inventory waste
  if (
    (pathname.includes("/inventory/waste") || (pathname.includes("/inventory/batches/") && pathname.endsWith("/waste"))) &&
    method === "POST"
  ) {
    const parts = pathname.split("/");
    const wIndex = parts.indexOf("waste");
    const body = parseBody<{
      batchId?: string;
      quantityBase: number;
      reason: string;
      disposalMethod?: string;
    }>(init);
    const batchId = body?.batchId ?? parts[wIndex - 1] ?? "batch-demo-1";

    if (!body?.quantityBase) {
      return { handled: true, status: 400, body: { message: "Datos de merma incompletos." } };
    }

    const waste = recordMockWaste(
      batchId,
      body.quantityBase,
      body.reason ?? "Merma demo",
      body.disposalMethod,
    );
    return { handled: true, status: 201, body: { wasteEventId: waste.id, ...waste } };
  }

  // 8. Cash registers
  if (pathname.includes("/cash/registers") && method === "GET") {
    return {
      handled: true,
      status: 200,
      body: {
        items: [{ id: "CR-DEMO-01", code: "CAJA-DEMO-01", isActive: true }],
      },
    };
  }

  // 9. Cash eligible users
  if (pathname.includes("/cash/eligible-users") && method === "GET") {
    return {
      handled: true,
      status: 200,
      body: {
        items: [{ id: "user-demo", displayName: "Usuario Demo" }],
      },
    };
  }

  // 10. Cash shift movements: /cash/shifts/:id/movements or /cash/movements
  if (pathname.includes("/cash/shifts/") && pathname.endsWith("/movements")) {
    const parts = pathname.split("/");
    const mIndex = parts.indexOf("movements");
    const shiftId = parts[mIndex - 1] ?? "shift-demo-01";

    if (method === "GET") {
      const state = getSandboxState();
      const shift = state.shifts.find((s) => s.id === shiftId) ?? state.shifts[0];
      const items = state.movements.map((m) => ({
        id: m.id,
        cashShiftId: m.shiftId,
        type: m.movementType,
        amountBob: m.amountBob,
        reason: m.reason,
        category: m.category,
        createdByUserId: "user-demo",
        createdAt: m.createdAt,
      }));
      const movementsIn = state.movements
        .filter((m) => m.movementType === "IN")
        .reduce((acc, m) => acc + Number(m.amountBob || 0), 0);
      const movementsOut = state.movements
        .filter((m) => m.movementType === "OUT")
        .reduce((acc, m) => acc + Number(m.amountBob || 0), 0);

      return {
        handled: true,
        status: 200,
        body: {
          items,
          summary: {
            openingAmountBob: shift?.initialFundBob ?? "200.00",
            cashSalesBob: "0.00",
            movementsInBob: movementsIn.toFixed(2),
            movementsOutBob: movementsOut.toFixed(2),
            expectedAmountBob: shift?.currentCashBob ?? "200.00",
          },
        },
      };
    }

    if (method === "POST") {
      const body = parseBody<{
        type: "IN" | "OUT";
        amountBob: string;
        reason: string;
        category?: "CHANGE_FUND" | "EXPENSE" | "DEPOSIT" | "OTHER";
      }>(init);

      if (!body?.amountBob || !body?.type) {
        return { handled: true, status: 400, body: { message: "Datos de movimiento incompletos." } };
      }

      const movement = addCashMovement(
        shiftId,
        body.type,
        body.amountBob,
        body.reason ?? "Movimiento demo",
        body.category,
      );
      return { handled: true, status: 201, body: movement };
    }
  }

  // 11. Standalone cash movements: /cash/movements
  if (pathname.endsWith("/cash/movements") && method === "POST") {
    const body = parseBody<{
      cashShiftId: string;
      movementType: "IN" | "OUT";
      amountBob: string;
      reason: string;
      category?: "CHANGE_FUND" | "EXPENSE" | "DEPOSIT" | "OTHER";
    }>(init);

    if (!body?.cashShiftId || !body?.amountBob || !body?.movementType) {
      return { handled: true, status: 400, body: { message: "Datos de movimiento incompletos." } };
    }

    try {
      const movement = addCashMovement(
        body.cashShiftId,
        body.movementType,
        body.amountBob,
        body.reason,
        body.category,
      );
      return { handled: true, status: 201, body: movement };
    } catch (err) {
      return {
        handled: true,
        status: 400,
        body: { message: err instanceof Error ? err.message : "Error al registrar movimiento." },
      };
    }
  }

  // 12. Cash shift actions: open, count, close, approve
  if (pathname.includes("/cash/shifts/")) {
    const parts = pathname.split("/");
    const action = parts[parts.length - 1];
    const shiftId = parts[parts.length - 2] ?? "shift-demo-01";

    const createControl = (s: ReturnType<typeof getSandboxState>["shifts"][0]) => ({
      id: `ctrl-${s.id}`,
      cashShiftId: s.id,
      openingAmountBob: s.initialFundBob,
      expectedAmountBob: s.currentCashBob,
      countedAmountBob: s.countedCashBob ?? null,
      differenceAmountBob: s.differenceBob ?? null,
      status: s.status === "OPEN" ? "OPEN" : "CLOSED",
      openedByUserId: "user-demo",
      openedAt: s.openedAt,
      countedByUserId: null,
      countedAt: null,
      approvedByUserId: null,
      approvedAt: null,
      closedByUserId: null,
      closedAt: s.closedAt ?? null,
      approvalNote: null,
      cashSalesBob: "0.00",
      movementsInBob: "0.00",
      movementsOutBob: "0.00",
    });

    if (action === "open" && method === "POST") {
      const body = parseBody<{ openingAmountBob: string }>(init);
      const shift = openCashShift(body?.openingAmountBob ?? "200.00");
      return { handled: true, status: 200, body: createControl(shift) };
    }

    if ((action === "count" || action === "close") && method === "POST") {
      const body = parseBody<{ countedAmountBob?: string; countedCashBob?: string }>(init);
      const counted = body?.countedAmountBob ?? body?.countedCashBob ?? "200.00";
      const closed = closeCashShift(shiftId, counted);
      return { handled: true, status: 200, body: createControl(closed) };
    }

    if (action === "approve" && method === "POST") {
      const state = getSandboxState();
      const shift = state.shifts.find((s) => s.id === shiftId) ?? state.shifts[0]!;
      return { handled: true, status: 200, body: createControl(shift) };
    }
  }

  // 13. Cash shifts listing / creating: /api/cash/shifts or /api/v1/cash/shifts
  if (pathname.endsWith("/cash/shifts")) {
    if (method === "GET") {
      const state = getSandboxState();
      const items = state.shifts.map((s) => ({
        id: s.id,
        cashRegisterId: "CR-DEMO-01",
        cashRegisterCode: s.cashRegisterCode,
        scheduledStartAt: s.openedAt,
        scheduledEndAt: s.closedAt || new Date(Date.now() + 8 * 3600 * 1000).toISOString(),
        status: "SCHEDULED" as const,
        users: [{ id: "user-demo", displayName: "Usuario Demo" }],
        control: {
          id: `ctrl-${s.id}`,
          cashShiftId: s.id,
          openingAmountBob: s.initialFundBob,
          expectedAmountBob: s.currentCashBob,
          countedAmountBob: s.countedCashBob ?? null,
          differenceAmountBob: s.differenceBob ?? null,
          status: s.status === "OPEN" ? ("OPEN" as const) : ("CLOSED" as const),
          openedByUserId: "user-demo",
          openedAt: s.openedAt,
          countedByUserId: null,
          countedAt: null,
          approvedByUserId: null,
          approvedAt: null,
          closedByUserId: null,
          closedAt: s.closedAt ?? null,
          approvalNote: null,
          cashSalesBob: "0.00",
          movementsInBob: "0.00",
          movementsOutBob: "0.00",
        },
      }));
      return { handled: true, status: 200, body: { items } };
    }

    if (method === "POST") {
      const body = parseBody<{ initialFundBob: string; cashRegisterCode?: string }>(init);
      const shift = openCashShift(body?.initialFundBob ?? "200.00", body?.cashRegisterCode);
      return { handled: true, status: 201, body: shift };
    }
  }

  // Unhandled endpoint -> let normal network fetch handle it
  return { handled: false, status: 404, body: null };
}
