import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { AccessTokenService, accessTokenLifetimeSeconds } from "./access-token.service.js";
import { AuthDatabase } from "./auth-database.js";
import { PasswordHasher } from "./password-hasher.js";
import type { AuthContext, LoginInput, SessionTokens } from "./auth.types.js";

const refreshLifetimeDays = 30;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AuthUser {
  id: string;
  passwordHash: string;
  isActive: boolean;
}

interface StoredSession extends AuthContext {
  id: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(AuthDatabase) private readonly database: AuthDatabase,
    @Inject(PasswordHasher) private readonly passwordHasher: PasswordHasher,
    @Inject(AccessTokenService) private readonly accessTokens: AccessTokenService
  ) {}

  async login(input: LoginInput): Promise<SessionTokens> {
    this.validateLoginInput(input);
    const user = await this.findUser(input.email.trim().toLowerCase());

    if (!user || !user.isActive || !(await this.passwordHasher.verify(user.passwordHash, input.password))) {
      throw new UnauthorizedException("Invalid credentials.");
    }

    const context: AuthContext = {
      userId: user.id,
      tenantId: input.tenantId,
      branchId: input.branchId
    };
    if (!(await this.hasMembership(context))) {
      throw new UnauthorizedException("Invalid credentials.");
    }

    return this.createSession(context);
  }

  async refresh(refreshToken: string | undefined): Promise<SessionTokens> {
    if (!refreshToken) {
      throw new UnauthorizedException();
    }

    const tokenHash = hashRefreshToken(refreshToken);
    const existingSession = await this.database.withTransaction(
      { refreshTokenHash: tokenHash },
      async (client) => {
        const { rows } = await client.query<StoredSession>(
          `select id, user_id as \"userId\", tenant_id as \"tenantId\", branch_id as \"branchId\"
           from auth_sessions
           where token_hash = $1 and revoked_at is null and expires_at > now()`,
          [tokenHash]
        );
        return rows[0];
      }
    );

    if (!existingSession) {
      throw new UnauthorizedException();
    }

    const context: AuthContext = {
      userId: existingSession.userId,
      tenantId: existingSession.tenantId,
      branchId: existingSession.branchId
    };
    if (!(await this.hasMembership(context))) {
      throw new UnauthorizedException();
    }

    const newRefreshToken = createRefreshToken();
    const newTokenHash = hashRefreshToken(newRefreshToken);
    const expiresAt = refreshExpiry();

    await this.database.withTransaction(
      { ...context, refreshTokenHash: tokenHash },
      async (client) => {
        const { rowCount } = await client.query(
          `update auth_sessions
           set revoked_at = now()
           where id = $1 and token_hash = $2 and revoked_at is null and expires_at > now()`,
          [existingSession.id, tokenHash]
        );
        if (rowCount !== 1) {
          throw new UnauthorizedException();
        }

        await this.insertSession(client, context, newTokenHash, expiresAt);
      }
    );

    return {
      accessToken: await this.accessTokens.issue(context),
      refreshToken: newRefreshToken,
      expiresInSeconds: accessTokenLifetimeSeconds
    };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) {
      return;
    }

    await this.database.withTransaction(
      { refreshTokenHash: hashRefreshToken(refreshToken) },
      async (client) => {
        await client.query(
          "update auth_sessions set revoked_at = now() where token_hash = $1 and revoked_at is null",
          [hashRefreshToken(refreshToken)]
        );
      }
    );
  }

  async permissionsFor(context: AuthContext): Promise<string[]> {
    return this.database.withTransaction(context, async (client) => {
      const { rows } = await client.query<{ code: string }>(
        `select distinct permission_code as code
         from user_roles
         join role_permissions on role_permissions.role_id = user_roles.role_id
         where user_roles.user_id = $1
         order by permission_code`,
        [context.userId]
      );
      return rows.map((row) => row.code);
    });
  }

  private async findUser(email: string): Promise<AuthUser | undefined> {
    return this.database.withTransaction({ loginEmail: email }, async (client) => {
      const { rows } = await client.query<AuthUser>(
        `select id, password_hash as \"passwordHash\", is_active as \"isActive\"
         from users
         where email = $1`,
        [email]
      );
      return rows[0];
    });
  }

  private async hasMembership(context: AuthContext): Promise<boolean> {
    return this.database.withTransaction(context, async (client) => {
      const { rowCount } = await client.query(
        `select 1
         from user_branch_memberships
         where user_id = $1 and tenant_id = $2 and branch_id = $3`,
        [context.userId, context.tenantId, context.branchId]
      );
      return rowCount === 1;
    });
  }

  private async createSession(context: AuthContext): Promise<SessionTokens> {
    const refreshToken = createRefreshToken();
    await this.database.withTransaction(context, async (client) => {
      await this.insertSession(client, context, hashRefreshToken(refreshToken), refreshExpiry());
    });

    return {
      accessToken: await this.accessTokens.issue(context),
      refreshToken,
      expiresInSeconds: accessTokenLifetimeSeconds
    };
  }

  private async insertSession(
    client: PoolClient,
    context: AuthContext,
    tokenHash: string,
    expiresAt: Date
  ): Promise<void> {
    await client.query(
      `insert into auth_sessions (token_hash, user_id, tenant_id, branch_id, expires_at)
       values ($1, $2, $3, $4, $5)`,
      [tokenHash, context.userId, context.tenantId, context.branchId, expiresAt]
    );
  }

  private validateLoginInput(input: LoginInput): void {
    if (
      !input ||
      !input.email?.trim() ||
      !input.password ||
      !input.tenantId ||
      !input.branchId ||
      !uuidPattern.test(input.tenantId) ||
      !uuidPattern.test(input.branchId)
    ) {
      throw new UnauthorizedException("Invalid credentials.");
    }
  }
}

function createRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function refreshExpiry(): Date {
  return new Date(Date.now() + refreshLifetimeDays * 24 * 60 * 60 * 1000);
}
