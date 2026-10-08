import { Controller, Get, Inject, Param, Req, UnauthorizedException } from "@nestjs/common";
import { RequirePermissions } from "../auth/auth.decorators.js";
import type { AuthenticatedRequest } from "../auth/authentication.guard.js";
import type { TenantScope } from "../database/tenant-database.js";
import { FiscalService, type FiscalInvoiceSummary } from "./fiscal.service.js";

function scopeFrom(request: AuthenticatedRequest): TenantScope {
  const auth = request.auth;
  if (!auth) throw new UnauthorizedException();
  return { tenantId: auth.tenantId, branchId: auth.branchId, userId: auth.userId };
}

@Controller("api/v1/fiscal")
@RequirePermissions("fiscal.read")
export class FiscalController {
  constructor(@Inject(FiscalService) private readonly fiscal: FiscalService) {}

  /** Status of the fiscal invoice scaffold row created when the sale was confirmed (D51). */
  @Get("invoices/:saleId")
  get(@Req() request: AuthenticatedRequest, @Param("saleId") saleId: string): Promise<FiscalInvoiceSummary> {
    return this.fiscal.getBySaleId(scopeFrom(request), saleId);
  }
}
