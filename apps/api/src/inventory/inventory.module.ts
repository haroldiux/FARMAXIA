import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { PlatformDatabase } from "../saas/platform-database.js";
import { InventoryAlertScheduler, InventoryAlertsService } from "./inventory-alerts.service.js";
import { InventoryCountsService } from "./inventory-counts.service.js";
import { InventoryOperationsController } from "./inventory-operations.controller.js";
import { InventoryRecordsService } from "./inventory-records.service.js";
import { InventoryController } from "./inventory.controller.js";
import { InventoryService } from "./inventory.service.js";
import { WarehousesService } from "./warehouses.service.js";

@Module({
  imports: [DatabaseModule],
  controllers: [InventoryController, InventoryOperationsController],
  providers: [
    { provide: PlatformDatabase, useFactory: () => new PlatformDatabase() },
    InventoryAlertScheduler,
    InventoryAlertsService,
    InventoryCountsService,
    InventoryRecordsService,
    InventoryService,
    WarehousesService
  ]
})
export class InventoryModule {}
