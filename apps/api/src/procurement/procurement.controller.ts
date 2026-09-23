import { Body, Controller, Get, Post, Req, UnauthorizedException } from "@nestjs/common";
import { RequirePermissions } from "../auth/auth.decorators.js";
import type { AuthenticatedRequest } from "../auth/authentication.guard.js";
import {
  ProcurementService,
  type SupplierInvoiceInput,
  type SupplierInvoiceListResult,
  type InvoiceResult,
  type GoodsReceiptListResult,
  type PresentationListResult,
  type PurchaseOrderInput,
  type PurchaseOrderListResult,
  type ReceiveInput,
  type ReceiveResult,
  type SupplierInput,
  type SupplierListResult
} from "./procurement.service.js";

function scopeFrom(request: AuthenticatedRequest) {
  if (!request.auth) {
    throw new UnauthorizedException();
  }
  return request.auth;
}

@Controller("api/v1/procurement")
@RequirePermissions("inventory.manage")
export class ProcurementController {
  constructor(private readonly procurement: ProcurementService) {}

  @Get("suppliers")
  listSuppliers(@Req() request: AuthenticatedRequest): Promise<SupplierListResult> {
    return this.procurement.listSuppliers(scopeFrom(request));
  }

  @Post("suppliers")
  createSupplier(
    @Req() request: AuthenticatedRequest,
    @Body() input: SupplierInput
  ): Promise<{ id: string }> {
    return this.procurement.createSupplier(scopeFrom(request), input);
  }

  @Get("presentations")
  listPresentations(@Req() request: AuthenticatedRequest): Promise<PresentationListResult> {
    return this.procurement.listPresentations(scopeFrom(request));
  }

  @Get("purchase-orders")
  listPurchaseOrders(@Req() request: AuthenticatedRequest): Promise<PurchaseOrderListResult> {
    return this.procurement.listPurchaseOrders(scopeFrom(request));
  }

  @Post("purchase-orders")
  createPurchaseOrder(
    @Req() request: AuthenticatedRequest,
    @Body() input: PurchaseOrderInput
  ): Promise<{ id: string }> {
    return this.procurement.createPurchaseOrder(scopeFrom(request), input);
  }

  @Post("receipts")
  receive(
    @Req() request: AuthenticatedRequest,
    @Body() input: ReceiveInput
  ): Promise<ReceiveResult> {
    return this.procurement.receive(scopeFrom(request), input);
  }

  @Get("invoices")
  listSupplierInvoices(@Req() request: AuthenticatedRequest): Promise<SupplierInvoiceListResult> {
    return this.procurement.listSupplierInvoices(scopeFrom(request));
  }

  @Get("receipts")
  listGoodsReceipts(@Req() request: AuthenticatedRequest): Promise<GoodsReceiptListResult> {
    return this.procurement.listGoodsReceipts(scopeFrom(request));
  }

  @Post("invoices")
  createSupplierInvoice(
    @Req() request: AuthenticatedRequest,
    @Body() input: SupplierInvoiceInput
  ): Promise<InvoiceResult> {
    return this.procurement.createSupplierInvoice(scopeFrom(request), input);
  }
}
