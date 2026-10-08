import { Injectable, Logger } from "@nestjs/common";
import type {
  FiscalProvider,
  IssueInvoiceInput,
  IssueInvoiceResult,
  VoidInvoiceInput,
  VoidInvoiceResult
} from "./fiscal-provider.js";

/**
 * D52: the only FiscalProvider implementation until D03 (SIN modality, contract and digital
 * certificate) is resolved with the teacher. Never fabricates a CUF and never reports ISSUED —
 * every call stays PENDING_PROVIDER, so nobody mistakes a stub row for a real fiscal document.
 */
@Injectable()
export class StubFiscalProvider implements FiscalProvider {
  private readonly logger = new Logger(StubFiscalProvider.name);

  async issueInvoice(input: IssueInvoiceInput): Promise<IssueInvoiceResult> {
    this.logger.warn(
      `No real SIN connection configured (D03 pending): sale ${input.saleId} stays PENDING_PROVIDER.`
    );
    return {
      status: "PENDING_PROVIDER",
      providerName: "stub",
      cuf: null,
      cufd: null,
      xml: null,
      qrData: null,
      errorMessage: null
    };
  }

  async voidInvoice(input: VoidInvoiceInput): Promise<VoidInvoiceResult> {
    this.logger.warn(
      `No real SIN connection configured (D03 pending): sale ${input.saleId} cannot be voided fiscally yet.`
    );
    return { status: "PENDING_PROVIDER", errorMessage: "SIAT no conectado (D03 pendiente)." };
  }
}
