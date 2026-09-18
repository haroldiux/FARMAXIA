import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.js";
import { CatalogModule } from "./catalog/catalog.module.js";
import { HealthController } from "./health/health.controller.js";

@Module({
  imports: [AuthModule, CatalogModule],
  controllers: [HealthController]
})
export class AppModule {}
