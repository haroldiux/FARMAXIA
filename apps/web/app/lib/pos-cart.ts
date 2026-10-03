/**
 * Pure POS logic (no React, no I/O): exact money math, cart operations and barcode detection.
 * Money is handled as bigint in 1/10000 BOB units; never floating point.
 */

export const UNIT_SCALE = 10000n;

export function toUnits(value: string): bigint {
  const [whole = "0", fraction = ""] = value.trim().split(".");
  return BigInt(whole || "0") * UNIT_SCALE + BigInt(fraction.padEnd(4, "0"));
}

export function fromUnits(units: bigint): string {
  return `${units / UNIT_SCALE}.${(units % UNIT_SCALE).toString().padStart(4, "0")}`;
}

export function isDecimal(value: string): boolean {
  return /^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/.test(value.trim());
}

/** What the POS needs from a lookup result in order to put it in the cart. */
export interface CartSource {
  presentationId: string;
  label: string;
  priceBob: string | null;
  /** Whole presentation units that can be sold now in the dispatch warehouse. */
  availableQuantity: number;
  /** Controlled medicine: the sale will need prescription data. */
  isControlled?: boolean;
}

export interface CartLine {
  presentationId: string;
  label: string;
  unitPriceBob: string;
  quantity: number;
  available: number;
  /** Controlled medicine: shown with a badge and it makes the cart require a prescription. */
  isControlled?: boolean;
  /** Lot chosen instead of FEFO (authorized users only); absent means plain FEFO. */
  batchId?: string;
  batchLabel?: string;
}

export interface CartResult {
  lines: CartLine[];
  /** Spanish message for the cashier when the request could not be fully honored. */
  warning: string | null;
}

const MAX_QUANTITY = 9999;

function stockWarning(label: string, available: number): string {
  return available > 0
    ? `Solo hay ${available} unidad(es) disponibles de ${label}.`
    : `${label} no tiene stock disponible en este almacén.`;
}

/** Adds one unit of the item, or increments the existing line, never exceeding the available stock. */
export function addToCart(lines: readonly CartLine[], source: CartSource): CartResult {
  if (source.priceBob === null || !isDecimal(source.priceBob)) {
    return { lines: [...lines], warning: `${source.label} no tiene un precio vigente.` };
  }
  const existing = lines.find((line) => line.presentationId === source.presentationId);
  if (!existing) {
    if (source.availableQuantity < 1) return { lines: [...lines], warning: stockWarning(source.label, 0) };
    return {
      lines: [
        ...lines,
        {
          presentationId: source.presentationId,
          label: source.label,
          unitPriceBob: source.priceBob,
          quantity: 1,
          available: source.availableQuantity,
          ...(source.isControlled ? { isControlled: true } : {})
        }
      ],
      warning: null
    };
  }
  return setQuantity(lines, source.presentationId, existing.quantity + 1);
}

/** Sets the quantity of a line, clamped to [1, available]. A 0 keeps the line while the field is being edited. */
export function setQuantity(lines: readonly CartLine[], presentationId: string, quantity: number): CartResult {
  let warning: string | null = null;
  const next = lines.map((line) => {
    if (line.presentationId !== presentationId) return line;
    const limit = Math.min(line.available, MAX_QUANTITY);
    if (!Number.isFinite(quantity) || quantity < 0) return line;
    if (quantity > limit) {
      warning = stockWarning(line.label, line.available);
      return { ...line, quantity: limit };
    }
    return { ...line, quantity: Math.floor(quantity) };
  });
  return { lines: next, warning };
}

export function incrementLine(lines: readonly CartLine[], presentationId: string): CartResult {
  const line = lines.find((item) => item.presentationId === presentationId);
  return line ? setQuantity(lines, presentationId, line.quantity + 1) : { lines: [...lines], warning: null };
}

/** Decrements a line; it never goes below 1 (use removeLine to drop it). */
export function decrementLine(lines: readonly CartLine[], presentationId: string): CartResult {
  const line = lines.find((item) => item.presentationId === presentationId);
  return line ? setQuantity(lines, presentationId, Math.max(1, line.quantity - 1)) : { lines: [...lines], warning: null };
}

/** Parses the text of a quantity field: digits only, empty means 0 (pending edit). */
export function parseQuantityInput(raw: string): number {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  return digits === "" ? 0 : Number(digits);
}

export function removeLine(lines: readonly CartLine[], presentationId: string): CartLine[] {
  return lines.filter((line) => line.presentationId !== presentationId);
}

/** Pins a line to a specific lot, or returns it to FEFO when `batch` is null. */
export function setLineBatch(
  lines: readonly CartLine[],
  presentationId: string,
  batch: { batchId: string; label: string } | null
): CartLine[] {
  return lines.map((line) => {
    if (line.presentationId !== presentationId) return line;
    const { batchId: _batchId, batchLabel: _batchLabel, ...rest } = line;
    return batch ? { ...rest, batchId: batch.batchId, batchLabel: batch.label } : rest;
  });
}

export function lineTotalUnits(line: CartLine): bigint {
  return BigInt(line.quantity) * toUnits(line.unitPriceBob);
}

export function cartTotalUnits(lines: readonly CartLine[]): bigint {
  return lines.reduce((sum, line) => sum + lineTotalUnits(line), 0n);
}

/** True when any cart line is a controlled medicine (the sale then needs prescription data). */
export function cartHasControlled(lines: readonly CartLine[]): boolean {
  return lines.some((line) => line.isControlled === true);
}

export function isCartSellable(lines: readonly CartLine[]): boolean {
  return lines.length > 0 && lines.every((line) => line.quantity >= 1 && line.quantity <= line.available);
}

/**
 * Scanners type digits fast and finish with Enter, so a single token with no spaces that looks like
 * a product code is treated as a barcode candidate. It still has to match a registered barcode exactly.
 */
export function looksLikeBarcode(input: string): boolean {
  const value = input.trim();
  if (/^\d{6,18}$/.test(value)) return true;
  return /^[A-Z0-9._-]{8,40}$/.test(value) && /\d/.test(value);
}
