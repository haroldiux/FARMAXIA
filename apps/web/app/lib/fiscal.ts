import { authenticatedFetch } from "./session";

export type FiscalInvoiceStatus = "PENDING_PROVIDER" | "ISSUED" | "CONTINGENCY" | "VOIDED" | "ERROR";

export interface FiscalInvoiceSummary {
  id: string;
  saleId: string;
  status: FiscalInvoiceStatus;
  cuf: string | null;
  cufd: string | null;
  qrData: string | null;
  providerName: string | null;
  errorMessage: string | null;
  createdAt: string;
}

/**
 * F13 scaffold: reads the fiscal invoice draft created when the sale was confirmed (D51). SIAT is
 * not connected yet (D03 pending), so the status is always PENDING_PROVIDER for now (D52).
 */
export function getFiscalInvoice(saleId: string): Promise<FiscalInvoiceSummary> {
  return authenticatedFetch(`/api/v1/fiscal/invoices/${encodeURIComponent(saleId)}`).then(async (response) => {
    if (!response.ok) {
      let message = "No pudimos consultar el comprobante fiscal.";
      try {
        const body = (await response.json()) as { message?: string };
        message = body.message ?? message;
      } catch {
        // Keep the stable fallback for non-JSON responses.
      }
      throw new Error(message);
    }
    return (await response.json()) as FiscalInvoiceSummary;
  });
}
