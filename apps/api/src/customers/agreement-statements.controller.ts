import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res, UnauthorizedException } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { RequirePermissions } from "../auth/auth.decorators.js";
import type { AuthenticatedRequest } from "../auth/authentication.guard.js";
import { RequireFeature } from "../saas/subscription.guard.js";
import {
  AgreementStatementsService,
  type StatementDetail,
  type StatementListResult,
  type StatementPaymentInput,
  type StatementPaymentResult,
  type StatementPreview
} from "./agreement-statements.service.js";

function scopeFrom(request: AuthenticatedRequest) {
  if (!request.auth) throw new UnauthorizedException();
  return request.auth;
}

const toNumber = (value: string | undefined): number | undefined => (value === undefined ? undefined : Number(value));

/** Monthly agreement statements (Premium, crm.agreements): every operation needs agreements.billing. */
@Controller("api/v1/agreement-statements")
@RequireFeature("crm.agreements")
export class AgreementStatementsController {
  constructor(@Inject(AgreementStatementsService) private readonly statements: AgreementStatementsService) {}

  @Get("preview")
  @RequirePermissions("agreements.billing")
  preview(
    @Req() request: AuthenticatedRequest,
    @Query("agreementId") agreementId: string,
    @Query("period") period: string
  ): Promise<StatementPreview> {
    return this.statements.preview(scopeFrom(request), { agreementId, period });
  }

  @Post()
  @RequirePermissions("agreements.billing")
  issue(@Req() request: AuthenticatedRequest, @Body() body: { agreementId: string; period: string }): Promise<StatementDetail> {
    return this.statements.issue(scopeFrom(request), body);
  }

  @Get()
  @RequirePermissions("agreements.billing")
  list(
    @Req() request: AuthenticatedRequest,
    @Query("agreementId") agreementId?: string,
    @Query("period") period?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string
  ): Promise<StatementListResult> {
    return this.statements.list(scopeFrom(request), { agreementId, period, status, limit: toNumber(limit), offset: toNumber(offset) });
  }

  @Get(":statementId")
  @RequirePermissions("agreements.billing")
  detail(@Req() request: AuthenticatedRequest, @Param("statementId") statementId: string): Promise<StatementDetail> {
    return this.statements.detail(scopeFrom(request), statementId);
  }

  @Post(":statementId/payments")
  @RequirePermissions("agreements.billing")
  registerPayment(
    @Req() request: AuthenticatedRequest,
    @Param("statementId") statementId: string,
    @Body() body: StatementPaymentInput
  ): Promise<StatementPaymentResult> {
    return this.statements.registerPayment(scopeFrom(request), statementId, body);
  }

  @Get(":statementId/export")
  @RequirePermissions("agreements.billing")
  async exportCsv(
    @Req() request: AuthenticatedRequest,
    @Param("statementId") statementId: string,
    @Res({ passthrough: true }) response: FastifyReply
  ): Promise<string> {
    const exported = await this.statements.exportCsv(scopeFrom(request), statementId);
    void response.header("Content-Type", "text/csv; charset=utf-8");
    void response.header("Content-Disposition", `attachment; filename="${exported.filename}"`);
    return exported.csv;
  }
}
