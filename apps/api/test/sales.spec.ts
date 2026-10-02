import { describe, expect, it } from "vitest";
import { evaluatePayments, normalizeSaleInput, type ConfirmSaleInput } from "../src/sales/sales.service.js";

describe("F11 non-fiscal cash sales", () => {
  it("rejects a CARD payment that has no reference", () => {
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
    expect(() => normalizeSaleInput(input)).toThrow(/reference/i);
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
      payments: [{ method: "CASH", amountBob: "12.3400" }],
      lines: [{
        presentationId: "00000000-0000-4000-8000-000000000002",
        quantity: 1,
        unitPriceBob: "12.3400"
      }]
    });
  });

  it("normalizes mixed payments with trimmed references", () => {
    const normalized = normalizeSaleInput({
      idempotencyKey: "sale-mixed-001",
      cashShiftId: "00000000-0000-4000-8000-000000000001",
      warehouseId: "00000000-0000-4000-8000-000000000003",
      payments: [
        { method: " cash ", amountBob: "10.0000" },
        { method: "qr", amountBob: "5.5000", reference: " QR-77 " },
        { method: "CARD", amountBob: "1", reference: "AUTH-1" }
      ],
      lines: [{ presentationId: "00000000-0000-4000-8000-000000000002", quantity: 1, unitPriceBob: "16.5000" }]
    });
    expect(normalized.payments).toEqual([
      { method: "CASH", amountBob: "10.0000" },
      { method: "QR", amountBob: "5.5000", reference: "QR-77" },
      { method: "CARD", amountBob: "1", reference: "AUTH-1" }
    ]);
  });

  it.each([
    [[{ method: "CHECK", amountBob: "1" }], /method/i],
    [[{ method: "QR", amountBob: "1", reference: "  " }], /reference/i],
    [[{ method: "CASH", amountBob: "1", reference: "X" }], /reference/i],
    [[{ method: "CASH", amountBob: "0" }], /greater than zero/i],
    [[], /payment/i]
  ])("rejects invalid payments %j", (payments, message) => {
    expect(() => normalizeSaleInput({
      idempotencyKey: "sale-pay-001",
      cashShiftId: "00000000-0000-4000-8000-000000000001",
      warehouseId: "00000000-0000-4000-8000-000000000003",
      payments: payments as never,
      lines: [{ presentationId: "00000000-0000-4000-8000-000000000002", quantity: 1, unitPriceBob: "1.0000" }]
    })).toThrow(message);
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

describe("evaluatePayments", () => {
  it("computes change from the cash excess using exact decimals", () => {
    expect(evaluatePayments("37.5000", [{ method: "CASH", amountBob: "50" }])).toEqual({
      paidBob: "50.0000", changeBob: "12.5000", cashNetBob: "37.5000"
    });
  });

  it("covers the total with mixed methods and counts only net cash", () => {
    const result = evaluatePayments("100.0000", [
      { method: "CARD", amountBob: "40.1000", reference: "A" },
      { method: "CASH", amountBob: "70" }
    ]);
    expect(result).toEqual({ paidBob: "110.1000", changeBob: "10.1000", cashNetBob: "59.9000" });
  });

  it("avoids floating point drift", () => {
    expect(evaluatePayments("0.3000", [
      { method: "CASH", amountBob: "0.1" }, { method: "QR", amountBob: "0.2", reference: "Q" }
    ]).changeBob).toBe("0.0000");
  });

  it("rejects underpayment", () => {
    expect(() => evaluatePayments("10.0000", [{ method: "CASH", amountBob: "9.9999" }])).toThrow(/cover the sale total/i);
  });

  it("rejects card or QR above what remains due", () => {
    expect(() => evaluatePayments("10.0000", [{ method: "CARD", amountBob: "10.0001", reference: "A" }])).toThrow(/card or qr/i);
    expect(() => evaluatePayments("10.0000", [
      { method: "CARD", amountBob: "8", reference: "A" }, { method: "QR", amountBob: "3", reference: "B" }
    ])).toThrow(/card or qr/i);
  });
});
