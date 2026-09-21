import { Body, Controller, Get, Param, Post, Req, UnauthorizedException } from "@nestjs/common";
import { RequirePermissions } from "../auth/auth.decorators.js";
import type { AuthenticatedRequest } from "../auth/authentication.guard.js";
import {
  CashService,
  type CashRegisterListResult,
  type CashShiftListResult,
  type CashShiftSummary,
  type CreateCashShiftInput,
  type EligibleCashUserListResult,
  type OpenCashShiftInput,
  type CountCashShiftInput,
  type ApproveCashShiftInput,
  type CashShiftControlSummary
} from "./cash.service.js";

function scopeFrom(request: AuthenticatedRequest) {
  if (!request.auth) {
    throw new UnauthorizedException();
  }
  return request.auth;
}

@Controller("api/v1/cash")
@RequirePermissions("cash.manage")
export class CashController {
  constructor(private readonly cash: CashService) {}

  @Get("registers")
  listRegisters(@Req() request: AuthenticatedRequest): Promise<CashRegisterListResult> {
    return this.cash.listRegisters(scopeFrom(request));
  }

  @Get("eligible-users")
  listEligibleUsers(
    @Req() request: AuthenticatedRequest
  ): Promise<EligibleCashUserListResult> {
    return this.cash.listEligibleUsers(scopeFrom(request));
  }

  @Get("shifts")
  listShifts(@Req() request: AuthenticatedRequest): Promise<CashShiftListResult> {
    return this.cash.listShifts(scopeFrom(request));
  }

  @Post("shifts")
  create(
    @Req() request: AuthenticatedRequest,
    @Body() input: CreateCashShiftInput
  ): Promise<CashShiftSummary> {
    return this.cash.createShift(scopeFrom(request), input);
  }

  @Post("shifts/:shiftId/open")
  open(
    @Req() request: AuthenticatedRequest,
    @Param("shiftId") shiftId: string,
    @Body() input: OpenCashShiftInput
  ): Promise<CashShiftControlSummary> {
    return this.cash.openShift(scopeFrom(request), shiftId, input);
  }

  @Post("shifts/:shiftId/count")
  count(
    @Req() request: AuthenticatedRequest,
    @Param("shiftId") shiftId: string,
    @Body() input: CountCashShiftInput
  ): Promise<CashShiftControlSummary> {
    return this.cash.countShift(scopeFrom(request), shiftId, input);
  }

  @Post("shifts/:shiftId/approve")
  @RequirePermissions("cash.manage", "cash.shift.approve")
  approve(
    @Req() request: AuthenticatedRequest,
    @Param("shiftId") shiftId: string,
    @Body() input: ApproveCashShiftInput
  ): Promise<CashShiftControlSummary> {
    return this.cash.approveShift(scopeFrom(request), shiftId, input);
  }
}
