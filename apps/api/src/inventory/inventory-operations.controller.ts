import { Body, Controller, Get, Inject, Param, Patch, Post, Put, Query, Req, UnauthorizedException } from "@nestjs/common";
import { RequirePermissions } from "../auth/auth.decorators.js";
import type { AuthenticatedRequest } from "../auth/authentication.guard.js";
import { RequireFeature } from "../saas/subscription.guard.js";
import { InventoryAlertsService } from "./inventory-alerts.service.js";
import { InventoryCountsService, type CreateCountInput, type RecordCountLinesInput } from "./inventory-counts.service.js";
import { InventoryRecordsService } from "./inventory-records.service.js";
import { WarehousesService, type CreateWarehouseInput, type UpdateWarehouseInput } from "./warehouses.service.js";

function scopeFrom(request: AuthenticatedRequest) {
  if (!request.auth) {
    throw new UnauthorizedException();
  }
  return request.auth;
}

/** Módulo 3: almacenes, inventario físico, actas de baja, reservas y alertas. */
@RequireFeature("inventory")
@Controller("api/v1/inventory")
@RequirePermissions("inventory.manage")
export class InventoryOperationsController {
  constructor(
    @Inject(WarehousesService) private readonly warehouses: WarehousesService,
    @Inject(InventoryCountsService) private readonly counts: InventoryCountsService,
    @Inject(InventoryRecordsService) private readonly records: InventoryRecordsService,
    @Inject(InventoryAlertsService) private readonly alerts: InventoryAlertsService
  ) {}

  @Get("warehouses/details")
  listWarehouseDetails(@Req() request: AuthenticatedRequest, @Query("includeInactive") includeInactive?: string) {
    return this.warehouses.list(scopeFrom(request), includeInactive === "true");
  }

  @Post("warehouses")
  createWarehouse(@Req() request: AuthenticatedRequest, @Body() input: CreateWarehouseInput) {
    return this.warehouses.create(scopeFrom(request), input ?? {});
  }

  @Patch("warehouses/:warehouseId")
  updateWarehouse(
    @Req() request: AuthenticatedRequest,
    @Param("warehouseId") warehouseId: string,
    @Body() input: UpdateWarehouseInput
  ) {
    return this.warehouses.update(scopeFrom(request), warehouseId, input ?? {});
  }

  @Get("counts")
  listCounts(@Req() request: AuthenticatedRequest, @Query("status") status?: string) {
    return this.counts.list(scopeFrom(request), status);
  }

  @Post("counts")
  createCount(@Req() request: AuthenticatedRequest, @Body() input: CreateCountInput) {
    return this.counts.create(scopeFrom(request), input ?? { warehouseId: "" });
  }

  @Get("counts/:countId")
  getCount(@Req() request: AuthenticatedRequest, @Param("countId") countId: string) {
    return this.counts.get(scopeFrom(request), countId);
  }

  @Put("counts/:countId/lines")
  recordCountLines(
    @Req() request: AuthenticatedRequest,
    @Param("countId") countId: string,
    @Body() input: RecordCountLinesInput
  ) {
    return this.counts.recordLines(scopeFrom(request), countId, input);
  }

  @Post("counts/:countId/submit")
  submitCount(@Req() request: AuthenticatedRequest, @Param("countId") countId: string) {
    return this.counts.submit(scopeFrom(request), countId);
  }

  @Post("counts/:countId/approve")
  @RequirePermissions("inventory.manage", "inventory.count.approve")
  approveCount(@Req() request: AuthenticatedRequest, @Param("countId") countId: string) {
    return this.counts.approve(scopeFrom(request), countId);
  }

  @Post("counts/:countId/cancel")
  cancelCount(@Req() request: AuthenticatedRequest, @Param("countId") countId: string) {
    return this.counts.cancel(scopeFrom(request), countId);
  }

  @Get("waste-acts")
  listWasteActs(@Req() request: AuthenticatedRequest) {
    return this.records.listWasteActs(scopeFrom(request));
  }

  @Get("waste-acts/:eventId")
  getWasteAct(@Req() request: AuthenticatedRequest, @Param("eventId") eventId: string) {
    return this.records.getWasteAct(scopeFrom(request), eventId);
  }

  @Get("reservations")
  listReservations(@Req() request: AuthenticatedRequest, @Query("status") status?: string) {
    return this.records.listReservations(scopeFrom(request), status);
  }

  @Get("alerts")
  listAlerts(@Req() request: AuthenticatedRequest, @Query("includeAcknowledged") includeAcknowledged?: string) {
    return this.alerts.list(scopeFrom(request), includeAcknowledged !== "false");
  }

  @Post("alerts/:alertId/acknowledge")
  acknowledgeAlert(@Req() request: AuthenticatedRequest, @Param("alertId") alertId: string) {
    return this.alerts.acknowledge(scopeFrom(request), alertId);
  }
}
