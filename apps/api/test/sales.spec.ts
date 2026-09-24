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

  it("normalizes CASH input without changing decimal string precision", () => {
    const input: ConfirmSaleInput = {
      idempotencyKey: " sale-cash-001 ",
      cashShiftId: " 00000000-0000-4000-8000-000000000001 ",
      warehouseId: " 00000000-0000-4000-8000-000000000003 ",
      paymentMethod: " cash ",
      paidAmountBob: " 12.3400 ",
      lines: [{
        presentationId: " 00000000-0000-4000-8000-000000000002 ",
        quantity: 1,
        unitPriceBob: " 12.3400 "
      }]
    };

    expect(normalizeSaleInput(input)).toEqual({
      idempotencyKey: "sale-cash-001",
      cashShiftId: "00000000-0000-4000-8000-000000000001",
      warehouseId: "00000000-0000-4000-8000-000000000003",
      paymentMethod: "CASH",
      paidAmountBob: "12.3400",
      lines: [{
        presentationId: "00000000-0000-4000-8000-000000000002",
        quantity: 1,
        unitPriceBob: "12.3400"
      }]
    });
  });

  it.each(["12.34567", "12.", ".5", "1e2", "invalid"])(
    "rejects invalid decimal value %s",
    (value) => {
      const input: ConfirmSaleInput = {
        idempotencyKey: "sale-decimal-001",
        cashShiftId: "00000000-0000-4000-8000-000000000001",
        warehouseId: "00000000-0000-4000-8000-000000000003",
        paymentMethod: "CASH",
        paidAmountBob: value,
        lines: [{
          presentationId: "00000000-0000-4000-8000-000000000002",
          quantity: 1,
          unitPriceBob: "12.3400"
        }]
      };

      expect(() => normalizeSaleInput(input)).toThrow(/decimal/i);
    }
  );

  it.each([0, -1, 1.5])("rejects invalid quantity %s", (value) => {
    const input: ConfirmSaleInput = {
      idempotencyKey: "sale-quantity-001",
      cashShiftId: "00000000-0000-4000-8000-000000000001",
      warehouseId: "00000000-0000-4000-8000-000000000003",
      paymentMethod: "CASH",
      paidAmountBob: "12.3400",
      lines: [{
        presentationId: "00000000-0000-4000-8000-000000000002",
        quantity: value,
        unitPriceBob: "12.3400"
      }]
    };

    expect(() => normalizeSaleInput(input)).toThrow(/quantity/i);
  });

  it("rejects empty sale lines", () => {
    const input: ConfirmSaleInput = {
      idempotencyKey: "sale-lines-001",
      cashShiftId: "00000000-0000-4000-8000-000000000001",
      warehouseId: "00000000-0000-4000-8000-000000000003",
      paymentMethod: "CASH",
      paidAmountBob: "12.3400",
      lines: []
    };

    expect(() => normalizeSaleInput(input)).toThrow(/sale lines/i);
  });
});
