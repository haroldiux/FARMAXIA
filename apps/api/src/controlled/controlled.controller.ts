import { Controller, Get, Inject, Param, Query, Req, Res, UnauthorizedException } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { RequirePermissions } from "../auth/auth.decorators.js";
import type { AuthenticatedRequest } from "../auth/authentication.guard.js";
import { RequireFeature } from "../saas/subscription.guard.js";
import {
  ControlledService,
  type ControlledBalanceResult,
  type ControlledBookResult,
  type PrescriptionListResult,
  type PrescriptionSummary
} from "./controlled.service.js";

function scopeFrom(request: AuthenticatedRequest) {
  if (!request.auth) {
    throw new UnauthorizedException();
  }
  return request.auth;
}

function numberOrUndefined(value: string | undefined): number | undefined {
  return value === undefined || value === "" ? undefined : Number(value);
}

@RequireFeature("controlled.manual")
@Controller("api/v1/controlled")
@RequirePermissions("controlled.read")
export class ControlledController {
  constructor(@Inject(ControlledService) private readonly controlled: ControlledService) {}

  @Get("prescriptions")
  list(
    @Req() request: AuthenticatedRequest,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("q") q?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string
  ): Promise<PrescriptionListResult> {
    return this.controlled.listPrescriptions(scopeFrom(request), {
      from,
      to,
      q,
      limit: numberOrUndefined(limit),
      offset: numberOrUndefined(offset)
    });
  }

  @Get("prescriptions/:prescriptionId")
  detail(@Req() request: AuthenticatedRequest, @Param("prescriptionId") prescriptionId: string): Promise<PrescriptionSummary> {
    return this.controlled.prescriptionDetail(scopeFrom(request), prescriptionId);
  }

  @Get("balance")
  @RequireFeature("controlled.book")
  balance(@Req() request: AuthenticatedRequest, @Query("month") month: string): Promise<ControlledBalanceResult> {
    return this.controlled.balance(scopeFrom(request), month);
  }

  @Get("book")
  @RequireFeature("controlled.book")
  book(@Req() request: AuthenticatedRequest, @Query("month") month: string): Promise<ControlledBookResult> {
    return this.controlled.book(scopeFrom(request), month);
  }

  @Get("book/export")
  @RequireFeature("controlled.book")
  @RequirePermissions("controlled.read", "controlled.book.export")
  async exportBook(
    @Req() request: AuthenticatedRequest,
    @Query("month") month: string,
    @Res({ passthrough: true }) response: FastifyReply
  ): Promise<string> {
    const exported = await this.controlled.exportBookCsv(scopeFrom(request), month);
    void response.header("Content-Type", "text/csv; charset=utf-8");
    void response.header("Content-Disposition", `attachment; filename="${exported.filename}"`);
    return exported.csv;
  }
}
