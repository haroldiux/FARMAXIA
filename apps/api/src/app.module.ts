import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.js";
import { CatalogModule } from "./catalog/catalog.module.js";
import { CashModule } from "./cash/cash.module.js";
import { FiscalModule } from "./fiscal/fiscal.module.js";
import { HealthController } from "./health/health.controller.js";
import { IdentityModule } from "./identity/identity.module.js";
import { InventoryModule } from "./inventory/inventory.module.js";
import { ProcurementModule } from "./procurement/procurement.module.js";
import { SaasModule } from "./saas/saas.module.js";
import { SalesModule } from "./sales/sales.module.js";
import { ControlledModule } from "./controlled/controlled.module.js";
import { StaffModule } from "./staff/staff.module.js";
import { TransfersModule } from "./transfers/transfers.module.js";

@Module({
  imports: [
    AuthModule,
    CashModule,
    CatalogModule,
    FiscalModule,
    IdentityModule,
    InventoryModule,
    ProcurementModule,
    SaasModule,
    SalesModule,
    TransfersModule,
    ControlledModule,
    StaffModule
  ],
  controllers: [HealthController]
})
export class AppModule {}
