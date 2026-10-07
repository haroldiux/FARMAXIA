import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req, UnauthorizedException } from "@nestjs/common";
import { RequireAnyPermission, RequirePermissions } from "../auth/auth.decorators.js";
import type { AuthenticatedRequest } from "../auth/authentication.guard.js";
import { RequireFeature } from "../saas/subscription.guard.js";
import { LoyaltyService, type CustomerLoyalty, type LoyaltyMovement, type LoyaltySettingsInput } from "./loyalty.service.js";
import type { LoyaltySettings } from "./loyalty-ledger.js";

function scopeFrom(request: AuthenticatedRequest) {
  if (!request.auth) throw new UnauthorizedException();
  return request.auth;
}

@Controller("api/v1")
@RequireFeature("crm.loyalty")
export class LoyaltyController {
  constructor(@Inject(LoyaltyService) private readonly loyalty: LoyaltyService) {}

  @Get("loyalty/settings")
  @RequireAnyPermission("loyalty.manage", "customers.manage", "sales.confirm")
  settings(@Req() request: AuthenticatedRequest): Promise<LoyaltySettings> {
    return this.loyalty.getSettings(scopeFrom(request));
  }

  @Put("loyalty/settings")
  @RequirePermissions("loyalty.manage")
  updateSettings(@Req() request: AuthenticatedRequest, @Body() body: LoyaltySettingsInput): Promise<LoyaltySettings> {
    return this.loyalty.updateSettings(scopeFrom(request), body);
  }

  @Get("customers/:customerId/loyalty")
  @RequireAnyPermission("loyalty.manage", "customers.manage", "sales.confirm")
  customerLoyalty(
    @Req() request: AuthenticatedRequest,
    @Param("customerId") customerId: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string
  ): Promise<CustomerLoyalty> {
    return this.loyalty.customerLoyalty(scopeFrom(request), customerId, {
      limit: limit === undefined ? undefined : Number(limit),
      offset: offset === undefined ? undefined : Number(offset)
    });
  }

  @Post("customers/:customerId/loyalty/adjustments")
  @RequirePermissions("loyalty.manage")
  adjust(
    @Req() request: AuthenticatedRequest,
    @Param("customerId") customerId: string,
    @Body() body: { points: number; reason: string }
  ): Promise<LoyaltyMovement & { balance: number }> {
    return this.loyalty.adjust(scopeFrom(request), customerId, body);
  }
}
