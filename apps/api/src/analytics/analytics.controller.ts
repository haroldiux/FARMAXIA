import { Controller, Get, Inject, Param, Post, Query, Req, Res, UnauthorizedException } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { RequirePermissions } from "../auth/auth.decorators.js";
import type { AuthenticatedRequest } from "../auth/authentication.guard.js";
import { RequireFeature } from "../saas/subscription.guard.js";
import {
  AnalyticsService,
  type AbcReport,
  type DashboardReport,
  type ForecastReport,
  type ProfitabilityReport,
  type RotationReport,
  type StockoutsReport
} from "./analytics.service.js";
import { StockAlertsService, type StockAlertList } from "./stock-alerts.service.js";

function scopeFrom(request: AuthenticatedRequest) {
  if (!request.auth) {
    throw new UnauthorizedException();
  }
  return request.auth;
}

/** F18 Module 11. Reports cover every branch the user belongs to; `branchId` narrows to one of them. */
@Controller("api/v1/analytics")
@RequirePermissions("analytics.read")
export class AnalyticsController {
  constructor(
    @Inject(AnalyticsService) private readonly analytics: AnalyticsService,
    @Inject(StockAlertsService) private readonly alerts: StockAlertsService
  ) {}

  @Get("abc")
  @RequireFeature("analytics.abc")
  abc(
    @Req() request: AuthenticatedRequest,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("branchId") branchId?: string
  ): Promise<AbcReport> {
    return this.analytics.abc(scopeFrom(request), { from, to, branchId });
  }

  @Get("rotation")
  @RequireFeature("analytics.profitability")
  rotation(
    @Req() request: AuthenticatedRequest,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("branchId") branchId?: string
  ): Promise<RotationReport> {
    return this.analytics.rotation(scopeFrom(request), { from, to, branchId });
  }

  @Get("profitability")
  @RequireFeature("analytics.profitability")
  async profitability(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: FastifyReply,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("branchId") branchId?: string,
    @Query("groupBy") groupBy?: string,
    @Query("format") format?: string
  ): Promise<ProfitabilityReport | string> {
    const query = { from, to, branchId, groupBy };
    if (format === "csv") {
      const exported = await this.analytics.profitabilityCsv(scopeFrom(request), query);
      void response.header("Content-Type", "text/csv; charset=utf-8");
      void response.header("Content-Disposition", `attachment; filename="${exported.filename}"`);
      return exported.csv;
    }
    return this.analytics.profitability(scopeFrom(request), query);
  }

  @Get("stockouts")
  @RequireFeature("analytics.profitability")
  stockouts(@Req() request: AuthenticatedRequest, @Query("branchId") branchId?: string): Promise<StockoutsReport> {
    return this.analytics.stockouts(scopeFrom(request), { branchId });
  }

  @Get("stock-alerts")
  @RequireFeature("analytics.profitability")
  stockAlerts(@Req() request: AuthenticatedRequest, @Query("status") status?: string, @Query("branchId") branchId?: string): Promise<StockAlertList> {
    return this.alerts.list(scopeFrom(request), { status, branchId });
  }

  @Post("stock-alerts/:id/acknowledge")
  @RequireFeature("analytics.profitability")
  acknowledgeStockAlert(@Req() request: AuthenticatedRequest, @Param("id") id: string): Promise<{ id: string; acknowledgedAt: string }> {
    return this.alerts.acknowledge(scopeFrom(request), id);
  }

  @Get("dashboard")
  @RequireFeature("reports.basic")
  dashboard(
    @Req() request: AuthenticatedRequest,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("branchId") branchId?: string
  ): Promise<DashboardReport> {
    return this.analytics.dashboard(scopeFrom(request), { from, to, branchId });
  }

  @Get("forecast")
  @RequireFeature("analytics.abc")
  forecast(@Req() request: AuthenticatedRequest, @Query("branchId") branchId?: string, @Query("horizonDays") horizonDays?: string): Promise<ForecastReport> {
    return this.analytics.forecast(scopeFrom(request), { branchId, horizonDays });
  }
}
