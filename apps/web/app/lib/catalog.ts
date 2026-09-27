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

// ── Ficha del producto, categorías y presentaciones (módulo 2) ──

export type SaleClassification = "OTC" | "PRESCRIPTION" | "RETAINED_PRESCRIPTION" | "CONTROLLED";

export const saleClassificationLabels: Record<SaleClassification, string> = {
  OTC: "Venta libre",
  PRESCRIPTION: "Bajo receta",
  RETAINED_PRESCRIPTION: "Receta retenida",
  CONTROLLED: "Controlado"
};

export interface ProductProfile {
  name: string;
  categoryId: string | null;
  activeIngredient: string | null;
  genericName: string | null;
  concentration: string | null;
  pharmaceuticalForm: string | null;
  laboratory: string | null;
  sanitaryRegistration: string | null;
  saleClassification: SaleClassification;
  isControlled: boolean;
  requiresColdChain: boolean;
  coldChainMinCelsius: string | null;
  coldChainMaxCelsius: string | null;
  sinActivityCode: string | null;
  sinProductCode: string | null;
  sinUnitCode: string | null;
}

export interface CatalogPresentation {
  presentationId: string;
  name: string;
  baseUnitFactor: number;
  isSellable: boolean;
  isActive: boolean;
}

export interface CatalogProductSummary {
  productId: string;
  name: string;
  activeIngredient: string | null;
  genericName: string | null;
  concentration: string | null;
  pharmaceuticalForm: string | null;
  laboratory: string | null;
  saleClassification: SaleClassification;
  isControlled: boolean;
  requiresColdChain: boolean;
  isActive: boolean;
  categoryId: string | null;
  categoryName: string | null;
  presentations: CatalogPresentation[];
}

export interface CatalogProductDetail extends ProductProfile {
  productId: string;
  categoryName: string | null;
  categoryIsControlled: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  presentations: Array<CatalogPresentation & {
    barcodes: string[];
    currentPrice: { amount: string; currency: string; priceListName: string } | null;
  }>;
}

export interface CatalogCategory {
  id: string;
  name: string;
  isControlled: boolean;
  isActive: boolean;
  products: number;
}

export interface CatalogOptions {
  saleClassifications: SaleClassification[];
  pharmaceuticalForms: string[];
  defaultColdChainRange: { min: number; max: number };
}

/** Para respuestas 204 (sin cuerpo): mismo manejo de errores que request(). */
async function send(path: string, method: string, body: unknown): Promise<void> {
  const response = await authenticatedFetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    let message = "No pudimos guardar los cambios del catálogo.";
    try {
      const parsed = (await response.json()) as { message?: string };
      message = parsed.message ?? message;
    } catch {
      // Sin cuerpo JSON: mensaje genérico.
    }
    throw new Error(response.status === 403 ? "Tu sesión no tiene permiso para administrar el catálogo." : message);
  }
}

export async function listProducts(query: {
  search?: string;
  categoryId?: string;
  controlled?: boolean;
  coldChain?: boolean;
  includeInactive?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ items: CatalogProductSummary[]; total: number; limit: number; offset: number }> {
  const params = new URLSearchParams({ limit: String(query.limit ?? 50), offset: String(query.offset ?? 0) });
  if (query.search?.trim()) params.set("search", query.search.trim());
  if (query.categoryId) params.set("categoryId", query.categoryId);
  if (query.controlled) params.set("controlled", "true");
  if (query.coldChain) params.set("coldChain", "true");
  if (query.includeInactive) params.set("includeInactive", "true");
  return request(`/api/v1/catalog/products?${params.toString()}`);
}

export const catalogOptions = () => request<CatalogOptions>("/api/v1/catalog/options");
export const getProduct = (productId: string) => request<CatalogProductDetail>(`/api/v1/catalog/products/${encodeURIComponent(productId)}`);
export const listCategories = () => request<CatalogCategory[]>("/api/v1/catalog/categories");

export function createProduct(input: Partial<ProductProfile> & { name: string }): Promise<{ id: string }> {
  return request("/api/v1/catalog/products", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
}

export const updateProduct = (productId: string, input: Partial<ProductProfile> & { isActive?: boolean }) =>
  send(`/api/v1/catalog/products/${encodeURIComponent(productId)}`, "PATCH", input);

export function createCategory(input: { name: string; isControlled: boolean }): Promise<{ id: string }> {
  return request("/api/v1/catalog/categories", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
}

export const updateCategory = (categoryId: string, input: { name?: string; isControlled?: boolean; isActive?: boolean }) =>
  send(`/api/v1/catalog/categories/${encodeURIComponent(categoryId)}`, "PATCH", input);

export function createPresentation(productId: string, input: { name: string; baseUnitFactor: number; isSellable: boolean }): Promise<{ id: string }> {
  return request(`/api/v1/catalog/products/${encodeURIComponent(productId)}/presentations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
}

export const updatePresentation = (presentationId: string, input: { name?: string; isSellable?: boolean; isActive?: boolean }) =>
  send(`/api/v1/catalog/presentations/${encodeURIComponent(presentationId)}`, "PATCH", input);
