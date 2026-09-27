import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.js";
import { CatalogModule } from "./catalog/catalog.module.js";
import { CashModule } from "./cash/cash.module.js";
import { HealthController } from "./health/health.controller.js";
import { IdentityModule } from "./identity/identity.module.js";
import { InventoryModule } from "./inventory/inventory.module.js";
import { ProcurementModule } from "./procurement/procurement.module.js";
import { SaasModule } from "./saas/saas.module.js";
import { SalesModule } from "./sales/sales.module.js";

@Module({
  imports: [AuthModule, CashModule, CatalogModule, IdentityModule, InventoryModule, ProcurementModule, SaasModule, SalesModule],
  controllers: [HealthController]
})
export class AppModule {}
