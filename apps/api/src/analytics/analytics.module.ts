import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { PlatformDatabase } from "../saas/platform-database.js";
import { AnalyticsController } from "./analytics.controller.js";
import { AnalyticsService } from "./analytics.service.js";
import { StockAlertScheduler, StockAlertsService } from "./stock-alerts.service.js";

@Module({
  imports: [DatabaseModule],
  controllers: [AnalyticsController],
  providers: [{ provide: PlatformDatabase, useFactory: () => new PlatformDatabase() }, AnalyticsService, StockAlertsService, StockAlertScheduler],
  exports: [AnalyticsService, StockAlertsService]
})
export class AnalyticsModule {}
