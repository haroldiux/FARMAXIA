import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { AccessTokenService, accessTokenLifetimeSeconds } from "./access-token.service.js";
import { AuthDatabase } from "./auth-database.js";
import { PasswordHasher } from "./password-hasher.js";
import { assertStrongPassword } from "./password-policy.js";
import { generateTotpSecret, openSecret, sealSecret, totpUri, verifyTotp } from "./totp.js";
import type { AuthContext, BranchOption, LoginInput, LoginOutcome, SessionMeta, SessionTokens } from "./auth.types.js";

const refreshLifetimeDays = 30;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AuthUser {
  id: string;
  email: string;
  passwordHash: string;
  isActive: boolean;
  totpSecret: string | null;
  totpLastStep: string | null;
}

interface StoredSession extends AuthContext {
  id: string;
  startedAt: Date;
  userAgent: string | null;
}

export interface AccountProfile {
  userId: string;
  email: string;
  displayName: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  branchId: string;
  branchName: string;
  twoFactorEnabled: boolean;
  passwordChangedAt: Date | null;
  branches: BranchOption[];
}

export interface ActiveSession {
  id: string;
  current: boolean;
  startedAt: Date;
  lastRefreshAt: Date;
  expiresAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
  tenantName: string | null;
  branchName: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(AuthDatabase) private readonly database: AuthDatabase,
    @Inject(PasswordHasher) private readonly passwordHasher: PasswordHasher,
    @Inject(AccessTokenService) private readonly accessTokens: AccessTokenService
  ) {}

  /**
   * Valida la contraseña y luego resuelve farmacia y sucursal entre las membresías del
   * usuario. Solo tras una contraseña correcta se revelan farmacias/sucursales para elegir.
   * Con 2FA activo devuelve un desafío en vez de la sesión.
   */
  async login(input: LoginInput, meta: SessionMeta = {}): Promise<LoginOutcome> {
    this.validateLoginInput(input);
    const user = await this.findUser(input.email.trim().toLowerCase());

    if (!user || !user.isActive || !(await this.passwordHasher.verify(user.passwordHash, input.password))) {
      throw new UnauthorizedException("Invalid credentials.");
    }

    const memberships = await this.membershipsOf(user.id);
    const requestedTenant = (input.tenantId ?? input.tenant)?.trim().toLowerCase();
    const inTenant = requestedTenant
      ? memberships.filter((option) => option.tenantId === requestedTenant || option.tenantSlug === requestedTenant)
      : memberships;
    const candidates = input.branchId ? inTenant.filter((option) => option.branchId === input.branchId) : inTenant;

    if (!candidates.length) {
      throw new UnauthorizedException("Invalid credentials.");
    }
    if (candidates.length > 1) {
      return { kind: "select_branch", options: candidates };
    }

    const selected = candidates[0] as BranchOption;
    const context: AuthContext = { userId: user.id, tenantId: selected.tenantId, branchId: selected.branchId };
    if (!(await this.hasMembership(context))) {
      throw new UnauthorizedException("Invalid credentials.");
    }
    if (user.totpSecret) {
      return { kind: "totp", challengeToken: await this.accessTokens.issueChallenge(context, user.email) };
    }
    return { kind: "session", tokens: await this.createSession(context, meta) };
  }

  async completeTotpLogin(challengeToken: unknown, code: unknown, meta: SessionMeta = {}): Promise<SessionTokens> {
    if (typeof challengeToken !== "string" || typeof code !== "string") {
      throw new UnauthorizedException("Invalid credentials.");
    }
    const challenge = await this.accessTokens.verifyChallenge(challengeToken);
    const user = await this.findUser(challenge.email);
    if (!user || user.id !== challenge.userId || !user.isActive || !user.totpSecret) {
      throw new UnauthorizedException("Invalid credentials.");
    }
    const step = verifyTotp(openSecret(user.totpSecret), code, user.totpLastStep === null ? null : Number(user.totpLastStep));
    if (step === null) {
      throw new UnauthorizedException({ statusCode: 401, code: "INVALID_TOTP", message: "El código no es válido o ya fue usado." });
    }
    const context: AuthContext = { userId: challenge.userId, tenantId: challenge.tenantId, branchId: challenge.branchId };
    await this.database.withTransaction(context, async (client) => {
      await client.query("update users set totp_last_step = $2 where id = $1", [context.userId, step]);
    });
    if (!(await this.hasMembership(context))) {
      throw new UnauthorizedException("Invalid credentials.");
    }
    return this.createSession(context, meta);
  }

  async refresh(refreshToken: string | undefined, meta: SessionMeta = {}): Promise<SessionTokens> {
    if (!refreshToken) {
      throw new UnauthorizedException();
    }

    const tokenHash = hashRefreshToken(refreshToken);
    const existingSession = await this.database.withTransaction(
      { refreshTokenHash: tokenHash },
      async (client) => {
        const { rows } = await client.query<StoredSession>(
          `select id, user_id as \"userId\", tenant_id as \"tenantId\", branch_id as \"branchId\",
                  started_at as \"startedAt\", user_agent as \"userAgent\"
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

        // La cadena de refresh conserva cuándo empezó la sesión en ese dispositivo.
        await this.insertSession(client, context, newTokenHash, expiresAt, {
          userAgent: meta.userAgent ?? existingSession.userAgent ?? undefined,
          ipAddress: meta.ipAddress
        }, existingSession.startedAt);
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

  /**
   * Permisos efectivos. Un usuario desactivado o sin acceso a la sucursal no tiene
   * permisos aunque su token de 15 minutos siga vigente.
   */
  async permissionsFor(context: AuthContext): Promise<string[]> {
    return this.database.withTransaction(context, async (client) => {
      const { rows } = await client.query<{ code: string }>(
        `select distinct role_permissions.permission_code as code
         from user_roles
         join role_permissions on role_permissions.role_id = user_roles.role_id
         join users on users.id = user_roles.user_id and users.is_active
         where user_roles.user_id = $1
           and exists (
             select 1 from user_branch_memberships
             where user_id = $1 and tenant_id = $2 and branch_id = $3
           )
         order by code`,
        [context.userId, context.tenantId, context.branchId]
      );
      return rows.map((row) => row.code);
    });
  }

  async account(context: AuthContext): Promise<AccountProfile> {
    const profile = await this.database.withTransaction(context, async (client) => {
      const { rows } = await client.query<Omit<AccountProfile, "branches" | "twoFactorEnabled"> & { totpEnabledAt: Date | null }>(
        `select users.id as "userId", users.email, users.display_name as "displayName",
                tenants.id as "tenantId", tenants.slug as "tenantSlug", tenants.name as "tenantName",
                branches.id as "branchId", branches.name as "branchName",
                users.totp_enabled_at as "totpEnabledAt", users.password_changed_at as "passwordChangedAt"
         from users
         join tenants on tenants.id = $2
         join branches on branches.tenant_id = $2 and branches.id = $3
         where users.id = $1`,
        [context.userId, context.tenantId, context.branchId]
      );
      return rows[0];
    });
    if (!profile) {
      throw new UnauthorizedException();
    }
    const { totpEnabledAt, ...rest } = profile;
    const branches = (await this.membershipsOf(context.userId)).filter((option) => option.tenantId === context.tenantId);
    return { ...rest, twoFactorEnabled: totpEnabledAt !== null, branches };
  }

  /** Cambia a otra sucursal de la misma farmacia: abre una sesión nueva y cierra la actual. */
  async switchBranch(context: AuthContext, branchId: unknown, currentRefreshToken: string | undefined, meta: SessionMeta = {}): Promise<SessionTokens> {
    if (typeof branchId !== "string" || !uuidPattern.test(branchId)) {
      throw new BadRequestException({ code: "INVALID_INPUT", field: "branchId", message: "Elige una sucursal." });
    }
    const next: AuthContext = { ...context, branchId };
    if (!(await this.hasMembership(next))) {
      throw new NotFoundException({ code: "BRANCH_NOT_ALLOWED", message: "No tienes acceso a esa sucursal." });
    }
    await this.logout(currentRefreshToken);
    return this.createSession(next, meta);
  }

  async listSessions(context: AuthContext, currentRefreshToken: string | undefined): Promise<ActiveSession[]> {
    const currentHash = currentRefreshToken ? hashRefreshToken(currentRefreshToken) : null;
    return this.database.withTransaction({ userId: context.userId }, async (client) => {
      const { rows } = await client.query<ActiveSession & { tokenHash: string }>(
        `select session.id, session.token_hash as "tokenHash", session.started_at as "startedAt",
                session.created_at as "lastRefreshAt", session.expires_at as "expiresAt",
                session.user_agent as "userAgent", session.ip_address as "ipAddress",
                tenants.name as "tenantName", branches.name as "branchName"
         from auth_sessions as session
         left join tenants on tenants.id = session.tenant_id
         left join branches on branches.tenant_id = session.tenant_id and branches.id = session.branch_id
         where session.user_id = $1 and session.revoked_at is null and session.expires_at > now()
         order by session.created_at desc`,
        [context.userId]
      );
      return rows.map(({ tokenHash, ...session }) => ({ ...session, current: tokenHash === currentHash }));
    });
  }

  async revokeSession(context: AuthContext, sessionId: string): Promise<void> {
    if (!uuidPattern.test(sessionId)) {
      throw new NotFoundException();
    }
    const revoked = await this.database.withTransaction({ userId: context.userId }, async (client) => {
      const { rowCount } = await client.query(
        "update auth_sessions set revoked_at = now() where id = $1 and user_id = $2 and revoked_at is null",
        [sessionId, context.userId]
      );
      return rowCount;
    });
    if (!revoked) {
      throw new NotFoundException({ code: "SESSION_NOT_FOUND", message: "La sesión ya no está activa." });
    }
  }

  async revokeOtherSessions(context: AuthContext, currentRefreshToken: string | undefined): Promise<number> {
    const currentHash = currentRefreshToken ? hashRefreshToken(currentRefreshToken) : "";
    return this.database.withTransaction({ userId: context.userId }, async (client) => {
      const { rowCount } = await client.query(
        "update auth_sessions set revoked_at = now() where user_id = $1 and revoked_at is null and token_hash <> $2",
        [context.userId, currentHash]
      );
      return rowCount ?? 0;
    });
  }

  /** Cambio de contraseña propio: exige la actual y cierra las demás sesiones. */
  async changePassword(context: AuthContext, currentPassword: unknown, newPassword: unknown, currentRefreshToken: string | undefined): Promise<void> {
    const next = assertStrongPassword(newPassword, "newPassword");
    const user = await this.userById(context.userId);
    if (typeof currentPassword !== "string" || !(await this.passwordHasher.verify(user.passwordHash, currentPassword))) {
      throw new BadRequestException({ code: "WRONG_PASSWORD", field: "currentPassword", message: "La contraseña actual no es correcta." });
    }
    if (currentPassword === next) {
      throw new BadRequestException({ code: "SAME_PASSWORD", field: "newPassword", message: "La nueva contraseña debe ser distinta a la actual." });
    }
    const hash = await this.passwordHasher.hash(next);
    await this.database.withTransaction({ userId: context.userId }, async (client) => {
      await client.query("update users set password_hash = $2, password_changed_at = now() where id = $1", [context.userId, hash]);
    });
    await this.revokeOtherSessions(context, currentRefreshToken);
  }

  /** Paso 1 del 2FA: genera un secreto pendiente; se activa solo al confirmar un código. */
  async setupTwoFactor(context: AuthContext): Promise<{ secret: string; otpauthUri: string }> {
    const user = await this.userById(context.userId);
    if (user.totpSecret) {
      throw new ConflictException({ code: "TWO_FACTOR_ALREADY_ENABLED", message: "La verificación en dos pasos ya está activa." });
    }
    const secret = generateTotpSecret();
    await this.database.withTransaction({ userId: context.userId }, async (client) => {
      await client.query("update users set totp_pending_secret = $2 where id = $1", [context.userId, sealSecret(secret)]);
    });
    return { secret, otpauthUri: totpUri(secret, user.email) };
  }

  async enableTwoFactor(context: AuthContext, code: unknown): Promise<void> {
    const pending = await this.database.withTransaction({ userId: context.userId }, async (client) => {
      const { rows } = await client.query<{ pending: string | null }>(
        "select totp_pending_secret as pending from users where id = $1",
        [context.userId]
      );
      return rows[0]?.pending ?? null;
    });
    if (!pending) {
      throw new BadRequestException({ code: "TWO_FACTOR_NOT_STARTED", message: "Primero genera el código QR." });
    }
    const step = typeof code === "string" ? verifyTotp(openSecret(pending), code, null) : null;
    if (step === null) {
      throw new BadRequestException({ code: "INVALID_TOTP", field: "code", message: "El código no coincide. Revisa la hora del teléfono e inténtalo de nuevo." });
    }
    await this.database.withTransaction({ userId: context.userId }, async (client) => {
      await client.query(
        `update users set totp_secret = totp_pending_secret, totp_pending_secret = null,
                          totp_enabled_at = now(), totp_last_step = $2
         where id = $1`,
        [context.userId, step]
      );
    });
  }

  async disableTwoFactor(context: AuthContext, password: unknown): Promise<void> {
    const user = await this.userById(context.userId);
    if (typeof password !== "string" || !(await this.passwordHasher.verify(user.passwordHash, password))) {
      throw new BadRequestException({ code: "WRONG_PASSWORD", field: "password", message: "La contraseña no es correcta." });
    }
    await this.database.withTransaction({ userId: context.userId }, async (client) => {
      await client.query(
        `update users set totp_secret = null, totp_pending_secret = null, totp_enabled_at = null, totp_last_step = null
         where id = $1`,
        [context.userId]
      );
    });
  }

  /** Abre una sesión para un contexto ya verificado (login o alta de una farmacia). */
  async createSession(context: AuthContext, meta: SessionMeta = {}): Promise<SessionTokens> {
    const refreshToken = createRefreshToken();
    await this.database.withTransaction(context, async (client) => {
      await this.insertSession(client, context, hashRefreshToken(refreshToken), refreshExpiry(), meta);
      await client.query("update users set last_login_at = now() where id = $1", [context.userId]);
    });

    return {
      accessToken: await this.accessTokens.issue(context),
      refreshToken,
      expiresInSeconds: accessTokenLifetimeSeconds
    };
  }

  private async findUser(email: string): Promise<AuthUser | undefined> {
    return this.database.withTransaction({ loginEmail: email }, async (client) => {
      const { rows } = await client.query<AuthUser>(
        `select id, email, password_hash as \"passwordHash\", is_active as \"isActive\",
                totp_secret as \"totpSecret\", totp_last_step::text as \"totpLastStep\"
         from users
         where email = $1`,
        [email]
      );
      return rows[0];
    });
  }

  private async userById(userId: string): Promise<AuthUser> {
    const user = await this.database.withTransaction({ userId }, async (client) => {
      const { rows } = await client.query<AuthUser>(
        `select id, email, password_hash as \"passwordHash\", is_active as \"isActive\",
                totp_secret as \"totpSecret\", totp_last_step::text as \"totpLastStep\"
         from users where id = $1`,
        [userId]
      );
      return rows[0];
    });
    if (!user?.isActive) {
      throw new UnauthorizedException();
    }
    return user;
  }

  /** Farmacias y sucursales activas del usuario (sin contexto de farmacia en la sesión SQL). */
  private async membershipsOf(userId: string): Promise<BranchOption[]> {
    return this.database.withTransaction({ userId }, async (client) => {
      const { rows } = await client.query<BranchOption>(
        `select membership.tenant_id as "tenantId", tenants.slug as "tenantSlug", tenants.name as "tenantName",
                membership.branch_id as "branchId", branches.code as "branchCode", branches.name as "branchName"
         from user_branch_memberships as membership
         join tenants on tenants.id = membership.tenant_id
         join branches on branches.tenant_id = membership.tenant_id and branches.id = membership.branch_id
         where membership.user_id = $1 and branches.is_active
         order by tenants.name, branches.code`,
        [userId]
      );
      return rows;
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

  private async insertSession(
    client: PoolClient,
    context: AuthContext,
    tokenHash: string,
    expiresAt: Date,
    meta: SessionMeta = {},
    startedAt: Date = new Date()
  ): Promise<void> {
    await client.query(
      `insert into auth_sessions (token_hash, user_id, tenant_id, branch_id, expires_at, user_agent, ip_address, started_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        tokenHash,
        context.userId,
        context.tenantId,
        context.branchId,
        expiresAt,
        meta.userAgent?.slice(0, 255) ?? null,
        meta.ipAddress?.slice(0, 64) ?? null,
        startedAt
      ]
    );
  }

  private validateLoginInput(input: LoginInput): void {
    const optionalId = (value: unknown) => value === undefined || value === null || value === ""
      || (typeof value === "string" && uuidPattern.test(value));
    if (
      !input ||
      typeof input.email !== "string" ||
      !input.email.trim() ||
      typeof input.password !== "string" ||
      !input.password ||
      !optionalId(input.tenantId) ||
      !optionalId(input.branchId) ||
      (input.tenant !== undefined && typeof input.tenant !== "string")
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
