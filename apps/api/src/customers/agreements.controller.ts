import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { RequireAnyPermission, RequirePermissions } from "../auth/auth.decorators.js";
import type { AuthenticatedRequest } from "../auth/authentication.guard.js";
import { RequireFeature } from "../saas/subscription.guard.js";
import {
  AgreementsService,
  type Agreement,
  type AgreementInput,
  type AgreementListResult,
  type AgreementMember,
  type AgreementMemberInput,
  type CustomerAgreement
} from "./agreements.service.js";

function scopeFrom(request: AuthenticatedRequest) {
  if (!request.auth) throw new UnauthorizedException();
  return request.auth;
}

const toNumber = (value: string | undefined): number | undefined => (value === undefined ? undefined : Number(value));

/**
 * Agreements (Premium, crm.agreements). Reads are open to who manages or bills agreements; writes need
 * agreements.manage. The POS reads the agreements of a customer with the permission to sell.
 */
@Controller("api/v1")
@RequireFeature("crm.agreements")
export class AgreementsController {
  constructor(@Inject(AgreementsService) private readonly agreements: AgreementsService) {}

  @Get("agreements")
  @RequireAnyPermission("agreements.manage", "agreements.billing")
  list(
    @Req() request: AuthenticatedRequest,
    @Query("q") q?: string,
    @Query("active") active?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string
  ): Promise<AgreementListResult> {
    return this.agreements.list(scopeFrom(request), { q, active, limit: toNumber(limit), offset: toNumber(offset) });
  }

  @Post("agreements")
  @RequirePermissions("agreements.manage")
  create(@Req() request: AuthenticatedRequest, @Body() body: AgreementInput): Promise<Agreement> {
    return this.agreements.create(scopeFrom(request), body);
  }

  @Get("agreements/:agreementId")
  @RequireAnyPermission("agreements.manage", "agreements.billing")
  detail(@Req() request: AuthenticatedRequest, @Param("agreementId") agreementId: string): Promise<Agreement> {
    return this.agreements.detail(scopeFrom(request), agreementId);
  }

  @Patch("agreements/:agreementId")
  @RequirePermissions("agreements.manage")
  update(@Req() request: AuthenticatedRequest, @Param("agreementId") agreementId: string, @Body() body: AgreementInput): Promise<Agreement> {
    return this.agreements.update(scopeFrom(request), agreementId, body);
  }

  @Get("agreements/:agreementId/members")
  @RequireAnyPermission("agreements.manage", "agreements.billing")
  listMembers(@Req() request: AuthenticatedRequest, @Param("agreementId") agreementId: string): Promise<{ items: AgreementMember[] }> {
    return this.agreements.listMembers(scopeFrom(request), agreementId);
  }

  @Post("agreements/:agreementId/members")
  @RequirePermissions("agreements.manage")
  addMember(
    @Req() request: AuthenticatedRequest,
    @Param("agreementId") agreementId: string,
    @Body() body: AgreementMemberInput
  ): Promise<AgreementMember> {
    return this.agreements.addMember(scopeFrom(request), agreementId, body);
  }

  @Patch("agreements/:agreementId/members/:memberId")
  @RequirePermissions("agreements.manage")
  updateMember(
    @Req() request: AuthenticatedRequest,
    @Param("agreementId") agreementId: string,
    @Param("memberId") memberId: string,
    @Body() body: AgreementMemberInput
  ): Promise<AgreementMember> {
    return this.agreements.updateMember(scopeFrom(request), agreementId, memberId, body);
  }

  @Get("customers/:customerId/agreements")
  @RequireAnyPermission("sales.confirm", "customers.manage", "agreements.manage", "agreements.billing")
  customerAgreements(@Req() request: AuthenticatedRequest, @Param("customerId") customerId: string): Promise<{ items: CustomerAgreement[] }> {
    return this.agreements.customerAgreements(scopeFrom(request), customerId);
  }
}
