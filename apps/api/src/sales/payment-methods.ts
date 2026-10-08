import { BadRequestException } from "@nestjs/common";

/**
 * Single place that classifies the payment methods of a sale. Adding a method means: add it to
 * `paymentMethods`, decide which classes it belongs to below, and extend the `sale_payments_method_check`
 * constraint. Everything that branches on a method goes through these
 * helpers (payment validation, drawer effect, earning of points, reversal on void).
 */
export const paymentMethods = ["CASH", "CARD", "QR", "POINTS", "AGREEMENT"] as const;
export type SalePaymentMethod = (typeof paymentMethods)[number];

/** Methods whose payment carries a manual voucher / transaction reference (mandatory). */
export const referenceMethods: readonly SalePaymentMethod[] = ["CARD", "QR"];

/**
 * Non-cash methods that settle the sale without money entering the till or a card/QR terminal
 * ("credit-like": POINTS and AGREEMENT). They need a customer, never carry a reference,
 * never touch the drawer, never earn loyalty points and are given back as such on returns.
 */
export const creditLikeMethods: readonly SalePaymentMethod[] = ["POINTS", "AGREEMENT"];

export const isCashMethod = (method: string): boolean => method === "CASH";
export const isCreditLike = (method: string): boolean => (creditLikeMethods as readonly string[]).includes(method);
export const requiresReference = (method: string): boolean => (referenceMethods as readonly string[]).includes(method);
/** Payments that count as money received for earning loyalty points (cash net of change, card, QR). */
export const earnsLoyalty = (method: string): boolean => !isCreditLike(method);

export function describePaymentMethods(): string {
  const names = [...paymentMethods];
  const last = names.pop();
  return `${names.join(", ")} or ${last}`;
}

export function assertPaymentMethod(method: string): SalePaymentMethod {
  if (!(paymentMethods as readonly string[]).includes(method)) {
    throw new BadRequestException(`Payment method must be ${describePaymentMethods()}.`);
  }
  return method as SalePaymentMethod;
}
