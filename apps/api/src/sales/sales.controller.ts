import { RequireFeature } from "../saas/subscription.guard.js";
import { Body, Controller, Get, Inject, Post, Req, UnauthorizedException } from "@nestjs/common";
import { RequireAnyPermission, RequirePermissions } from "../auth/auth.decorators.js";
import type { AuthenticatedRequest } from "../auth/authentication.guard.js";
import type { TenantScope } from "../database/tenant-database.js";
import { SalesService, type ConfirmSaleInput } from "./sales.service.js";

function scopeFrom(request: AuthenticatedRequest): TenantScope {
  const auth = request.auth;
  if (!auth) throw new UnauthorizedException();
  return { tenantId: auth.tenantId, branchId: auth.branchId, userId: auth.userId };
}

@RequireFeature("pos")
@Controller("api/v1/sales")
@RequirePermissions("sales.confirm")
export class SalesController {
  constructor(@Inject(SalesService) private readonly sales: SalesService) {}

  /** Resumen para el panel: lo ven quienes venden o administran la caja. */
  @Get("summary")
  @RequireAnyPermission("sales.confirm", "cash.manage")
  summary(@Req() request: AuthenticatedRequest) {
    return this.sales.summary(scopeFrom(request));
  }

  @Post("confirm")
  confirm(@Req() request: AuthenticatedRequest, @Body() input: ConfirmSaleInput) {
    return this.sales.confirm(scopeFrom(request), input);
  }
}
