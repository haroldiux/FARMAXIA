import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Public, RequirePermissions } from "../auth/auth.decorators.js";
import { AuthService } from "../auth/auth.service.js";
import type { AuthenticatedRequest } from "../auth/authentication.guard.js";
import { RateLimiter } from "../auth/rate-limiter.js";
import { setRefreshCookie } from "../auth/refresh-cookie.js";
import { AuditLogService, type AuditLogQuery } from "./audit-log.service.js";
import { BillingService, type PlatformStatusAction } from "./billing.service.js";
import { OnboardingService, type RegisterPharmacyInput } from "./onboarding.service.js";
import { PlatformAuthGuard, type PlatformRequest } from "./platform-auth.js";
import { PlatformService } from "./platform.service.js";
import { RequireFeature } from "./subscription.guard.js";
import { TenantBillingService, type SubmitPaymentInput } from "./tenant-billing.service.js";

function scopeFrom(request: AuthenticatedRequest) {
  if (!request.auth) {
    throw new UnauthorizedException();
  }
  return request.auth;
}

function operatorFrom(request: PlatformRequest): string {
  if (!request.platformOperator) {
    throw new UnauthorizedException();
  }
  return request.platformOperator.operatorId;
}

@Public()
@Controller("api/v1/onboarding")
export class OnboardingController {
  // Evita crear farmacias en ráfaga desde una misma conexión.
  private readonly limiter = new RateLimiter(5, 60 * 60 * 1000, "TOO_MANY_REGISTRATIONS", "Demasiados registros desde esta conexión. Intenta más tarde.");

  constructor(
    @Inject(OnboardingService) private readonly onboarding: OnboardingService,
    @Inject(AuthService) private readonly auth: AuthService
  ) {}

  @Get("plans")
  plans() {
    return this.onboarding.listPublicPlans();
  }

  @Post("register")
  async register(
    @Req() request: FastifyRequest,
    @Body() input: RegisterPharmacyInput,
    @Res({ passthrough: true }) response: FastifyReply
  ) {
    this.limiter.check(request.ip);
    const pharmacy = await this.onboarding.register(input);
    // El dueño queda con la sesión iniciada en su nueva farmacia.
    const tokens = await this.auth.createSession({
      userId: pharmacy.userId,
      tenantId: pharmacy.tenantId,
      branchId: pharmacy.branchId
    });
    setRefreshCookie(response, tokens.refreshToken);
    return {
      tenantId: pharmacy.tenantId,
      tenantSlug: pharmacy.tenantSlug,
      branchId: pharmacy.branchId,
      trialEndsAt: pharmacy.trialEndsAt,
      accessToken: tokens.accessToken,
      expiresInSeconds: tokens.expiresInSeconds
    };
  }
}

@Controller("api/v1")
export class TenantSubscriptionController {
  constructor(
    @Inject(TenantBillingService) private readonly billing: TenantBillingService,
    @Inject(AuditLogService) private readonly auditLog: AuditLogService
  ) {}

  // Sin @RequireFeature: una farmacia suspendida debe poder ver su estado y pagar.
  @Get("subscription")
  summary(@Req() request: AuthenticatedRequest) {
    return this.billing.summary(scopeFrom(request));
  }

  @RequirePermissions("billing.manage")
  @Get("billing/invoices")
  invoices(@Req() request: AuthenticatedRequest) {
    return this.billing.listInvoices(scopeFrom(request));
  }

  @RequirePermissions("billing.manage")
  @Get("billing/invoices/:invoiceId")
  invoice(@Req() request: AuthenticatedRequest, @Param("invoiceId") invoiceId: string) {
    return this.billing.invoiceDocument(scopeFrom(request), invoiceId);
  }

  @RequirePermissions("billing.manage")
  @Post("billing/invoices/:invoiceId/payments")
  submitPayment(
    @Req() request: AuthenticatedRequest,
    @Param("invoiceId") invoiceId: string,
    @Body() input: SubmitPaymentInput
  ) {
    return this.billing.submitPayment(scopeFrom(request), invoiceId, input);
  }

  @RequirePermissions("audit.read")
  @RequireFeature("audit")
  @Get("audit/events")
  auditEvents(@Req() request: AuthenticatedRequest, @Query() query: AuditLogQuery) {
    return this.auditLog.list(scopeFrom(request), query);
  }
}

// @Public() desactiva el guard de sesión de farmacia; PlatformAuthGuard exige el token de operador.
@Public()
@Controller("api/v1/platform")
export class PlatformController {
  constructor(
    @Inject(PlatformService) private readonly platform: PlatformService,
    @Inject(BillingService) private readonly billing: BillingService
  ) {}

