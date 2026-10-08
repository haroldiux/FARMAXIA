import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { TenantDatabase, type TenantScope } from "../database/tenant-database.js";
import { FISCAL_PROVIDER, type FiscalInvoiceStatus, type FiscalProvider } from "./fiscal-provider.js";
import { StubFiscalProvider } from "./stub-fiscal-provider.js";

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

interface FiscalInvoiceRow {
  id: string;
  saleId: string;
  status: FiscalInvoiceStatus;
  cuf: string | null;
  cufd: string | null;
  qrData: string | null;
  providerName: string | null;
  errorMessage: string | null;
  createdAt: Date;
}

export interface DraftSaleInput {
  saleId: string;
  saleNumber: string;
  totalBob: string;
}

/**
 * F13 scaffold: creates the draft `fiscal_invoices` row for every confirmed sale and reads its
 * status back. No SIN call ever happens here — `FiscalProvider` is only the port; the real adapter
 * is blocked on D03. Constructed manually (not only through Nest DI) so `SalesService.postSale` can
 * use it without the sales module depending on the fiscal module.
 */
@Injectable()
export class FiscalService {
  constructor(
    @Inject(TenantDatabase) private readonly database: TenantDatabase,
    @Inject(FISCAL_PROVIDER) private readonly provider: FiscalProvider = new StubFiscalProvider()
  ) {}

  /**
   * D51: runs synchronously inside the same transaction as the sale confirm (not via an
   * outbox/async worker) to keep the scaffold simple. Known rework: once the real SIN adapter makes
   * a network call, this will likely need to move to async (outbox + worker).
   */
  async createDraftInTransaction(client: PoolClient, scope: TenantScope, sale: DraftSaleInput): Promise<void> {
    const result = await this.provider.issueInvoice({
      tenantId: scope.tenantId,
      branchId: scope.branchId,
      saleId: sale.saleId,
      saleNumber: sale.saleNumber,
      totalBob: sale.totalBob
    });
    await client.query(
      `insert into fiscal_invoices
         (tenant_id, branch_id, sale_id, status, cuf, cufd, xml, qr_data, provider_name, error_message)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        scope.tenantId,
        scope.branchId,
        sale.saleId,
        result.status,
        result.cuf ?? null,
        result.cufd ?? null,
        result.xml ?? null,
        result.qrData ?? null,
        result.providerName,
        result.errorMessage ?? null
      ]
    );
  }

  async getBySaleId(scope: TenantScope, saleId: string): Promise<FiscalInvoiceSummary> {
    return this.database.withScope(scope, async (client) => {
      const { rows } = await client.query<FiscalInvoiceRow>(
        `select id, sale_id as "saleId", status, cuf, cufd, qr_data as "qrData",
                provider_name as "providerName", error_message as "errorMessage",
                created_at as "createdAt"
         from fiscal_invoices
         where tenant_id = $1 and branch_id = $2 and sale_id = $3`,
        [scope.tenantId, scope.branchId, saleId]
      );
      const row = rows[0];
      if (!row) {
        throw new NotFoundException("No fiscal invoice found for this sale.");
      }
      return { ...row, createdAt: row.createdAt.toISOString() };
    });
  }
}
