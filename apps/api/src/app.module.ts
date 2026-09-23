import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.js";
import { CatalogModule } from "./catalog/catalog.module.js";
import { CashModule } from "./cash/cash.module.js";
import { HealthController } from "./health/health.controller.js";
import { InventoryModule } from "./inventory/inventory.module.js";
import { ProcurementModule } from "./procurement/procurement.module.js";
import { SalesModule } from "./sales/sales.module.js";

@Module({
  imports: [AuthModule, CashModule, CatalogModule, InventoryModule, ProcurementModule, SalesModule],
  controllers: [HealthController]
})
export class AppModule {}
