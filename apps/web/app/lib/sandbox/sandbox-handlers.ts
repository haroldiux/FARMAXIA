/**
 * FARMAXIA - Simulated route handlers for procurement, transfers, staff and users.
 * Each handler reads/writes the in-memory sandbox store and returns the same shape
 * as the real API client in apps/web/app/lib/*.ts.
 */

import {
  createMockStaffShift,
  createMockUser,
  getSandboxState,
  receiveMockPurchaseOrder,
  requestMockTransfer,
  type ReceiveMockPurchaseOrderParams,
  type RequestMockTransferParams,
  type CreateMockStaffShiftParams,
  type CreateMockUserParams,
} from "./sandbox-store.ts";
import { badRequest, ok, parseBody, type SandboxInterceptResult } from "./sandbox-http.ts";
import { handleCashRoutes } from "./sandbox-cash-handlers.ts";
import { handleRecordRoutes } from "./sandbox-records-handlers.ts";

/** La Paz calendar day (UTC-4) of an ISO instant. */
function laPazDay(iso: string): string {
  return new Date(Date.parse(iso) - 4 * 3600 * 1000).toISOString().slice(0, 10);
}

function handleProcurement(
  route: string,
  method: string,
  init?: RequestInit,
): SandboxInterceptResult | null {
  if (!route.startsWith("/procurement/")) return null;
  const state = getSandboxState();

  if (method === "GET") {
    switch (route) {
      case "/procurement/suppliers":
        return ok({ items: state.suppliers });
      case "/procurement/presentations":
        return ok({
          items: state.products.map((p) => ({
            presentationId: p.presentationId,
            presentationName: p.presentationName,
            productName: p.name,
            baseUnitFactor: 1,
            isSellable: true,
          })),
        });
      case "/procurement/purchase-orders":
        return ok({ items: state.purchaseOrders });
      case "/procurement/receipts":
        return ok({ items: state.goodsReceipts });
      case "/procurement/costs":
        return ok({ items: [] });
      default:
        return null;
    }
  }

  if (method === "POST" && route === "/procurement/receipts") {
    const body = parseBody<ReceiveMockPurchaseOrderParams>(init);
    if (!body) return badRequest(null, "Cuerpo de solicitud inválido.");
    try {
      return ok(receiveMockPurchaseOrder(body), 201);
    } catch (error) {
      return badRequest(error, "No pudimos registrar la recepción.");
    }
  }
  return null;
}

function handleTransfers(
  route: string,
  method: string,
  searchParams: URLSearchParams,
  init?: RequestInit,
): SandboxInterceptResult | null {
  if (route !== "/transfers" && !route.startsWith("/transfers/")) return null;
  const state = getSandboxState();

  if (method === "GET") {
    if (route === "/transfers/lookup/warehouses") {
      return ok({
        items: state.warehouses.map((w) => ({
          id: w.id,
          name: w.name,
          branchId: w.branchId,
          branchName: w.branchName,
          warehouseType: w.warehouseType,
        })),
      });
    }
    if (route === "/transfers/lookup/stock") {
      const warehouseId = searchParams.get("warehouseId") ?? "";
      const items = state.batches
        .filter((b) => b.warehouseId === warehouseId && b.status === "AVAILABLE" && b.availableQuantity > 0)
        .map((b) => {
          const product = state.products.find((p) => p.presentationId === b.presentationId);
          return {
            presentationId: b.presentationId,
            productName: product?.name ?? "Producto Demo",
            presentationName: product?.presentationName ?? "",
            batchId: b.id,
            lotCode: b.lotCode,
            availableQty: b.availableQuantity,
          };
        });
      return ok({ items });
    }
    if (route === "/transfers") {
      return ok({ items: state.transfers });
    }
    const detail = /^\/transfers\/([^/]+)$/.exec(route);
    if (detail) {
      const transfer = state.transfers.find((t) => t.id === decodeURIComponent(detail[1]!));
      return transfer ? ok(transfer) : ok({ message: "Traspaso no encontrado." }, 404);
    }
    return null;
  }

  if (method === "POST" && route === "/transfers") {
    const body = parseBody<RequestMockTransferParams>(init);
    if (!body) return badRequest(null, "Cuerpo de solicitud inválido.");
    try {
      return ok(requestMockTransfer(body), 201);
    } catch (error) {
      return badRequest(error, "No pudimos crear el traspaso.");
    }
  }
  return null;
}

