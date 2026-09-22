import { authenticatedFetch } from "./session";

export interface CatalogPriceList {
  id: string;
  name: string;
  currency: string;
  branchId: string | null;
}

export interface BarcodeLookup {
  productId: string;
  productName: string;
  presentationId: string;
  presentationName: string;
  baseUnitFactor: number;
  priceAmount: string | null;
  priceCurrency: string | null;
}

function idempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `catalog-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(path, init);
  if (!response.ok) {
    let message = "No pudimos completar la operación de catálogo.";
    try {
      const body = (await response.json()) as { message?: string };
      message = body.message ?? message;
    } catch {
      // Retain the stable fallback when the API has no JSON error body.
    }
    if (response.status === 403) {
      message = "Tu sesión no tiene permiso para administrar el catálogo.";
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export async function listPriceLists(): Promise<CatalogPriceList[]> {
  return (await request<{ items: CatalogPriceList[] }>("/api/v1/catalog/price-lists")).items;
}

export async function createPriceList(input: {
  name: string;
  currency: string;
  branchId?: string;
}): Promise<{ id: string }> {
  const key = idempotencyKey();
  return request("/api/v1/catalog/price-lists", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ ...input, idempotencyKey: key })
  });
}

export async function setPrice(input: {
  priceListId: string;
  presentationId: string;
  amount: string;
  validFrom: string;
  validTo?: string;
}): Promise<{ id: string }> {
  const key = idempotencyKey();
  return request("/api/v1/catalog/prices", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ ...input, idempotencyKey: key })
  });
}

export async function registerBarcode(input: {
  presentationId: string;
  barcode: string;
}): Promise<{ id: string }> {
  const key = idempotencyKey();
  return request("/api/v1/catalog/barcodes", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ ...input, idempotencyKey: key })
  });
}

export async function findBarcode(barcode: string): Promise<BarcodeLookup | null> {
  return request(`/api/v1/catalog/barcodes/${encodeURIComponent(barcode.trim())}`);
}
