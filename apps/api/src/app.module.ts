import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.js";
import { CatalogModule } from "./catalog/catalog.module.js";
import { HealthController } from "./health/health.controller.js";
import { InventoryModule } from "./inventory/inventory.module.js";
import { ProcurementModule } from "./procurement/procurement.module.js";

@Module({
  imports: [AuthModule, CatalogModule, InventoryModule, ProcurementModule],
  controllers: [HealthController]
})
export class AppModule {}