function handleStaff(
  route: string,
  method: string,
  searchParams: URLSearchParams,
  init?: RequestInit,
): SandboxInterceptResult | null {
  if (!route.startsWith("/staff/")) return null;
  const state = getSandboxState();

  if (method === "GET") {
    if (route === "/staff/members") {
      return ok(
        state.users.filter((u) => u.isActive).map((u) => ({ userId: u.id, displayName: u.displayName })),
      );
    }
    if (route === "/staff/shifts" || route === "/staff/shifts/me") {
      const from = searchParams.get("from");
      const to = searchParams.get("to");
      const userId = route === "/staff/shifts/me" ? "user-demo" : searchParams.get("userId");
      const shifts = state.staffShifts
        .filter((s) => (!userId || s.userId === userId) && (!from || laPazDay(s.startsAt) >= from) && (!to || laPazDay(s.startsAt) <= to))
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      return ok(shifts);
    }
    return null;
  }

  if (method === "POST" && route === "/staff/shifts") {
    const body = parseBody<CreateMockStaffShiftParams>(init);
    if (!body) return badRequest(null, "Cuerpo de solicitud inválido.");
    try {
      return ok(createMockStaffShift(body), 201);
    } catch (error) {
      return badRequest(error, "No pudimos crear el turno.");
    }
  }
  return null;
}

function handleDirectory(route: string, method: string, init?: RequestInit): SandboxInterceptResult | null {
  if (!["/users", "/roles", "/permissions", "/branches"].includes(route)) return null;
  const state = getSandboxState();

  if (method === "GET") {
    switch (route) {
      case "/users":
        return ok(
          state.users.map(({ roleIds, branchIds, ...user }) => ({
            ...user,
            roles: roleIds
              .map((id) => state.roles.find((r) => r.id === id))
              .filter((r): r is NonNullable<typeof r> => Boolean(r))
              .map((r) => ({ id: r.id, code: r.code, name: r.name })),
            branches: branchIds
              .map((id) => state.branches.find((b) => b.id === id))
              .filter((b): b is NonNullable<typeof b> => Boolean(b))
              .map((b) => ({ id: b.id, code: b.code, name: b.name })),
          })),
        );
      case "/roles":
        return ok(
          state.roles.map((role) => ({
            ...role,
            users: state.users.filter((u) => u.roleIds.includes(role.id)).length,
          })),
        );
      case "/permissions":
        return ok(state.permissions);
      default:
        return ok(state.branches);
    }
  }

  if (method === "POST" && route === "/users") {
    const body = parseBody<CreateMockUserParams>(init);
    if (!body) return badRequest(null, "Cuerpo de solicitud inválido.");
    try {
      const { id } = createMockUser(body);
      return ok({ id }, 201);
    } catch (error) {
      return badRequest(error, "No pudimos crear el usuario.");
    }
  }
  return null;
}

/**
 * Resolves requests for the extended simulated modules. Returns null when the route is not simulated.
 * `route` is already normalized (no /api or /api/v1 prefix, no trailing slash).
 */
export function handleExtendedRoutes(
  route: string,
  method: string,
  searchParams: URLSearchParams,
  init?: RequestInit,
): SandboxInterceptResult | null {
  return (
    handleCashRoutes(route, method, init) ??
    handleRecordRoutes(route, method, searchParams) ??
    handleProcurement(route, method, init) ??
    handleTransfers(route, method, searchParams, init) ??
    handleStaff(route, method, searchParams, init) ??
    handleDirectory(route, method, init)
  );
}
