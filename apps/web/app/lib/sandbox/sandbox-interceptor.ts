/**
 * FARMAXIA - Client-side Fetch Interceptor for Interactive Training Sandbox
 * Routes simulated backend requests to the in-memory SandboxStore.
 */

import {
  getSandboxState,
  confirmMockSale,
  quarantineMockBatch,
  releaseMockBatch,
  recordMockWaste,
  type ConfirmMockSaleParams,
} from "./sandbox-store.ts";
import { parseBody, type SandboxInterceptResult } from "./sandbox-http.ts";
import { handleExtendedRoutes } from "./sandbox-handlers.ts";

export type { SandboxInterceptResult };

export const SANDBOX_BLOCKED_MESSAGE =
  "Modo entrenamiento: esta acción no se simula y no se envió al servidor.";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Strips the optional /api or /api/v1 prefix and trailing slashes so routes can be matched exactly.
 */
export function normalizeRoute(pathname: string): string {
  const withoutPrefix = pathname.replace(/^\/api(?:\/v1)?(?=\/)/, "");
  const trimmed = withoutPrefix.replace(/\/+$/, "");
  return trimmed || "/";
}

/**
 * Intercepts an API request and resolves it using in-memory sandbox data if recognized.
 */
export async function handleSandboxRequest(
  url: string,
  init?: RequestInit,
): Promise<SandboxInterceptResult> {
  const method = (init?.method || "GET").toUpperCase();
  const [rawPathname, searchString] = url.split("?");
  const searchParams = new URLSearchParams(searchString || "");

  if (!rawPathname) {
    return { handled: false, status: 404, body: null };
  }
  // Exact matching happens on the route without the /api or /api/v1 prefix and trailing slash.
  const pathname = normalizeRoute(rawPathname);

  // 1. Sales lookup: /api/sales/lookup or /api/v1/sales/lookup
  if (pathname === "/sales/lookup" && method === "GET") {
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
  if (pathname === "/sales/confirm" && method === "POST") {
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

  // 2b. Sales lookup of lots (FEFO order) for one presentation
  if (pathname === "/sales/lookup/batches" && method === "GET") {
    const presentationId = searchParams.get("presentationId") ?? "";
    const warehouseId = searchParams.get("warehouseId");
    const lots = getSandboxState()
      .batches.filter(
        (b) =>
          b.presentationId === presentationId &&
          b.status === "AVAILABLE" &&
          b.availableQuantity > 0 &&
          (!warehouseId || b.warehouseId === warehouseId),
      )
      .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
    const items = lots.map((b, index) => ({
      batchId: b.id,
      lotCode: b.lotCode,
      expiresOn: b.expiresOn,
      availableBase: b.availableQuantity,
      fefoSuggested: index === 0,
    }));
    return { handled: true, status: 200, body: { items } };
  }

  // 3a. Warehouse management details (counts, stock totals)
  if (pathname === "/inventory/warehouses/details" && method === "GET") {
    const state = getSandboxState();
    const items = [
      {
        id: "WH-DEMO-01",
        name: "Almacén Central",
        warehouseType: "CENTRAL",
        isDispatchEnabled: true,
        isActive: true,
        batchCount: state.batches.length,
        stockBase: state.batches.reduce((acc, b) => acc + b.availableQuantity, 0),
        reservedBase: state.batches.reduce((acc, b) => acc + b.reservedQuantity, 0),
        createdAt: state.shifts[0]?.openedAt ?? new Date().toISOString(),
      },
    ];
    return { handled: true, status: 200, body: { items } };
  }

  // 3. Inventory warehouses
  if (pathname === "/inventory/warehouses" && method === "GET") {
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

  // 4. Inventory expiry alerts (FEFO traffic light), filtered by horizon like the real API
  if (pathname === "/inventory/expiry-alerts" && method === "GET") {
    const horizonDays = Number(searchParams.get("horizonDays") || "30");
    const warehouseId = searchParams.get("warehouseId");
    const limit = Date.now() + horizonDays * 24 * 3600 * 1000;
    const alerts = getSandboxState()
      .batches.filter(
        (b) =>
          b.status !== "DISPOSED" &&
          (!warehouseId || b.warehouseId === warehouseId) &&
          new Date(b.expiresOn).getTime() <= limit,
      )
      .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))
      .map((b) => ({
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

  // 4b. Automatic inventory alerts panel
  if (pathname === "/inventory/alerts" && method === "GET") {
    const state = getSandboxState();
    const dayMs = 24 * 3600 * 1000;
    const items = state.batches
      .filter((b) => b.status !== "DISPOSED")
      .map((b) => ({ batch: b, daysToExpiry: Math.ceil((new Date(b.expiresOn).getTime() - Date.now()) / dayMs) }))
      .filter(({ daysToExpiry }) => daysToExpiry <= 90)
      .map(({ batch, daysToExpiry }) => {
        const product = state.products.find((p) => p.presentationId === batch.presentationId);
        return {
          id: `alert-${batch.id}`,
          alertType: daysToExpiry < 0 ? "EXPIRED" : "EXPIRING",
          warehouseId: batch.warehouseId,
          warehouseName: batch.warehouseName,
          batchId: batch.id,
          lotCode: batch.lotCode,
          productName: product?.name ?? "Producto Demo",
          presentationName: product?.presentationName ?? "",
          expiresOn: batch.expiresOn,
          daysToExpiry,
          quantityBase: batch.availableQuantity,
          createdAt: new Date().toISOString(),
          acknowledgedAt: null,
        };
      });
    return { handled: true, status: 200, body: { items } };
  }

  // 5. Inventory batch quarantine
  const quarantineMatch = /^\/inventory\/batches\/([^/]+)\/quarantine$/.exec(pathname);
  if (quarantineMatch && method === "POST") {
    const batchId = decodeURIComponent(quarantineMatch[1]!);
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
  const releaseMatch = /^\/inventory\/batches\/([^/]+)\/(?:release-quarantine|release)$/.exec(pathname);
  if (releaseMatch && method === "POST") {
    const batchId = decodeURIComponent(releaseMatch[1]!);
    const body = parseBody<{ reason: string }>(init);

    const batch = releaseMockBatch(batchId, body?.reason ?? "Liberación demo");
    return { handled: true, status: 200, body: batch };
  }

  // 7. Inventory waste
  const wasteMatch = /^\/inventory\/batches\/([^/]+)\/waste$/.exec(pathname);
  if ((pathname === "/inventory/waste" || wasteMatch) && method === "POST") {
    const body = parseBody<{
      batchId?: string;
      quantityBase: number;
      reason: string;
      disposalMethod?: string;
    }>(init);
    const batchId = body?.batchId ?? (wasteMatch ? decodeURIComponent(wasteMatch[1]!) : "batch-demo-1");

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

  // Cash, procurement, transfers, staff and users
  const extended = handleExtendedRoutes(pathname, method, searchParams, init);
  if (extended) {
    return extended;
  }

  // Deny-by-default: a write the sandbox does not simulate must never reach the real API.
  if (MUTATING_METHODS.has(method)) {
    return { handled: true, status: 423, body: { code: "SANDBOX_BLOCKED", message: SANDBOX_BLOCKED_MESSAGE } };
  }

  // Unhandled read -> let normal network fetch handle it (no pollution)
  return { handled: false, status: 404, body: null };
}
