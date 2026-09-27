import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { jwtVerify, SignJWT } from "jose";

const issuer = "farmaxia-api";
// Audiencia distinta a la de las farmacias: un token de farmacia nunca abre el panel
// de plataforma y un token de operador nunca pasa el AuthenticationGuard de tenant.
const audience = "farmaxia-platform";
export const platformTokenLifetimeSeconds = 8 * 60 * 60;

export interface PlatformOperator {
  operatorId: string;
}

export interface PlatformRequest extends FastifyRequest {
  platformOperator?: PlatformOperator;
}

@Injectable()
export class PlatformTokenService {
  async issue(operatorId: string): Promise<string> {
    return new SignJWT({ scope: "platform" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(operatorId)
      .setIssuedAt()
      .setExpirationTime(`${platformTokenLifetimeSeconds}s`)
      .sign(secret());
  }

  async verify(token: string): Promise<PlatformOperator> {
    try {
      const { payload } = await jwtVerify(token, secret(), { issuer, audience });
      if (typeof payload.sub !== "string" || payload.scope !== "platform") {
        throw new UnauthorizedException();
      }
      return { operatorId: payload.sub };
    } catch {
      throw new UnauthorizedException();
    }
  }
}

@Injectable()
export class PlatformAuthGuard implements CanActivate {
  constructor(@Inject(PlatformTokenService) private readonly tokens: PlatformTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PlatformRequest>();
    const [scheme, token] = request.headers.authorization?.split(" ") ?? [];
    if (scheme !== "Bearer" || !token) {
      throw new UnauthorizedException();
    }
    request.platformOperator = await this.tokens.verify(token);
    return true;
  }
}

function secret(): Uint8Array {
  const value = process.env.AUTH_JWT_SECRET;
  if (!value || value.length < 32) {
    throw new Error("AUTH_JWT_SECRET must contain at least 32 characters.");
  }
  return new TextEncoder().encode(value);
}
