import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AccessTokenService } from "./access-token.service.js";
import { AuthController } from "./auth.controller.js";
import { AuthDatabase } from "./auth-database.js";
import { AuthService } from "./auth.service.js";
import { AuthenticationGuard } from "./authentication.guard.js";
import { PasswordHasher } from "./password-hasher.js";
import { PermissionsGuard } from "./permissions.guard.js";

@Module({
  controllers: [AuthController],
  providers: [
    AccessTokenService,
    AuthDatabase,
    AuthService,
    PasswordHasher,
    {
      provide: APP_GUARD,
      useClass: AuthenticationGuard
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard
    }
  ],
  exports: [AuthService]
})
export class AuthModule {}
