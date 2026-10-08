const MONEY_SCALE = 4;

/** Exact money arithmetic: decimal strings (max 4 places) as scaled BigInt units. */
export function toUnits(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 10n ** BigInt(MONEY_SCALE) + BigInt(fraction.padEnd(MONEY_SCALE, "0"));
}

export function fromUnits(units: bigint): string {
  const scale = 10n ** BigInt(MONEY_SCALE);
  return `${units / scale}.${(units % scale).toString().padStart(MONEY_SCALE, "0")}`;
}
