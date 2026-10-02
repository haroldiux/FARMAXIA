import { RequireFeature } from "../saas/subscription.guard.js";
import { Body, Controller, Get, Inject, Param, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { RequireAnyPermission, RequirePermissions } from "../auth/auth.decorators.js";
import { AuthService } from "../auth/auth.service.js";
import type { AuthenticatedRequest } from "../auth/authentication.guard.js";
import type { TenantScope } from "../database/tenant-database.js";
import {
  resolveSalesAccess,
  SalesService,
  type CancelQuoteInput,
  type ConfirmSaleInput,
  type CreateQuoteInput,
  type RegisterReturnInput,
  type VoidSaleInput
} from "./sales.service.js";

function scopeFrom(request: AuthenticatedRequest): TenantScope {
  const auth = request.auth;
  if (!auth) throw new UnauthorizedException();
  return { tenantId: auth.tenantId, branchId: auth.branchId, userId: auth.userId };
}

interface SalesListParams {
  from?: string;
  to?: string;
  cashShiftId?: string;
  cashierId?: string;
  status?: string;
  limit?: string;
  offset?: string;
}

@RequireFeature("pos")
@Controller("api/v1/sales")
@RequirePermissions("sales.confirm")
export class SalesController {
  constructor(
    @Inject(SalesService) private readonly sales: SalesService,
    @Inject(AuthService) private readonly authService: AuthService
  ) {}

  /** Resumen para el panel: lo ven quienes venden o administran la caja. */
  @Get("summary")
  @RequireAnyPermission("sales.confirm", "cash.manage")
  async summary(@Req() request: AuthenticatedRequest) {
    return this.sales.summary(scopeFrom(request), await this.accessFor(request));
  }

  /** Counter search: sellable presentations by name, DCI, ingredient, laboratory or barcode, with price and stock. */
  @Get("lookup")
  lookup(
    @Req() request: AuthenticatedRequest,
    @Query("q") q?: string,
    @Query("warehouseId") warehouseId?: string,
    @Query("limit") limit?: string
  ) {
    return this.sales.lookup(scopeFrom(request), {
      q,
      warehouseId,
      limit: limit === undefined ? undefined : Number(limit)
    });
  }

  /** Lots of a presentation in FEFO order, for choosing a lot different from FEFO. */
  @Get("lookup/batches")
  @RequirePermissions("sales.fefo.override")
  batches(
    @Req() request: AuthenticatedRequest,
    @Query("presentationId") presentationId?: string,
    @Query("warehouseId") warehouseId?: string
  ) {
    return this.sales.listBatches(scopeFrom(request), { presentationId, warehouseId });
  }

  /** Create a quote (proforma): server prices, no stock reservation, no cash effect. */
  @Post("quotes")
  createQuote(@Req() request: AuthenticatedRequest, @Body() input: CreateQuoteInput) {
    return this.sales.createQuote(scopeFrom(request), input);
  }

  @Get("quotes")
  listQuotes(@Req() request: AuthenticatedRequest, @Query() params: SalesListParams) {
    return this.sales.listQuotes(scopeFrom(request), {
      status: params.status,
      from: params.from,
      to: params.to,
      limit: params.limit === undefined ? undefined : Number(params.limit),
      offset: params.offset === undefined ? undefined : Number(params.offset)
    });
  }

  @Get("quotes/:quoteId")
  quoteDetail(@Req() request: AuthenticatedRequest, @Param("quoteId") quoteId: string) {
    return this.sales.quoteDetail(scopeFrom(request), quoteId);
  }

  @Post("quotes/:quoteId/cancel")
  cancelQuote(
    @Req() request: AuthenticatedRequest,
    @Param("quoteId") quoteId: string,
    @Body() input: CancelQuoteInput
  ) {
    return this.sales.cancelQuote(scopeFrom(request), quoteId, input);
  }

  @Post("confirm")
  async confirm(@Req() request: AuthenticatedRequest, @Body() input: ConfirmSaleInput) {
    if (!request.auth) throw new UnauthorizedException();
    const granted = await this.authService.permissionsFor(request.auth);
    return this.sales.confirm(scopeFrom(request), input, { canOverrideFefo: granted.includes("sales.fefo.override") });
  }

  /** Historial paginado. Sin permisos de supervisión solo se ven las ventas propias. */
  @Get()
  @RequirePermissions("sales.read")
  async list(@Req() request: AuthenticatedRequest, @Query() params: SalesListParams) {
    const scope = scopeFrom(request);
    return this.sales.list(
      scope,
      {
        from: params.from,
        to: params.to,
        cashShiftId: params.cashShiftId,
        cashierId: params.cashierId,
        status: params.status,
        limit: params.limit === undefined ? undefined : Number(params.limit),
        offset: params.offset === undefined ? undefined : Number(params.offset)
      },
      await this.accessFor(request)
    );
  }

  /** Detalle y datos del recibo. `sales.confirm` basta para ver una venta propia (imprimir tras cobrar). */
  @Get(":saleId")
  @RequireAnyPermission("sales.read", "sales.confirm")
  async detail(@Req() request: AuthenticatedRequest, @Param("saleId") saleId: string) {
    return this.sales.detail(scopeFrom(request), saleId, await this.accessFor(request));
  }

  /** Anulación total: solo mientras el turno de caja de la venta siga abierto. */
  @Post(":saleId/void")
  @RequirePermissions("sales.void")
  async voidSale(
    @Req() request: AuthenticatedRequest,
    @Param("saleId") saleId: string,
    @Body() input: VoidSaleInput
  ) {
    return this.sales.voidSale(scopeFrom(request), saleId, input, await this.accessFor(request));
  }

  /** Devolución parcial o total de líneas vendidas, en cualquier fecha posterior. */
  @Post(":saleId/returns")
  @RequirePermissions("sales.void")
  async registerReturn(
    @Req() request: AuthenticatedRequest,
    @Param("saleId") saleId: string,
    @Body() input: RegisterReturnInput
  ) {
    return this.sales.registerReturn(scopeFrom(request), saleId, input, await this.accessFor(request));
  }

  private async accessFor(request: AuthenticatedRequest) {
    if (!request.auth) throw new UnauthorizedException();
    return resolveSalesAccess(await this.authService.permissionsFor(request.auth));
  }
}
