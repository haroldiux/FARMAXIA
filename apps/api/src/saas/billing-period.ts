/** Cuántos días antes del inicio de un periodo se emite su comprobante. */
export const invoiceLeadDays = 7;

export function addMonths(value: Date, months: number): Date {
  const result = new Date(value);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function addDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export interface BillableSubscription {
  startsAt: Date;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
}

/**
 * El siguiente periodo a cobrar empieza donde termina lo ya pagado; si nunca se pagó,
 * al terminar la prueba (o al iniciar la suscripción si no tuvo prueba).
 */
export function nextBillingPeriod(subscription: BillableSubscription): { start: Date; end: Date } {
  const start = subscription.currentPeriodEnd ?? subscription.trialEndsAt ?? subscription.startsAt;
  return { start, end: addMonths(start, 1) };
}

export function isInvoiceDue(periodStart: Date, now: Date): boolean {
  return periodStart.getTime() <= addDays(now, invoiceLeadDays).getTime();
}

export function formatInvoiceNumber(sequence: string | number): string {
  return `FX-${String(sequence).padStart(6, "0")}`;
}
