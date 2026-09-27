import { BadRequestException } from "@nestjs/common";

/**
 * Clasificación de venta del producto. Lista provisional (D32): la regencia puede
 * ajustarla; el POS la usará para exigir receta en el módulo 8.
 */
export const saleClassifications = ["OTC", "PRESCRIPTION", "RETAINED_PRESCRIPTION", "CONTROLLED"] as const;
export type SaleClassification = (typeof saleClassifications)[number];

/** Sugerencias de forma farmacéutica para la pantalla (texto libre en la base). */
export const pharmaceuticalFormSuggestions = [
  "Comprimido", "Comprimido recubierto", "Cápsula", "Jarabe", "Suspensión", "Solución oral", "Gotas",
  "Inyectable", "Polvo para reconstituir", "Crema", "Pomada", "Gel", "Óvulo", "Supositorio",
  "Parche", "Inhalador", "Colirio", "Spray nasal"
] as const;

/** Rango habitual de cadena de frío (°C) cuando no se indica otro. */
export const defaultColdChainRange = { min: 2, max: 8 } as const;

export interface ProductProfileInput {
  name?: string;
  categoryId?: string | null;
  activeIngredient?: string | null;
  genericName?: string | null;
  concentration?: string | null;
  pharmaceuticalForm?: string | null;
  laboratory?: string | null;
  sanitaryRegistration?: string | null;
  saleClassification?: string;
  isControlled?: boolean;
  requiresColdChain?: boolean;
  coldChainMinCelsius?: number | string | null;
  coldChainMaxCelsius?: number | string | null;
  sinActivityCode?: string | null;
  sinProductCode?: string | null;
  sinUnitCode?: string | null;
}

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

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalid(field: string, message: string): never {
  throw new BadRequestException({ code: "INVALID_INPUT", field, message });
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") invalid(field, `Revisa el campo ${field}.`);
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length > max) invalid(field, `El campo ${field} admite hasta ${max} caracteres.`);
  return trimmed || null;
}

function optionalDigits(value: unknown, field: string): string | null {
  const text = optionalText(value, field, 10);
  if (text !== null && !/^\d{1,10}$/.test(text)) invalid(field, "Los códigos del SIN solo llevan números.");
  return text;
}

function optionalCelsius(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  const number = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(number) || number < -40 || number > 40 || Math.round(number * 10) !== number * 10) {
    invalid(field, "La temperatura debe estar entre -40 y 40 °C, con un decimal como máximo.");
  }
  return number;
}

/**
 * Combina los datos actuales con los cambios y valida la ficha completa. Así la misma
 * regla sirve para crear (sin datos previos) y para editar.
 */
export function normalizeProfile(input: ProductProfileInput, current?: ProductProfile): ProductProfile {
  const pick = <K extends keyof ProductProfileInput>(key: K) => (input[key] === undefined ? current?.[key as keyof ProductProfile] : input[key]);

  const nameValue = pick("name");
  const name = typeof nameValue === "string" ? nameValue.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 200) invalid("name", "El nombre comercial es obligatorio (hasta 200 caracteres).");

  const categoryId = pick("categoryId");
  if (categoryId !== null && categoryId !== undefined && (typeof categoryId !== "string" || !uuidPattern.test(categoryId))) {
    invalid("categoryId", "La categoría no es válida.");
  }

  const classificationValue = pick("saleClassification") ?? "OTC";
  if (typeof classificationValue !== "string" || !saleClassifications.includes(classificationValue as SaleClassification)) {
    invalid("saleClassification", "Elige una clasificación de venta válida.");
  }
  const saleClassification = classificationValue as SaleClassification;

  const controlledValue = pick("isControlled");
  if (controlledValue !== undefined && typeof controlledValue !== "boolean") invalid("isControlled", "Valor no válido.");
  // La venta controlada implica medicamento controlado.
  const isControlled = saleClassification === "CONTROLLED" || controlledValue === true;

  const coldValue = pick("requiresColdChain");
  if (coldValue !== undefined && typeof coldValue !== "boolean") invalid("requiresColdChain", "Valor no válido.");
  const requiresColdChain = coldValue === true;
  let min: number | null = null;
  let max: number | null = null;
  if (requiresColdChain) {
    min = optionalCelsius(pick("coldChainMinCelsius"), "coldChainMinCelsius") ?? defaultColdChainRange.min;
    max = optionalCelsius(pick("coldChainMaxCelsius"), "coldChainMaxCelsius") ?? defaultColdChainRange.max;
    if (min >= max) invalid("coldChainMaxCelsius", "La temperatura máxima debe ser mayor que la mínima.");
  }

  return {
    name,
    categoryId: (categoryId as string | null | undefined) ?? null,
    activeIngredient: optionalText(pick("activeIngredient"), "activeIngredient", 240),
    genericName: optionalText(pick("genericName"), "genericName", 240),
    concentration: optionalText(pick("concentration"), "concentration", 120),
    pharmaceuticalForm: optionalText(pick("pharmaceuticalForm"), "pharmaceuticalForm", 80),
    laboratory: optionalText(pick("laboratory"), "laboratory", 160),
    sanitaryRegistration: optionalText(pick("sanitaryRegistration"), "sanitaryRegistration", 80),
    saleClassification,
    isControlled,
    requiresColdChain,
    coldChainMinCelsius: min === null ? null : min.toFixed(1),
    coldChainMaxCelsius: max === null ? null : max.toFixed(1),
    sinActivityCode: optionalDigits(pick("sinActivityCode"), "sinActivityCode"),
    sinProductCode: optionalDigits(pick("sinProductCode"), "sinProductCode"),
    sinUnitCode: optionalDigits(pick("sinUnitCode"), "sinUnitCode")
  };
}

/** Campos que cambiaron, para dejarlos en la bitácora. */
export function changedFields(before: ProductProfile, after: ProductProfile): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after) as Array<keyof ProductProfile>) {
    if (before[key] !== after[key]) {
      changes[key] = { from: before[key], to: after[key] };
    }
  }
  return changes;
}
