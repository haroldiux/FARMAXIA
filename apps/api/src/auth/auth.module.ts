import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { DatabaseModule } from "../database/database.module.js";
import { SubscriptionGuard } from "../saas/subscription.guard.js";
import { FeatureService } from "../subscriptions/feature.service.js";
import { AccessTokenService } from "./access-token.service.js";
import { AuthController } from "./auth.controller.js";
import { AuthDatabase } from "./auth-database.js";
import { AuthService } from "./auth.service.js";
import { AuthenticationGuard } from "./authentication.guard.js";
import { PasswordHasher } from "./password-hasher.js";
import { PermissionsGuard } from "./permissions.guard.js";

// Los guards globales se ejecutan en el orden declarado: identidad → permisos → plan.
@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [
    AccessTokenService,
    AuthDatabase,
    AuthService,
    FeatureService,
    PasswordHasher,
    {
      provide: APP_GUARD,
      useClass: AuthenticationGuard
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard
    },
    {
      provide: APP_GUARD,
      useClass: SubscriptionGuard
    }
  ],
  exports: [AuthService, AccessTokenService, PasswordHasher]
})
export class AuthModule {}
