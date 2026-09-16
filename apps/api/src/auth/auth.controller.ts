import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { Public } from "./auth.decorators.js";
import { AuthService } from "./auth.service.js";
import type { LoginInput } from "./auth.types.js";
import type { AuthenticatedRequest } from "./authentication.guard.js";

const refreshCookie = "farmaxia_refresh";
const refreshCookiePath = "/api/v1/auth";
const refreshMaxAge = 30 * 24 * 60 * 60;

@Controller("api/v1/auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Public()
  @Post("login")
  async login(
    @Body() input: LoginInput,
    @Res({ passthrough: true }) response: FastifyReply
  ): Promise<{ accessToken: string; expiresInSeconds: number }> {
    const tokens = await this.authService.login(input);
    this.setRefreshCookie(response, tokens.refreshToken);
    return {
      accessToken: tokens.accessToken,
      expiresInSeconds: tokens.expiresInSeconds
    };
  }

  @Public()
  @Post("refresh")
  async refresh(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: FastifyReply
  ): Promise<{ accessToken: string; expiresInSeconds: number }> {
    const tokens = await this.authService.refresh(request.cookies?.[refreshCookie]);
    this.setRefreshCookie(response, tokens.refreshToken);
    return {
      accessToken: tokens.accessToken,
      expiresInSeconds: tokens.expiresInSeconds
    };
  }

  @Public()
  @HttpCode(204)
  @Post("logout")
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: FastifyReply
  ): Promise<void> {
    await this.authService.logout(request.cookies?.[refreshCookie]);
    response.clearCookie(refreshCookie, { path: refreshCookiePath });
  }

  @Get("me")
  async me(@Req() request: AuthenticatedRequest): Promise<{
    userId: string;
    tenantId: string;
    branchId: string;
    permissions: string[];
  }> {
    if (!request.auth) {
      throw new Error("Authenticated request is required.");
    }

    return {
      ...request.auth,
      permissions: await this.authService.permissionsFor(request.auth)
    };
  }

  private setRefreshCookie(response: FastifyReply, token: string): void {
    response.setCookie(refreshCookie, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: refreshCookiePath,
      maxAge: refreshMaxAge
    });
  }
}