  @Post("auth/login")
  login(@Body() input: { email?: unknown; password?: unknown }) {
    return this.platform.login(input?.email, input?.password);
  }

  @UseGuards(PlatformAuthGuard)
  @Get("auth/me")
  me(@Req() request: PlatformRequest) {
    return this.platform.me(operatorFrom(request));
  }

  @UseGuards(PlatformAuthGuard)
  @Get("overview")
  overview() {
    return this.platform.overview();
  }

  @UseGuards(PlatformAuthGuard)
  @Get("tenants")
  tenants(@Query("search") search?: string, @Query("status") status?: string) {
    return this.platform.listTenants(search, status);
  }

  @UseGuards(PlatformAuthGuard)
  @Get("tenants/:tenantId")
  tenant(@Param("tenantId") tenantId: string) {
    return this.platform.tenantDetail(tenantId);
  }

  @UseGuards(PlatformAuthGuard)
  @HttpCode(204)
  @Post("tenants/:tenantId/plan")
  async changePlan(@Req() request: PlatformRequest, @Param("tenantId") tenantId: string, @Body() input: { planCode?: string }) {
    await this.billing.changePlan(operatorFrom(request), tenantId, String(input?.planCode ?? "").toUpperCase());
  }

  @UseGuards(PlatformAuthGuard)
  @HttpCode(204)
  @Post("tenants/:tenantId/status")
  async setStatus(@Req() request: PlatformRequest, @Param("tenantId") tenantId: string, @Body() input: { action?: string }) {
    const action = String(input?.action ?? "").toUpperCase();
    if (!["SUSPEND", "REACTIVATE", "CANCEL"].includes(action)) {
      throw new HttpException({ statusCode: 400, code: "INVALID_INPUT", message: "Acción no válida." }, 400);
    }
    await this.billing.setStatus(operatorFrom(request), tenantId, action as PlatformStatusAction);
  }

  @UseGuards(PlatformAuthGuard)
  @HttpCode(204)
  @Post("tenants/:tenantId/features")
  async setFeature(
    @Req() request: PlatformRequest,
    @Param("tenantId") tenantId: string,
    @Body() input: { featureCode?: string; enabled?: boolean | null }
  ) {
    const enabled = input?.enabled === undefined ? null : input.enabled;
    if (enabled !== null && typeof enabled !== "boolean") {
      throw new HttpException({ statusCode: 400, code: "INVALID_INPUT", message: "Valor no válido." }, 400);
    }
    await this.billing.setFeatureOverride(operatorFrom(request), tenantId, String(input?.featureCode ?? ""), enabled);
  }

  @UseGuards(PlatformAuthGuard)
  @Get("payments")
  payments(@Query("status") status?: string) {
    return this.platform.listPayments(status ?? "PENDING");
  }

  @UseGuards(PlatformAuthGuard)
  @Get("payments/:paymentId/attachment")
  async attachment(@Param("paymentId") paymentId: string, @Res() response: FastifyReply) {
    const file = await this.platform.paymentAttachment(paymentId);
    await response
      .header("content-type", file.mediaType)
      .header("content-disposition", "inline")
      .header("x-content-type-options", "nosniff")
      .header("cache-control", "private, no-store")
      .send(file.data);
  }

  @UseGuards(PlatformAuthGuard)
  @HttpCode(204)
  @Post("payments/:paymentId/approve")
  async approve(@Req() request: PlatformRequest, @Param("paymentId") paymentId: string, @Body() input: { note?: string }) {
    await this.billing.approvePayment(operatorFrom(request), paymentId, input?.note);
  }

  @UseGuards(PlatformAuthGuard)
  @HttpCode(204)
  @Post("payments/:paymentId/reject")
  async reject(@Req() request: PlatformRequest, @Param("paymentId") paymentId: string, @Body() input: { note?: string }) {
    await this.billing.rejectPayment(operatorFrom(request), paymentId, input?.note);
  }

  @UseGuards(PlatformAuthGuard)
  @Get("plans")
  plans() {
    return this.platform.listPlans();
  }

  @UseGuards(PlatformAuthGuard)
  @Get("features")
  features() {
    return this.platform.listFeatures();
  }

  @UseGuards(PlatformAuthGuard)
  @HttpCode(204)
  @Patch("plans/:code")
  async updatePlan(
    @Req() request: PlatformRequest,
    @Param("code") code: string,
    @Body() input: { priceMonthlyBob?: unknown; isPublic?: unknown }
  ) {
    await this.platform.updatePlan(operatorFrom(request), code, input ?? {});
  }

  @UseGuards(PlatformAuthGuard)
  @Post("billing/run-cycle")
  runCycle() {
    return this.billing.runCycle();
  }
}
