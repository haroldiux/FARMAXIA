import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { RequireAnyPermission, RequirePermissions } from "../auth/auth.decorators.js";
import type { AuthenticatedRequest } from "../auth/authentication.guard.js";
import { RequireFeature } from "../saas/subscription.guard.js";
import {
  CustomersService,
  type Customer,
  type CustomerInput,
  type CustomerListResult,
  type PurchaseHistory
} from "./customers.service.js";

function scopeFrom(request: AuthenticatedRequest) {
  if (!request.auth) throw new UnauthorizedException();
  return request.auth;
}

const toNumber = (value: string | undefined): number | undefined => (value === undefined ? undefined : Number(value));

/** Reads are open to whoever sells or manages customers (the POS picker); writes need customers.manage. */
@Controller("api/v1/customers")
@RequireFeature("crm.customers")
export class CustomersController {
  constructor(@Inject(CustomersService) private readonly customers: CustomersService) {}

  @Get()
  @RequireAnyPermission("customers.manage", "sales.confirm", "sales.read")
  list(
    @Req() request: AuthenticatedRequest,
    @Query("q") q?: string,
    @Query("active") active?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string
  ): Promise<CustomerListResult> {
    return this.customers.list(scopeFrom(request), { q, active, limit: toNumber(limit), offset: toNumber(offset) });
  }

  @Post()
  @RequirePermissions("customers.manage")
  create(@Req() request: AuthenticatedRequest, @Body() body: CustomerInput): Promise<Customer> {
    return this.customers.create(scopeFrom(request), body);
  }

  @Get(":customerId")
  @RequireAnyPermission("customers.manage", "sales.confirm", "sales.read")
  detail(@Req() request: AuthenticatedRequest, @Param("customerId") customerId: string): Promise<Customer> {
    return this.customers.detail(scopeFrom(request), customerId);
  }

  @Patch(":customerId")
  @RequirePermissions("customers.manage")
  update(@Req() request: AuthenticatedRequest, @Param("customerId") customerId: string, @Body() body: CustomerInput): Promise<Customer> {
    return this.customers.update(scopeFrom(request), customerId, body);
  }

  @Get(":customerId/purchases")
  @RequireAnyPermission("customers.manage", "sales.confirm", "sales.read")
  purchases(
    @Req() request: AuthenticatedRequest,
    @Param("customerId") customerId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string
  ): Promise<PurchaseHistory> {
    return this.customers.purchases(scopeFrom(request), customerId, { from, to, limit: toNumber(limit), offset: toNumber(offset) });
  }
}
