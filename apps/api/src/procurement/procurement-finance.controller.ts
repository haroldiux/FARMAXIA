import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { RequirePermissions } from "../auth/auth.decorators.js";
import type { AuthenticatedRequest } from "../auth/authentication.guard.js";
import { RequireFeature } from "../saas/subscription.guard.js";
import { PayablesService, type RegisterPaymentInput } from "./payables.service.js";
import { ProcurementService, type CancelPurchaseOrderInput } from "./procurement.service.js";
import { ReorderService } from "./reorder.service.js";

function scopeFrom(request: AuthenticatedRequest) {
  if (!request.auth) {
    throw new UnauthorizedException();
  }
  return request.auth;
}

/** Módulo 4: cancelación de órdenes, cuentas por pagar, pagos, costos y reposición. */
@RequireFeature("procurement")
@Controller("api/v1/procurement")
@RequirePermissions("inventory.manage")
export class ProcurementFinanceController {
  constructor(
    @Inject(ProcurementService) private readonly procurement: ProcurementService,
    @Inject(PayablesService) private readonly payables: PayablesService,
    @Inject(ReorderService) private readonly reorder: ReorderService
  ) {}

  @Post("purchase-orders/:orderId/cancel")
  cancelPurchaseOrder(@Req() request: AuthenticatedRequest, @Param("orderId") orderId: string, @Body() input: CancelPurchaseOrderInput) {
    return this.procurement.cancelPurchaseOrder(scopeFrom(request), orderId, input ?? { reason: "" });
  }

  @Get("costs")
  listCosts(@Req() request: AuthenticatedRequest) {
    return this.procurement.listCosts(scopeFrom(request));
  }

  @Get("reorder-suggestions")
  reorderSuggestions(@Req() request: AuthenticatedRequest, @Query("coverageDays") coverageDays?: string) {
    return this.reorder.suggestions(scopeFrom(request), coverageDays === undefined ? undefined : Number(coverageDays));
  }

  @Get("payables")
  listPayables(@Req() request: AuthenticatedRequest) {
    return this.payables.list(scopeFrom(request));
  }

  @Get("payables/:payableId/payments")
  listPayments(@Req() request: AuthenticatedRequest, @Param("payableId") payableId: string) {
    return this.payables.listPayments(scopeFrom(request), payableId);
  }

  @Post("payables/:payableId/payments")
  @RequirePermissions("inventory.manage", "payables.manage")
  registerPayment(@Req() request: AuthenticatedRequest, @Param("payableId") payableId: string, @Body() input: RegisterPaymentInput) {
    return this.payables.registerPayment(scopeFrom(request), payableId, input);
  }

  @Patch("payables/:payableId/schedule")
  @RequirePermissions("inventory.manage", "payables.manage")
  schedule(@Req() request: AuthenticatedRequest, @Param("payableId") payableId: string, @Body() input: { scheduledOn: string | null }) {
    return this.payables.schedule(scopeFrom(request), payableId, input?.scheduledOn ?? null);
  }
}
