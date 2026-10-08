import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException
} from "@nestjs/common";
import { AuthDatabase } from "../auth/auth-database.js";
import type { AuthenticatedRequest } from "../auth/authentication.guard.js";
import type { AuthContext } from "../auth/auth.types.js";
import { RateLimiter } from "../auth/rate-limiter.js";
import { SubscriptionInactiveException } from "../saas/subscription.guard.js";
import { FeatureService } from "../subscriptions/feature.service.js";
import { SubscriptionAccessError } from "../subscriptions/quota.service.js";
import { API_KEY_PATTERN, API_KEY_RATE_LIMIT_PER_MINUTE, hashApiKey } from "./api-keys.service.js";

export const API_KEY_HEADER = "x-api-key";
export const PUBLIC_API_FEATURE = "public_api";

function invalidKey(): UnauthorizedException {
  return new UnauthorizedException({
    statusCode: HttpStatus.UNAUTHORIZED,
    code: "INVALID_API_KEY",
    message: "La clave de API no es válida o fue revocada."
  });
}

interface KeyRow {
  id: string;
  tenantId: string;
  branchId: string;
  createdByUserId: string;
  revokedAt: Date | null;
}

/**
 * Resolves an `X-Api-Key` into the creator's branch scope (D77). Singleton, so the per-key
 * rate limit (D78, in memory, one instance) is shared by every request.
 */
@Injectable()
export class ApiKeyAuthenticator {
  private readonly logger = new Logger(ApiKeyAuthenticator.name);
  private readonly limiter = new RateLimiter(
    API_KEY_RATE_LIMIT_PER_MINUTE,
    60_000,
    "RATE_LIMITED",
    "Demasiadas solicitudes con esta clave de API. Intenta nuevamente en un minuto."
  );

  constructor(
    @Inject(AuthDatabase) private readonly authDatabase: AuthDatabase,
    @Inject(FeatureService) private readonly features: FeatureService
  ) {}

  async authenticate(rawKey: unknown): Promise<AuthContext> {
    const key = typeof rawKey === "string" ? rawKey.trim() : "";
    if (!API_KEY_PATTERN.test(key)) {
      throw invalidKey();
    }
    const keyHash = hashApiKey(key);
    this.limiter.check(keyHash);

    const scope = await this.authDatabase.withTransaction({ apiKeyHash: keyHash }, async (client) => {
      const found = await client.query<KeyRow>(
        `select id, tenant_id as "tenantId", branch_id as "branchId", created_by_user_id as "createdByUserId", revoked_at as "revokedAt"
         from api_keys where key_hash = $1`,
        [keyHash]
      );
      const row = found.rows[0];
      if (!row || row.revokedAt) {
        throw invalidKey();
      }
      // The creator must still be active and a member of the key's (active) branch.
      await client.query("select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)", [row.tenantId, row.createdByUserId]);
      const creator = await client.query(
        `select 1
         from users
         join user_branch_memberships membership
           on membership.user_id = users.id and membership.tenant_id = $1 and membership.branch_id = $2
         join branches on branches.tenant_id = membership.tenant_id and branches.id = membership.branch_id
         where users.id = $3 and users.is_active and branches.is_active`,
        [row.tenantId, row.branchId, row.createdByUserId]
      );
      if (!creator.rowCount) {
        throw invalidKey();
      }
      return { tenantId: row.tenantId, branchId: row.branchId, userId: row.createdByUserId };
    });

    let enabled: boolean;
    try {
      enabled = await this.features.isEnabled(scope, PUBLIC_API_FEATURE);
    } catch (error) {
      if (error instanceof SubscriptionAccessError) {
        throw new SubscriptionInactiveException();
      }
      throw error;
    }
    if (!enabled) {
      throw new ForbiddenException({
        statusCode: HttpStatus.FORBIDDEN,
        code: "PLAN_FEATURE_RESTRICTED",
        message: "Tu plan no incluye esta funcionalidad.",
        feature: PUBLIC_API_FEATURE
      });
    }

    await this.touch(keyHash);
    return scope;
  }

  /** Best effort: a failure to stamp the last use never blocks the request. */
  private async touch(keyHash: string): Promise<void> {
    try {
      await this.authDatabase.withTransaction({ apiKeyHash: keyHash }, (client) =>
        client.query("update api_keys set last_used_at = now() where key_hash = $1", [keyHash])
      );
    } catch (error) {
      this.logger.warn(`Could not record API key use: ${(error as Error).message}`);
    }
  }
}

/**
 * Controller-level guard for `api/public/v1`. Those routes are also `@Public()`, so the global
 * AuthenticationGuard skips them; global guards run first, which is why this guard checks the
 * subscription and the `public_api` feature itself instead of relying on SubscriptionGuard.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@Inject(ApiKeyAuthenticator) private readonly authenticator: ApiKeyAuthenticator) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.auth = await this.authenticator.authenticate(request.headers[API_KEY_HEADER]);
    return true;
  }
}
