import {
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown
} from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { AuditLogService } from "./audit-log.service.js";
import { BillingService } from "./billing.service.js";
import { OnboardingService } from "./onboarding.service.js";
import { PlatformAuthGuard, PlatformTokenService } from "./platform-auth.js";
import { PlatformDatabase } from "./platform-database.js";
import { PlatformService } from "./platform.service.js";
import { OnboardingController, PlatformController, TenantSubscriptionController } from "./saas.controllers.js";
import { TenantBillingService } from "./tenant-billing.service.js";

/**
 * Corre el ciclo de cobro cada BILLING_CYCLE_INTERVAL_MINUTES (60 por defecto; 0 lo
 * desactiva). El ciclo toma un advisory lock, así que varias instancias no se pisan.
 */
@Injectable()
export class BillingScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("BillingScheduler");
  private timer?: NodeJS.Timeout;

  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  onApplicationBootstrap(): void {
    const minutes = Number(process.env.BILLING_CYCLE_INTERVAL_MINUTES ?? 60);
    if (process.env.NODE_ENV === "test" || !Number.isFinite(minutes) || minutes <= 0) {
      return;
    }
    const run = () => {
      this.billing.runCycle().then(
        (result) => this.logger.log(`Billing cycle: ${JSON.stringify(result)}`),
        (error: unknown) => this.logger.error(`Billing cycle failed: ${String(error)}`)
      );
    };
    setTimeout(run, 10_000).unref();
    this.timer = setInterval(run, minutes * 60_000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }
}

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [OnboardingController, TenantSubscriptionController, PlatformController],
  providers: [
    { provide: PlatformDatabase, useFactory: () => new PlatformDatabase() },
    AuditLogService,
    BillingScheduler,
    BillingService,
    OnboardingService,
    PlatformAuthGuard,
    PlatformService,
    PlatformTokenService,
    TenantBillingService
  ]
})
export class SaasModule {}
