import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { RequireAnyPermission, RequirePermissions } from "../auth/auth.decorators.js";
import type { AuthenticatedRequest } from "../auth/authentication.guard.js";
import { RequireFeature } from "../saas/subscription.guard.js";
import {
  StaffCommissionsService,
  type CommissionReport,
  type CommissionRule,
  type CommissionTier,
  type RuleInput,
  type TierInput
} from "./staff-commissions.service.js";
import { StaffProductivityService, type ProductivityReport } from "./staff-productivity.service.js";
import { StaffShiftsService, type CreateShiftInput, type StaffMember, type StaffShift } from "./staff-shifts.service.js";

function scopeFrom(request: AuthenticatedRequest) {
  if (!request.auth) {
    throw new UnauthorizedException();
  }
  return request.auth;
}

@Controller("api/v1/staff")
export class StaffController {
  constructor(
    @Inject(StaffShiftsService) private readonly shifts: StaffShiftsService,
    @Inject(StaffCommissionsService) private readonly commissions: StaffCommissionsService,
    @Inject(StaffProductivityService) private readonly productivity: StaffProductivityService
  ) {}

  // ---- Work shifts (plan feature staff.shifts) ----

  @Get("members")
  @RequireFeature("staff.shifts")
  @RequirePermissions("staff.shifts.manage")
  members(@Req() request: AuthenticatedRequest): Promise<StaffMember[]> {
    return this.shifts.listMembers(scopeFrom(request));
  }

  @Get("shifts")
  @RequireFeature("staff.shifts")
  @RequirePermissions("staff.shifts.manage")
  listShifts(
    @Req() request: AuthenticatedRequest,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("userId") userId?: string
  ): Promise<StaffShift[]> {
    return this.shifts.listShifts(scopeFrom(request), { from, to, userId });
  }

  @Get("shifts/me")
  @RequireFeature("staff.shifts")
  myShifts(@Req() request: AuthenticatedRequest, @Query("from") from?: string, @Query("to") to?: string): Promise<StaffShift[]> {
    return this.shifts.myShifts(scopeFrom(request), { from, to });
  }

  @Post("shifts")
  @RequireFeature("staff.shifts")
  @RequirePermissions("staff.shifts.manage")
  createShift(@Req() request: AuthenticatedRequest, @Body() body: CreateShiftInput): Promise<StaffShift> {
    return this.shifts.createShift(scopeFrom(request), body);
  }

  @Post("shifts/:shiftId/cancel")
  @HttpCode(200)
  @RequireFeature("staff.shifts")
  @RequirePermissions("staff.shifts.manage")
  cancelShift(@Req() request: AuthenticatedRequest, @Param("shiftId") shiftId: string, @Body() body: { reason: string }): Promise<StaffShift> {
    return this.shifts.cancelShift(scopeFrom(request), shiftId, body);
  }

  @Post("shifts/:shiftId/check-in")
  @HttpCode(200)
  @RequireFeature("staff.shifts")
  checkIn(@Req() request: AuthenticatedRequest, @Param("shiftId") shiftId: string): Promise<StaffShift> {
    return this.shifts.checkIn(scopeFrom(request), shiftId);
  }

  @Post("shifts/:shiftId/check-out")
  @HttpCode(200)
  @RequireFeature("staff.shifts")
  checkOut(@Req() request: AuthenticatedRequest, @Param("shiftId") shiftId: string): Promise<StaffShift> {
    return this.shifts.checkOut(scopeFrom(request), shiftId);
  }

  // ---- Commission rules, tiers and reports (plan feature staff.commissions) ----

  @Get("commissions/rules")
  @RequireFeature("staff.commissions")
  @RequireAnyPermission("staff.commissions.manage", "staff.reports.read")
  listRules(@Req() request: AuthenticatedRequest): Promise<CommissionRule[]> {
    return this.commissions.listRules(scopeFrom(request));
  }

  @Post("commissions/rules")
  @RequireFeature("staff.commissions")
  @RequirePermissions("staff.commissions.manage")
  createRule(@Req() request: AuthenticatedRequest, @Body() body: RuleInput): Promise<CommissionRule> {
    return this.commissions.createRule(scopeFrom(request), body);
  }

  @Patch("commissions/rules/:ruleId")
  @RequireFeature("staff.commissions")
  @RequirePermissions("staff.commissions.manage")
  updateRule(
    @Req() request: AuthenticatedRequest,
    @Param("ruleId") ruleId: string,
    @Body() body: { ratePercent?: number | string; isActive?: boolean }
  ): Promise<CommissionRule> {
    return this.commissions.updateRule(scopeFrom(request), ruleId, body);
  }

  @Delete("commissions/rules/:ruleId")
  @HttpCode(204)
  @RequireFeature("staff.commissions")
  @RequirePermissions("staff.commissions.manage")
  deleteRule(@Req() request: AuthenticatedRequest, @Param("ruleId") ruleId: string): Promise<void> {
    return this.commissions.deleteRule(scopeFrom(request), ruleId);
  }

  @Get("commissions/tiers")
  @RequireFeature("staff.commissions.multilevel")
  @RequireAnyPermission("staff.commissions.manage", "staff.reports.read")
  listTiers(@Req() request: AuthenticatedRequest): Promise<CommissionTier[]> {
    return this.commissions.listTiers(scopeFrom(request));
  }

  @Post("commissions/tiers")
  @RequireFeature("staff.commissions.multilevel")
  @RequirePermissions("staff.commissions.manage")
  createTier(@Req() request: AuthenticatedRequest, @Body() body: TierInput): Promise<CommissionTier> {
    return this.commissions.createTier(scopeFrom(request), body);
  }

  @Patch("commissions/tiers/:tierId")
  @RequireFeature("staff.commissions.multilevel")
  @RequirePermissions("staff.commissions.manage")
  updateTier(
    @Req() request: AuthenticatedRequest,
    @Param("tierId") tierId: string,
    @Body() body: { minNetSalesBob?: number | string; ratePercent?: number | string }
  ): Promise<CommissionTier> {
    return this.commissions.updateTier(scopeFrom(request), tierId, body);
  }

  @Delete("commissions/tiers/:tierId")
  @HttpCode(204)
  @RequireFeature("staff.commissions.multilevel")
  @RequirePermissions("staff.commissions.manage")
  deleteTier(@Req() request: AuthenticatedRequest, @Param("tierId") tierId: string): Promise<void> {
    return this.commissions.deleteTier(scopeFrom(request), tierId);
  }

  @Get("commissions/report")
  @RequireFeature("staff.commissions")
  @RequirePermissions("staff.reports.read")
  commissionReport(@Req() request: AuthenticatedRequest, @Query("from") from?: string, @Query("to") to?: string): Promise<CommissionReport> {
    return this.commissions.report(scopeFrom(request), { from, to });
  }

  @Get("commissions/me")
  @RequireFeature("staff.commissions")
  myCommissions(@Req() request: AuthenticatedRequest, @Query("from") from?: string, @Query("to") to?: string): Promise<CommissionReport> {
    return this.commissions.myReport(scopeFrom(request), { from, to });
  }

  // ---- Productivity (every plan; hours only with staff.shifts) ----

  @Get("productivity")
  @RequireFeature("reports.basic")
  @RequirePermissions("staff.reports.read")
  productivityReport(@Req() request: AuthenticatedRequest, @Query("from") from?: string, @Query("to") to?: string): Promise<ProductivityReport> {
    return this.productivity.report(scopeFrom(request), { from, to });
  }
}
