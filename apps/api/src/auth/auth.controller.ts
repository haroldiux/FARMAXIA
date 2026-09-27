import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Public } from "./auth.decorators.js";
import { AuthService } from "./auth.service.js";
import type { AuthContext, LoginInput, SessionMeta, SessionTokens } from "./auth.types.js";
import type { AuthenticatedRequest } from "./authentication.guard.js";
import { RateLimiter } from "./rate-limiter.js";
import { refreshCookie, refreshCookiePath, setRefreshCookie } from "./refresh-cookie.js";

// 10 intentos por IP y correo cada 15 minutos: frena la adivinación de contraseñas.
const loginLimiter = new RateLimiter(10, 15 * 60 * 1000, "TOO_MANY_LOGIN_ATTEMPTS", "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.");

function metaFrom(request: FastifyRequest): SessionMeta {
  const userAgent = request.headers["user-agent"];
  return { ipAddress: request.ip, userAgent: typeof userAgent === "string" ? userAgent : undefined };
}

function contextFrom(request: AuthenticatedRequest): AuthContext {
  if (!request.auth) {
    throw new UnauthorizedException();
  }
  return request.auth;
}

@Controller("api/v1/auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  /**
   * 201 con sesión; 200 si falta elegir sucursal (`requires: "BRANCH"`) o confirmar el
   * código 2FA (`requires: "TOTP"`).
   */
  @Public()
  @Post("login")
  async login(
    @Req() request: FastifyRequest,
    @Body() input: LoginInput,
    @Res({ passthrough: true }) response: FastifyReply
  ) {
    const limiterKey = `${request.ip}:${typeof input?.email === "string" ? input.email.trim().toLowerCase() : ""}`;
    loginLimiter.check(limiterKey);
    const outcome = await this.authService.login(input, metaFrom(request));
    loginLimiter.reset(limiterKey);
    if (outcome.kind === "select_branch") {
      response.status(200);
      return { requires: "BRANCH", options: outcome.options };
    }
    if (outcome.kind === "totp") {
      response.status(200);
      return { requires: "TOTP", challengeToken: outcome.challengeToken };
    }
    return this.issue(response, outcome.tokens);
  }

  @Public()
  @Post("login/totp")
  async loginTotp(
    @Req() request: FastifyRequest,
    @Body() input: { challengeToken?: unknown; code?: unknown },
    @Res({ passthrough: true }) response: FastifyReply
  ) {
    loginLimiter.check(`${request.ip}:totp`);
    const tokens = await this.authService.completeTotpLogin(input?.challengeToken, input?.code, metaFrom(request));
    return this.issue(response, tokens);
  }

  @Public()
  @Post("refresh")
  async refresh(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: FastifyReply
  ): Promise<{ accessToken: string; expiresInSeconds: number }> {
    const tokens = await this.authService.refresh(request.cookies?.[refreshCookie], metaFrom(request));
    return this.issue(response, tokens);
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
    const context = contextFrom(request);
    return {
      ...context,
      permissions: await this.authService.permissionsFor(context)
    };
  }

  @Get("account")
  account(@Req() request: AuthenticatedRequest) {
    return this.authService.account(contextFrom(request));
  }

  @Post("switch-branch")
  async switchBranch(
    @Req() request: AuthenticatedRequest,
    @Body() input: { branchId?: unknown },
    @Res({ passthrough: true }) response: FastifyReply
  ) {
    const tokens = await this.authService.switchBranch(contextFrom(request), input?.branchId, request.cookies?.[refreshCookie], metaFrom(request));
    return this.issue(response, tokens);
  }

  @Get("sessions")
  sessions(@Req() request: AuthenticatedRequest) {
    return this.authService.listSessions(contextFrom(request), request.cookies?.[refreshCookie]);
  }

  @HttpCode(204)
  @Post("sessions/:sessionId/revoke")
  async revokeSession(@Req() request: AuthenticatedRequest, @Param("sessionId") sessionId: string): Promise<void> {
    await this.authService.revokeSession(contextFrom(request), sessionId);
  }

  @Post("sessions/revoke-others")
  async revokeOthers(@Req() request: AuthenticatedRequest) {
    return { revoked: await this.authService.revokeOtherSessions(contextFrom(request), request.cookies?.[refreshCookie]) };
  }

  @HttpCode(204)
  @Post("password")
  async changePassword(
    @Req() request: AuthenticatedRequest,
    @Body() input: { currentPassword?: unknown; newPassword?: unknown }
  ): Promise<void> {
    await this.authService.changePassword(contextFrom(request), input?.currentPassword, input?.newPassword, request.cookies?.[refreshCookie]);
  }

  @Post("2fa/setup")
  setupTwoFactor(@Req() request: AuthenticatedRequest) {
    return this.authService.setupTwoFactor(contextFrom(request));
  }

  @HttpCode(204)
  @Post("2fa/enable")
  async enableTwoFactor(@Req() request: AuthenticatedRequest, @Body() input: { code?: unknown }): Promise<void> {
    await this.authService.enableTwoFactor(contextFrom(request), input?.code);
  }

  @HttpCode(204)
  @Post("2fa/disable")
  async disableTwoFactor(@Req() request: AuthenticatedRequest, @Body() input: { password?: unknown }): Promise<void> {
    await this.authService.disableTwoFactor(contextFrom(request), input?.password);
  }

  private issue(response: FastifyReply, tokens: SessionTokens): { accessToken: string; expiresInSeconds: number } {
    setRefreshCookie(response, tokens.refreshToken);
    return { accessToken: tokens.accessToken, expiresInSeconds: tokens.expiresInSeconds };
  }
}
