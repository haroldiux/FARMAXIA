import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Module,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import { RequirePermissions } from "../auth/auth.decorators.js";
import { AuthModule } from "../auth/auth.module.js";
import type { AuthenticatedRequest } from "../auth/authentication.guard.js";
import { IdentityDatabase } from "./identity-database.js";
import { IdentityService, type CreateUserInput, type RoleInput, type UpdateUserInput } from "./identity.service.js";

function scopeFrom(request: AuthenticatedRequest) {
  if (!request.auth) {
    throw new UnauthorizedException();
  }
  return request.auth;
}

@RequirePermissions("users.manage")
@Controller("api/v1")
export class IdentityController {
  constructor(@Inject(IdentityService) private readonly identity: IdentityService) {}

  @Get("users")
  users(@Req() request: AuthenticatedRequest) {
    return this.identity.listUsers(scopeFrom(request));
  }

  @Post("users")
  createUser(@Req() request: AuthenticatedRequest, @Body() input: CreateUserInput) {
    return this.identity.createUser(scopeFrom(request), input);
  }

  @HttpCode(204)
  @Patch("users/:userId")
  async updateUser(@Req() request: AuthenticatedRequest, @Param("userId") userId: string, @Body() input: UpdateUserInput): Promise<void> {
    await this.identity.updateUser(scopeFrom(request), userId, input);
  }

  @HttpCode(204)
  @Post("users/:userId/password")
  async resetPassword(@Req() request: AuthenticatedRequest, @Param("userId") userId: string, @Body() input: { newPassword?: unknown }): Promise<void> {
    await this.identity.resetPassword(scopeFrom(request), userId, input?.newPassword);
  }

  @HttpCode(204)
  @Post("users/:userId/2fa/reset")
  async resetTwoFactor(@Req() request: AuthenticatedRequest, @Param("userId") userId: string): Promise<void> {
    await this.identity.resetTwoFactor(scopeFrom(request), userId);
  }

  @Get("branches")
  branches(@Req() request: AuthenticatedRequest) {
    return this.identity.listBranches(scopeFrom(request));
  }

  @Get("permissions")
  permissions(@Req() request: AuthenticatedRequest) {
    return this.identity.listPermissions(scopeFrom(request));
  }

  @Get("roles")
  roles(@Req() request: AuthenticatedRequest) {
    return this.identity.listRoles(scopeFrom(request));
  }

  @Post("roles")
  createRole(@Req() request: AuthenticatedRequest, @Body() input: RoleInput) {
    return this.identity.createRole(scopeFrom(request), input);
  }

  @HttpCode(204)
  @Patch("roles/:roleId")
  async updateRole(@Req() request: AuthenticatedRequest, @Param("roleId") roleId: string, @Body() input: RoleInput): Promise<void> {
    await this.identity.updateRole(scopeFrom(request), roleId, input);
  }

  @HttpCode(204)
  @Delete("roles/:roleId")
  async deleteRole(@Req() request: AuthenticatedRequest, @Param("roleId") roleId: string): Promise<void> {
    await this.identity.deleteRole(scopeFrom(request), roleId);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [IdentityController],
  providers: [{ provide: IdentityDatabase, useFactory: () => new IdentityDatabase() }, IdentityService]
})
export class IdentityModule {}
