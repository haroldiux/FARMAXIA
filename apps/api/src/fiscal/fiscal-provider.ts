/**
 * F13: technical scaffold for module 6 fiscal invoicing (SIAT). D03 (SIN modality, contract and
 * digital certificate — external, pending teacher consultation) blocks the real adapter: no SOAP
 * client, CUF/CUFD generation, XML signing, QR representation or contingency mode live here.
 *
 * D50: the port exposes only `issueInvoice` and `voidInvoice`; CUFD renewal, SIN catalog sync and
 * contingency sync are internal concerns of whatever adapter implements this port later.
 */

export type FiscalInvoiceStatus = "PENDING_PROVIDER" | "ISSUED" | "CONTINGENCY" | "VOIDED" | "ERROR";

export interface IssueInvoiceInput {
  tenantId: string;
  branchId: string;
  saleId: string;
  saleNumber: string;
  totalBob: string;
}

export interface IssueInvoiceResult {
  status: FiscalInvoiceStatus;
  providerName: string;
  cuf?: string | null;
  cufd?: string | null;
  xml?: string | null;
  qrData?: string | null;
  errorMessage?: string | null;
}

export interface VoidInvoiceInput {
  tenantId: string;
  branchId: string;
  saleId: string;
  cuf: string | null;
}

export interface VoidInvoiceResult {
  status: FiscalInvoiceStatus;
  errorMessage?: string | null;
}

/** Port the sale-confirm flow depends on; the real SIN adapter is a future implementation of this interface. */
export interface FiscalProvider {
  issueInvoice(input: IssueInvoiceInput): Promise<IssueInvoiceResult>;
  voidInvoice(input: VoidInvoiceInput): Promise<VoidInvoiceResult>;
}

/** DI token for the active FiscalProvider implementation (only StubFiscalProvider for now). */
export const FISCAL_PROVIDER = Symbol("FISCAL_PROVIDER");
