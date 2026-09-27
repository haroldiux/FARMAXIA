import { Injectable, UnauthorizedException } from "@nestjs/common";
import { jwtVerify, SignJWT } from "jose";
import type { AuthContext } from "./auth.types.js";

const issuer = "farmaxia-api";
const audience = "farmaxia-web";
export const accessTokenLifetimeSeconds = 15 * 60;
const challengeAudience = "farmaxia-2fa";
const challengeLifetimeSeconds = 5 * 60;

@Injectable()
export class AccessTokenService {
  async issue(context: AuthContext): Promise<string> {
    return new SignJWT({
      tenantId: context.tenantId,
      branchId: context.branchId
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(context.userId)
      .setIssuedAt()
      .setExpirationTime(`${accessTokenLifetimeSeconds}s`)
      .sign(this.secret());
  }

  async verify(token: string): Promise<AuthContext> {
    try {
      const { payload } = await jwtVerify(token, this.secret(), {
        issuer,
        audience
      });
      if (
        typeof payload.sub !== "string" ||
        typeof payload.tenantId !== "string" ||
        typeof payload.branchId !== "string"
      ) {
        throw new UnauthorizedException();
      }

      return {
        userId: payload.sub,
        tenantId: payload.tenantId,
        branchId: payload.branchId
      };
    } catch {
      throw new UnauthorizedException();
    }
  }

  /**
   * Token del paso 2FA: la contraseña ya se validó y falta el código. Otra audiencia,
   * así que nunca sirve como sesión.
   */
  async issueChallenge(context: AuthContext, email: string): Promise<string> {
    return new SignJWT({ tenantId: context.tenantId, branchId: context.branchId, email })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(issuer)
      .setAudience(challengeAudience)
      .setSubject(context.userId)
      .setIssuedAt()
      .setExpirationTime(`${challengeLifetimeSeconds}s`)
      .sign(this.secret());
  }

  async verifyChallenge(token: string): Promise<AuthContext & { email: string }> {
    try {
      const { payload } = await jwtVerify(token, this.secret(), { issuer, audience: challengeAudience });
      if (
        typeof payload.sub !== "string" ||
        typeof payload.tenantId !== "string" ||
        typeof payload.branchId !== "string" ||
        typeof payload.email !== "string"
      ) {
        throw new UnauthorizedException();
      }
      return { userId: payload.sub, tenantId: payload.tenantId, branchId: payload.branchId, email: payload.email };
    } catch {
      throw new UnauthorizedException();
    }
  }

  private secret(): Uint8Array {
    const secret = process.env.AUTH_JWT_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error("AUTH_JWT_SECRET must contain at least 32 characters.");
    }
    return new TextEncoder().encode(secret);
  }
}
