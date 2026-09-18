import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import { RequirePermissions } from "../auth/auth.decorators.js";
import type { AuthenticatedRequest } from "../auth/authentication.guard.js";
import {
  InventoryService,
  type ExpiryAlertsInput,
  type QuarantineInput,
  type ReconcileInput,
  type ReleaseQuarantineInput,
  type WasteInput,
  type ConsumeReservationInput,
  type ReserveFefoInput,
  type ReservationLifecycleInput
} from "./inventory.service.js";

function scopeFrom(request: AuthenticatedRequest) {
  if (!request.auth) {
    throw new UnauthorizedException();
  }
  return request.auth;
}

@Controller("api/v1/inventory")
@RequirePermissions("inventory.manage")
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get("expiry-alerts")
  listExpiryAlerts(
    @Req() request: AuthenticatedRequest,
    @Query() input: ExpiryAlertsInput
  ) {
    return this.inventory.listExpiryAlerts(scopeFrom(request), {
      warehouseId: input.warehouseId,
      horizonDays: Number(input.horizonDays)
    });
  }

  @Post("batches/:batchId/quarantine")
  quarantineBatch(
    @Req() request: AuthenticatedRequest,
    @Param("batchId") batchId: string,
    @Body() input: Omit<QuarantineInput, "batchId">
  ) {
    return this.inventory.quarantineBatch(scopeFrom(request), { ...input, batchId });
  }

  @Post("batches/:batchId/release-quarantine")
  releaseQuarantine(
    @Req() request: AuthenticatedRequest,
    @Param("batchId") batchId: string,
    @Body() input: Omit<ReleaseQuarantineInput, "batchId">
  ) {
    return this.inventory.releaseQuarantine(scopeFrom(request), { ...input, batchId });
  }

  @Post("waste")
  recordWaste(@Req() request: AuthenticatedRequest, @Body() input: WasteInput) {
    return this.inventory.recordWaste(scopeFrom(request), input);
  }

  @Post("reconciliations")
  reconcile(@Req() request: AuthenticatedRequest, @Body() input: ReconcileInput) {
    return this.inventory.reconcile(scopeFrom(request), input);
  }

  @Post("reservations/fefo")
  reserveFefo(
    @Req() request: AuthenticatedRequest,
    @Body() input: ReserveFefoInput
  ) {
    return this.inventory.reserveFefo(scopeFrom(request), input);
  }

  @Post("reservations/:reservationId/release")
  releaseReservation(
    @Req() request: AuthenticatedRequest,
    @Param("reservationId") reservationId: string,
    @Body() input: Omit<ReservationLifecycleInput, "reservationId">
  ) {
    return this.inventory.releaseReservation(scopeFrom(request), { ...input, reservationId });
  }

  @Post("reservations/:reservationId/consume")
  consumeReservation(
    @Req() request: AuthenticatedRequest,
    @Param("reservationId") reservationId: string,
    @Body() input: Omit<ConsumeReservationInput, "reservationId">
  ) {
    return this.inventory.consumeReservation(scopeFrom(request), { ...input, reservationId });
  }

  @Post("reservations/expire")
  expireReservations(@Req() request: AuthenticatedRequest) {
    return this.inventory.expireReservations(scopeFrom(request));
  }
}
