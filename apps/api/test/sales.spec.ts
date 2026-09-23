import { describe, expect, it } from "vitest";
import { normalizeSaleInput, type ConfirmSaleInput } from "../src/sales/sales.service.js";

describe("F11 non-fiscal cash sales", () => {
  it("normalizes exact decimal strings and rejects non-cash payments", () => {
    const input: ConfirmSaleInput = {
      idempotencyKey: "sale-red-001",
      cashShiftId: "00000000-0000-4000-8000-000000000001",
      warehouseId: "00000000-0000-4000-8000-000000000003",
      paymentMethod: "CARD",
      paidAmountBob: "12.3400",
      lines: [{
        presentationId: "00000000-0000-4000-8000-000000000002",
        quantity: 1,
        unitPriceBob: "12.3400"
      }]
    };
    expect(() => normalizeSaleInput(input)).toThrow(/cash/i);
  });
});
