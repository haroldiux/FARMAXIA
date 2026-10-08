import { Body, Controller, Get, Inject, Param, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { RequirePermissions } from "../auth/auth.decorators.js";
import type { AuthenticatedRequest } from "../auth/authentication.guard.js";
import { RequireFeature } from "../saas/subscription.guard.js";
import {
  TransfersService,
  type ApproveTransferInput,
  type DispatchTransferInput,
  type ReceiveTransferInput,
  type RejectTransferInput,
  type RequestTransferInput,
  type TransferDetail,
  type TransferListResult,
  type TransferStockLookupResult,
  type TransferWarehouseListResult
} from "./transfers.service.js";

function scopeFrom(request: AuthenticatedRequest) {
  if (!request.auth) {
    throw new UnauthorizedException();
  }
  return request.auth;
}

@RequireFeature("transfers")
@Controller("api/v1/transfers")
@RequirePermissions("transfers.manage")
export class TransfersController {
  constructor(@Inject(TransfersService) private readonly transfers: TransfersService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest): Promise<TransferListResult> {
    return this.transfers.list(scopeFrom(request));
  }

  // Both "lookup/*" routes are registered before ":transferId" so Nest's route matching doesn't
  // swallow "lookup" as an id.
  @Get("lookup/warehouses")
  lookupWarehouses(@Req() request: AuthenticatedRequest): Promise<TransferWarehouseListResult> {
    return this.transfers.listWarehouseOptions(scopeFrom(request));
  }

  @Get("lookup/stock")
  lookupStock(@Req() request: AuthenticatedRequest, @Query("warehouseId") warehouseId: string): Promise<TransferStockLookupResult> {
    return this.transfers.lookupStock(scopeFrom(request), warehouseId);
  }

  @Get(":transferId")
  detail(@Req() request: AuthenticatedRequest, @Param("transferId") transferId: string): Promise<TransferDetail> {
    return this.transfers.detail(scopeFrom(request), transferId);
  }

  @Post()
  requestTransfer(@Req() request: AuthenticatedRequest, @Body() input: RequestTransferInput): Promise<TransferDetail> {
    return this.transfers.requestTransfer(scopeFrom(request), input);
  }

  @Post(":transferId/approve")
  @RequirePermissions("transfers.approve")
  approve(
    @Req() request: AuthenticatedRequest,
    @Param("transferId") transferId: string,
    @Body() input: ApproveTransferInput
  ): Promise<TransferDetail> {
    return this.transfers.approveTransfer(scopeFrom(request), transferId, input);
  }

  @Post(":transferId/reject")
  @RequirePermissions("transfers.approve")
  reject(
    @Req() request: AuthenticatedRequest,
    @Param("transferId") transferId: string,
    @Body() input: RejectTransferInput
  ): Promise<TransferDetail> {
    return this.transfers.rejectTransfer(scopeFrom(request), transferId, input);
  }

  @Post(":transferId/dispatch")
  dispatch(
    @Req() request: AuthenticatedRequest,
    @Param("transferId") transferId: string,
    @Body() input: DispatchTransferInput
  ): Promise<TransferDetail> {
    return this.transfers.dispatchTransfer(scopeFrom(request), transferId, input);
  }

  @Post(":transferId/receive")
  receive(
    @Req() request: AuthenticatedRequest,
    @Param("transferId") transferId: string,
    @Body() input: ReceiveTransferInput
  ): Promise<TransferDetail> {
    return this.transfers.receiveTransfer(scopeFrom(request), transferId, input);
  }
}
