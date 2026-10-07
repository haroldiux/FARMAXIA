import { Module } from "@nestjs/common";
import { AuthDatabase } from "../auth/auth-database.js";
import { DatabaseModule } from "../database/database.module.js";
import { PlatformDatabase } from "../saas/platform-database.js";
import { FeatureService } from "../subscriptions/feature.service.js";
import { ApiKeyAuthenticator, ApiKeyGuard } from "./api-key.guard.js";
import { ApiKeysService } from "./api-keys.service.js";
import { ApiKeysController, PublicApiController, WebhooksController } from "./integrations.controllers.js";
import { PublicApiService } from "./public-api.service.js";
import { WebhookDispatcherScheduler, WebhookDispatcherService } from "./webhook-dispatcher.service.js";
import { WebhooksService } from "./webhooks.service.js";

/** F19 Module 12: API keys, the public read-only API and signed outgoing webhooks. */
@Module({
  imports: [DatabaseModule],
  controllers: [ApiKeysController, PublicApiController, WebhooksController],
  providers: [
    AuthDatabase,
    FeatureService,
    { provide: PlatformDatabase, useFactory: () => new PlatformDatabase() },
    ApiKeysService,
    ApiKeyAuthenticator,
    ApiKeyGuard,
    PublicApiService,
    WebhooksService,
    WebhookDispatcherService,
    WebhookDispatcherScheduler
  ],
  exports: [ApiKeysService]
})
export class IntegrationsModule {}
