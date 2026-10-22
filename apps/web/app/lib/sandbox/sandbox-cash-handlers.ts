/**
 * FARMAXIA - Simulated cash module routes (registers, eligible users, shifts, movements).
 * Shapes mirror apps/web/app/lib/cash.ts.
 */

import {
  addCashMovement,
  approveMockShift,
  countMockShift,
  getSandboxState,
  openCashShift,
  openScheduledShift,
  type SandboxCashShift,
} from "./sandbox-store.ts";
import { badRequest, ok, parseBody, type SandboxInterceptResult } from "./sandbox-http.ts";

type MovementCategory = "CHANGE_FUND" | "EXPENSE" | "DEPOSIT" | "OTHER";

function sessionUser() {
  const user = getSandboxState().users[0];
  return { id: user?.id ?? "user-demo", displayName: user?.displayName ?? "Usuario Demo" };
}

/** Cash control of a shift as the real API returns it; scheduled shifts have none yet. */
function buildControl(shift: SandboxCashShift) {
  if (shift.status === "SCHEDULED") return undefined;
  const userId = sessionUser().id;
  return {
    id: `ctrl-${shift.id}`,
    cashShiftId: shift.id,
    openingAmountBob: shift.initialFundBob,
    expectedAmountBob: shift.expectedCashBob ?? shift.currentCashBob,
    countedAmountBob: shift.countedCashBob ?? null,
    differenceAmountBob: shift.differenceBob ?? null,
    status: shift.status,
    openedByUserId: userId,
    openedAt: shift.openedAt,
    countedByUserId: shift.countedCashBob ? userId : null,
    countedAt: shift.countedAt ?? null,
    approvedByUserId: shift.approvalNote ? userId : null,
    approvedAt: shift.approvalNote ? (shift.closedAt ?? null) : null,
    closedByUserId: shift.status === "CLOSED" ? userId : null,
    closedAt: shift.status === "CLOSED" ? (shift.closedAt ?? null) : null,
    approvalNote: shift.approvalNote ?? null,
    cashSalesBob: "0.00",
    movementsInBob: "0.00",
    movementsOutBob: "0.00",
  };
}

function shiftListItem(shift: SandboxCashShift) {
  return {
    id: shift.id,
    cashRegisterId: "CR-DEMO-01",
    cashRegisterCode: shift.cashRegisterCode,
    scheduledStartAt: shift.openedAt,
    scheduledEndAt: shift.closedAt || new Date(Date.now() + 8 * 3600 * 1000).toISOString(),
    status: "SCHEDULED" as const,
    users: [sessionUser()],
    control: buildControl(shift),
  };
}

function handleShiftMovements(shiftId: string, method: string, init?: RequestInit): SandboxInterceptResult | null {
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
      createdByUserId: sessionUser().id,
      createdAt: m.createdAt,
    }));
    const sum = (type: "IN" | "OUT") =>
      state.movements.filter((m) => m.movementType === type).reduce((acc, m) => acc + Number(m.amountBob || 0), 0);
    return ok({
      items,
      summary: {
        openingAmountBob: shift?.initialFundBob ?? "200.00",
        cashSalesBob: "0.00",
        movementsInBob: sum("IN").toFixed(2),
        movementsOutBob: sum("OUT").toFixed(2),
        expectedAmountBob: shift?.currentCashBob ?? "200.00",
      },
    });
  }

  if (method === "POST") {
    const body = parseBody<{ type: "IN" | "OUT"; amountBob: string; reason: string; category?: MovementCategory }>(init);
    if (!body?.amountBob || !body?.type) {
      return badRequest(null, "Datos de movimiento incompletos.");
    }
    try {
      return ok(addCashMovement(shiftId, body.type, body.amountBob, body.reason ?? "Movimiento demo", body.category), 201);
    } catch (error) {
      return badRequest(error, "Error al registrar movimiento.");
    }
  }
  return null;
}

function handleShiftAction(
  shiftId: string,
  action: string,
  method: string,
  init?: RequestInit,
): SandboxInterceptResult | null {
  if (method !== "POST") return null;
  try {
    if (action === "open") {
      const body = parseBody<{ openingAmountBob?: string }>(init);
      const amount = body?.openingAmountBob ?? "200.00";
      const exists = getSandboxState().shifts.find((s) => s.id === shiftId);
      const shift = exists?.status === "SCHEDULED" ? openScheduledShift(shiftId, amount) : openCashShift(amount);
      return ok(buildControl(shift));
    }
    if (action === "count" || action === "close") {
      const body = parseBody<{ countedAmountBob?: string; countedCashBob?: string }>(init);
      const counted = body?.countedAmountBob ?? body?.countedCashBob ?? "200.00";
      return ok(buildControl(countMockShift(shiftId, counted)));
    }
    if (action === "approve") {
      const body = parseBody<{ approvalNote?: string }>(init);
      return ok(buildControl(approveMockShift(shiftId, body?.approvalNote)));
    }
  } catch (error) {
    return badRequest(error, "No pudimos completar la operación de caja.");
  }
  return null;
}

export function handleCashRoutes(route: string, method: string, init?: RequestInit): SandboxInterceptResult | null {
  if (!route.startsWith("/cash/")) return null;

  if (route === "/cash/registers" && method === "GET") {
    return ok({ items: [{ id: "CR-DEMO-01", code: "CAJA-DEMO-01", isActive: true }] });
  }
  if (route === "/cash/eligible-users" && method === "GET") {
    return ok({ items: [sessionUser()] });
  }

  const movements = /^\/cash\/shifts\/([^/]+)\/movements$/.exec(route);
  if (movements) {
    return handleShiftMovements(decodeURIComponent(movements[1]!), method, init);
  }

  if (route === "/cash/movements" && method === "POST") {
    const body = parseBody<{
      cashShiftId: string;
      movementType: "IN" | "OUT";
      amountBob: string;
      reason: string;
      category?: MovementCategory;
    }>(init);
    if (!body?.cashShiftId || !body?.amountBob || !body?.movementType) {
      return badRequest(null, "Datos de movimiento incompletos.");
    }
    try {
      return ok(addCashMovement(body.cashShiftId, body.movementType, body.amountBob, body.reason, body.category), 201);
    } catch (error) {
      return badRequest(error, "Error al registrar movimiento.");
    }
  }

  const action = /^\/cash\/shifts\/([^/]+)\/(open|count|close|approve)$/.exec(route);
  if (action) {
    return handleShiftAction(decodeURIComponent(action[1]!), action[2]!, method, init);
  }

  if (route === "/cash/shifts") {
    if (method === "GET") {
      return ok({ items: getSandboxState().shifts.map(shiftListItem) });
    }
    if (method === "POST") {
      const body = parseBody<{ initialFundBob?: string; cashRegisterCode?: string }>(init);
      return ok(openCashShift(body?.initialFundBob ?? "200.00", body?.cashRegisterCode), 201);
    }
  }
  return null;
}
