import {
  Body,
  Controller,
  Param,
  Post,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import { RequirePermissions } from "../auth/auth.decorators.js";
import type { AuthenticatedRequest } from "../auth/authentication.guard.js";
import {
  InventoryService,
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
