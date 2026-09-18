import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.js";
import { CatalogModule } from "./catalog/catalog.module.js";
import { HealthController } from "./health/health.controller.js";
import { InventoryModule } from "./inventory/inventory.module.js";

@Module({
  imports: [AuthModule, CatalogModule, InventoryModule],
  controllers: [HealthController]
})
export class AppModule {}
