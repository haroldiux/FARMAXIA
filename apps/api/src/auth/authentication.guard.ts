import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { IS_PUBLIC_KEY } from "./auth.decorators.js";
import { AccessTokenService } from "./access-token.service.js";
import type { AuthContext } from "./auth.types.js";

export interface AuthenticatedRequest extends FastifyRequest {
  auth?: AuthContext;
}

@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AccessTokenService) private readonly accessTokens: AccessTokenService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException();
    }

    request.auth = await this.accessTokens.verify(token);
    return true;
  }
}

function bearerToken(authorization: string | undefined): string | undefined {
  const [scheme, token] = authorization?.split(" ") ?? [];
  return scheme === "Bearer" && token ? token : undefined;
}
