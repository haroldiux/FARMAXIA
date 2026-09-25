import { Body, Controller, Inject, Post, Req, UnauthorizedException } from "@nestjs/common";
import { RequirePermissions } from "../auth/auth.decorators.js";
import type { AuthenticatedRequest } from "../auth/authentication.guard.js";
import type { TenantScope } from "../database/tenant-database.js";
import { SalesService, type ConfirmSaleInput } from "./sales.service.js";

function scopeFrom(request: AuthenticatedRequest): TenantScope {
  const auth = request.auth;
  if (!auth) throw new UnauthorizedException();
  return { tenantId: auth.tenantId, branchId: auth.branchId, userId: auth.userId };
}

@Controller("api/v1/sales")
@RequirePermissions("sales.confirm")
export class SalesController {
  constructor(@Inject(SalesService) private readonly sales: SalesService) {}

  @Post("confirm")
  confirm(@Req() request: AuthenticatedRequest, @Body() input: ConfirmSaleInput) {
    return this.sales.confirm(scopeFrom(request), input);
  }
}
